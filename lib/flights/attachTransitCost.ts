import { computeTransitCost, type TransitRow } from './transitCost';

export function attachTransitCost(
  legResult: { data?: any; error?: any } | null,
  direction: 'outbound' | 'return',
  date: string,
  postcodeDistrict: string,
  adults: number,
  children: number,
  infants: number,
  checkedBags: number,
  transitPreference: 'auto' | 'uber' | 'transit',
): any {
  if (!legResult || legResult.error || !legResult.data) return legResult?.data ?? null;

  const childrenArr = Array.from({ length: children }, () => ({ age: 10 }));

  const options = (legResult.data.options ?? []).map((opt: any) => {
    const timeStr = direction === 'outbound' ? opt.departure_time : opt.arrival_time;
    const departureTime = new Date(`${date}T${(timeStr ?? '09:00').slice(0, 5)}:00`);

    const row: TransitRow = {
      transit_offpeak_fare_pence:    opt.transit_offpeak_fare_pence,
      transit_offpeak_duration_mins: opt.transit_duration_mins,
      transit_offpeak_route_summary: opt.transit_method,
      transit_changes:               opt.transit_changes,
      uber_low_pence:                opt.uber_low_pence,
      uber_high_pence:               opt.uber_high_pence,
      uber_duration_offpeak_mins:    opt.uber_duration_offpeak_mins,
    };

    const airportIata = direction === 'outbound' ? opt.origin_iata : opt.destination_iata;
    const transit = computeTransitCost(
      {
        postcode_district: postcodeDistrict,
        airport_iata: airportIata,
        departure_time: departureTime,
        adults,
        children: childrenArr,
        infants,
        checkedBags,
      },
      row,
    );

    const cost = transitPreference === 'uber' ? transit.uber.mean_pence : transit.recommended_cost_pence;

    return { ...opt, transit_cost_gbp: Math.round(cost) / 100 };
  });

  return { ...legResult.data, options };
}
