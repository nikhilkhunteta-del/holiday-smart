/**
 * Server-only: which of the switchable destinations have flight data for the family's dates.
 * Feeds the "Barcelona | Malta" switch at the top of the results page.
 *
 * "Has flight data" means the latest completed cross-sectional run — the same run
 * get_smart_recommendation prices from — holds at least one London -> destination fare AND at
 * least one destination -> London fare departing within the half-term (start..end), on the
 * destination's non-excluded airports. Party size is not filtered: the RPC maps any family to
 * the nearest stored composition, so every family sees the same destinations.
 *
 * Never throws: on any read failure the result is null and the page shows no switch.
 */
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { destinationDisplayName } from '@/lib/destinations';

/** Destinations the switch can offer, in display order. Andalusian Corridor is left out: it is
 *  a circuit (different trip rules) and its weather is stale until re-ingested at Málaga. */
export const SWITCHABLE_DESTINATIONS = ['barcelona', 'malta'] as const;

const LONDON_AIRPORTS = ['LHR', 'LGW', 'STN', 'LTN', 'LCY'];

export interface DestinationOption {
  slug: string;
  name: string;
}

export async function destinationsWithFlights(start: string, end: string): Promise<DestinationOption[] | null> {
  try {
    const [run, dests] = await Promise.all([
      supabase
        .from('snapshot_runs')
        .select('id')
        .eq('run_type', 'cross_sectional')
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('destinations')
        .select('id, slug, name, destination_airports(iata_code, excluded)')
        .in('slug', [...SWITCHABLE_DESTINATIONS]),
    ]);
    if (run.error || !run.data || dests.error || !dests.data) return null;
    const runId = (run.data as { id: string }).id;

    const hasFare = async (from: string[], to: string[]) => {
      const res = await supabase
        .from('fare_snapshots')
        .select('id')
        .eq('run_id', runId)
        .in('origin_iata', from)
        .in('destination_iata', to)
        .gte('departure_date', start)
        .lte('departure_date', end)
        .limit(1);
      if (res.error) throw res.error;
      return (res.data ?? []).length > 0;
    };

    const rows = dests.data as { slug: string; name: string | null; destination_airports: { iata_code: string; excluded: boolean }[] }[];
    const checked = await Promise.all(
      SWITCHABLE_DESTINATIONS.map(async (slug): Promise<DestinationOption | null> => {
        const row = rows.find(r => r.slug === slug);
        const airports = (row?.destination_airports ?? []).filter(a => !a.excluded).map(a => a.iata_code);
        if (!row || airports.length === 0) return null;
        const [out, back] = await Promise.all([hasFare(LONDON_AIRPORTS, airports), hasFare(airports, LONDON_AIRPORTS)]);
        return out && back ? { slug, name: destinationDisplayName(row.name, slug) } : null;
      }),
    );
    return checked.filter((d): d is DestinationOption => d !== null);
  } catch (e) {
    console.error('[destinationsWithFlights] failed:', e);
    return null;
  }
}
