#!/usr/bin/env python3
"""
Pilot snapshot job — Python equivalent of lib/flights/snapshotJob.ts

Two-stage pipeline per destination airport pool:
  Stage 1 — google_flights_calendar: find cheapest dates in the window (in-memory).
  Stage 2 — google_flights: detail call per promising date × London airport.

Pilot scope:
  Destinations : barcelona, andalusian-corridor, malta
  Outbound     : 2026-10-22 → 2026-11-02
  Return       : 2026-10-25 → 2026-11-12  (3–4 and 7–10 night durations)
  Party        : 2 adults, 2 children, 0 infants

Required environment variables:
  SUPABASE_URL             — e.g. https://xxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY
  SEARCHAPI_KEY

Dependencies:
  pip install requests supabase
"""

import itertools
import os
import sys
import time
from datetime import datetime, timezone

import requests
from supabase import create_client, Client

# ── Pilot config ──────────────────────────────────────────────────────────────

PILOT_SLUGS     = ['barcelona', 'andalusian-corridor', 'malta']
LONDON_ORIGINS  = ['LGW', 'LHR', 'STN', 'LTN', 'LCY']

OUTBOUND_START  = '2026-10-22'
OUTBOUND_END    = '2026-11-02'
RETURN_START    = '2026-10-25'  # OUTBOUND_START + 3 nights
RETURN_END      = '2026-11-12'  # OUTBOUND_END   + 10 nights

ADULTS              = 2
CHILDREN            = 2
INFANTS             = 0
CURRENCY            = 'GBP'
MAX_PROMISING_DATES = 8
API_DELAY_SECS      = 0.35   # ~300 ms between calls; respect SearchAPI rate limits

SEARCHAPI_BASE = 'https://www.searchapi.io/api/v1/search'

# ── Credentials ───────────────────────────────────────────────────────────────

def _require_env(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        raise RuntimeError(f'Missing required environment variable: {key}')
    return val


def get_supabase() -> Client:
    return create_client(
        _require_env('SUPABASE_URL'),
        _require_env('SUPABASE_SERVICE_ROLE_KEY'),
    )

# ── snapshot_runs bookkeeping ─────────────────────────────────────────────────

def start_run(sb: Client) -> str:
    res = sb.table('snapshot_runs').insert({
        'run_type': 'cross_sectional',
        'target_windows': ['2026-10-halfterm'],
    }).execute()
    return res.data[0]['id']


def finish_run(
    sb: Client,
    run_id: str,
    total: int,
    success: int,
    failed: int,
    notes: str = None,
) -> None:
    payload = {
        'completed_at': datetime.now(timezone.utc).isoformat(),
        'total_calls':   total,
        'success_calls': success,
        'failed_calls':  failed,
    }
    if notes:
        payload['notes'] = notes
    sb.table('snapshot_runs').update(payload).eq('id', run_id).execute()

# ── Reference data ────────────────────────────────────────────────────────────

def load_destination_pools(sb: Client) -> list:
    """
    Two plain queries — no joins.

    Query 1: destinations WHERE slug IN (pilot slugs)
    Query 2: destination_airports WHERE destination_id IN (...) AND excluded = false

    Returns list of dicts:
        { 'destination_id': str, 'slug': str, 'airport_codes': [str] }
    """
    # Query 1 — pilot destinations
    dest_res = sb.table('destinations').select('id, slug').in_('slug', PILOT_SLUGS).execute()
    dests = dest_res.data or []
    print(f'[snapshot] destinations query: {len(dests)} row(s) returned')
    if not dests:
        print(f'[snapshot] WARNING: no destinations matched slugs {PILOT_SLUGS}')
        return []

    dest_ids    = [d['id'] for d in dests]
    slug_by_id  = {d['id']: d['slug'] for d in dests}

    # Query 2 — non-excluded airports for those destination IDs
    ap_res = (
        sb.table('destination_airports')
          .select('destination_id, iata_code')
          .in_('destination_id', dest_ids)
          .eq('excluded', False)
          .execute()
    )
    airports = ap_res.data or []
    print(f'[snapshot] destination_airports query: {len(airports)} row(s) returned')
    if not airports:
        print(f'[snapshot] WARNING: no airports with excluded=false for {len(dests)} destination(s)')
        return []

    # Group by destination_id
    codes_by_dest: dict = {}
    for row in airports:
        codes_by_dest.setdefault(row['destination_id'], []).append(row['iata_code'])

    pools = []
    for dest in dests:
        codes = codes_by_dest.get(dest['id'], [])
        if not codes:
            continue
        pools.append({
            'destination_id': dest['id'],
            'slug':           dest['slug'],
            'airport_codes':  codes,
        })
        print(f"[snapshot] {dest['slug']}: airport pool = [{', '.join(codes)}]")

    return pools

# ── SearchAPI.io helpers ──────────────────────────────────────────────────────

def _searchapi_get(params: dict) -> dict:
    """GET to SearchAPI.io with up to 3 attempts and exponential back-off."""
    full_params = {**params, 'api_key': _require_env('SEARCHAPI_KEY')}
    for attempt in range(3):
        try:
            resp = requests.get(SEARCHAPI_BASE, params=full_params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            if 'error' in data:
                raise ValueError(f"SearchAPI error: {data['error']}")
            return data
        except Exception as exc:
            delay = 2 ** attempt
            print(f'[snapshot]   attempt {attempt + 1} failed ({exc}) — retry in {delay}s')
            if attempt < 2:
                time.sleep(delay)
    raise RuntimeError('All 3 SearchAPI attempts failed')


def _calendar_promising_dates(
    origin: str,
    destination: str,
    date_start: str,
    date_end: str,
) -> list:
    """
    Stage 1: google_flights_calendar.
    origin / destination each accept comma-separated IATA codes.
    Returns up to MAX_PROMISING_DATES departure date strings (YYYY-MM-DD).
    """
    data = _searchapi_get({
        'engine':              'google_flights_calendar',
        'departure_id':        origin,
        'arrival_id':          destination,
        'outbound_date_start': date_start,
        'outbound_date_end':   date_end,
        'flight_type':         'one_way',
        'currency':            CURRENCY,
        'gl':                  'gb',
        'hl':                  'en',
    })

    calendar = data.get('calendar', [])
    priced   = [e for e in calendar if e.get('price') is not None]
    if not priced:
        return []

    # Lowest-price-flagged dates first, then fill to cap by price ascending
    flagged  = [e['departure'] for e in priced if e.get('is_lowest_price')]
    others   = sorted(
        (e for e in priced if not e.get('is_lowest_price')),
        key=lambda e: e['price'],
    )
    dates = list(dict.fromkeys(flagged + [e['departure'] for e in others]))
    return dates[:MAX_PROMISING_DATES]


def _fetch_flights(origin: str, destination: str, outbound_date: str) -> list:
    """
    Stage 2: google_flights one-way detail call.
    Returns list of normalised flight dicts ready for fare_snapshots insertion.
    """
    data = _searchapi_get({
        'engine':               'google_flights',
        'departure_id':         origin,
        'arrival_id':           destination,
        'outbound_date':        outbound_date,
        'flight_type':          'one_way',
        'adults':               ADULTS,
        'children':             CHILDREN,
        'currency':             CURRENCY,
        'gl':                   'gb',
        'hl':                   'en',
        'max_flight_duration':  360,
    })

    results = []
    for bucket, is_best in [('best_flights', True), ('other_flights', False)]:
        for f in data.get(bucket, []):
            legs = f.get('flights', [])
            if not legs:
                continue
            first      = legs[0]
            last       = legs[-1]
            flight_num = first.get('flight_number', '')
            # Extract 2-letter airline IATA from flight number ('VY 7827' → 'VY')
            airline_iata = flight_num.replace(' ', '')[:2].upper() if flight_num else ''
            results.append({
                'is_best':          is_best,
                'price':            f['price'],
                'flight_number':    flight_num,
                'airline_iata':     airline_iata,
                'carrier':          first.get('airline', ''),
                'departure_time':   first['departure_airport']['time'],
                'arrival_time':     last['arrival_airport']['time'],
                'duration_minutes': f.get('total_duration', 0),
                'stops':            len(legs) - 1,
                'booking_token':    f.get('booking_token') or None,
                'raw_json':         f,
            })
    return results


def _extract_time(api_time: str) -> str:
    """Extract HH:MM from '2026-10-26 07:15', '2026-10-26T07:15', or '07:15'."""
    parts = api_time.strip().replace('T', ' ').split()
    return parts[-1][:5]


def _is_overnight(dep: str, arr: str) -> bool:
    dep_parts = dep.strip().replace('T', ' ').split()
    arr_parts = arr.strip().replace('T', ' ').split()
    if len(dep_parts) >= 2 and len(arr_parts) >= 2:
        return dep_parts[0] != arr_parts[0]
    return False

# ── fare_snapshots insert ─────────────────────────────────────────────────────

def _insert_fare_snapshots(
    sb: Client,
    run_id: str,
    results: list,
    departure_date: str,
    origin_iata: str,
    destination_iata: str,
) -> tuple:
    """Returns (ok_count, fail_count)."""
    if not results:
        return 0, 0

    best_rank  = 1
    other_rank = 1
    rows = []
    for r in results:
        is_best = r['is_best']
        rank    = best_rank if is_best else other_rank
        if is_best:
            best_rank  += 1
        else:
            other_rank += 1
        rows.append({
            'run_id':           run_id,
            'snapshot_type':    'cross_sectional',
            'origin_iata':      origin_iata,
            'destination_iata': destination_iata,
            'departure_date':   departure_date,
            'flight_number':    r['flight_number'],
            'airline_iata':     r['airline_iata'],
            'departure_time':   _extract_time(r['departure_time']),
            'arrival_time':     _extract_time(r['arrival_time']),
            'duration_minutes': r['duration_minutes'],
            'stops':            r['stops'],
            'is_overnight':     _is_overnight(r['departure_time'], r['arrival_time']),
            'adults':           ADULTS,
            'children':         CHILDREN,
            'infants':          INFANTS,
            'party_total_gbp':  r['price'],
            'booking_token':    r['booking_token'],
            'result_bucket':    'best' if is_best else 'other',
            'result_rank':      rank,
            'raw_json':         r['raw_json'],
        })

    try:
        sb.table('fare_snapshots').insert(rows).execute()
        return len(rows), 0
    except Exception as exc:
        print(
            f'[snapshot]   fare_snapshots INSERT failed '
            f'({origin_iata}→{destination_iata} {departure_date}): {exc}'
        )
        return 0, len(rows)

# ── Direction runner ──────────────────────────────────────────────────────────

def _run_direction(
    sb: Client,
    run_id: str,
    dest_slug: str,
    pair_label: str,
    european_iata: str,
    direction: str,   # 'outbound' | 'return'
    date_start: str,
    date_end: str,
    counters: dict,
) -> None:
    """
    One direction for one European airport.

    Stage 1: single calendar call covering all 5 London airports at once
             (comma-separated) to find the most promising departure dates.
    Stage 2: one detail call per promising date × London airport.
    """
    london_block    = ','.join(LONDON_ORIGINS)
    calendar_origin = london_block   if direction == 'outbound' else european_iata
    calendar_dest   = european_iata  if direction == 'outbound' else london_block

    # Stage 1 — calendar pre-filter
    try:
        promising = _calendar_promising_dates(calendar_origin, calendar_dest, date_start, date_end)
    except Exception as exc:
        print(
            f'[snapshot] {dest_slug} {pair_label} {direction} {european_iata} '
            f'calendar FAILED: {exc}'
        )
        return

    if not promising:
        print(
            f'[snapshot] {dest_slug} {pair_label} {direction} {european_iata}: '
            f'no priced calendar dates in {date_start}..{date_end}'
        )
        return

    print(
        f'[snapshot] {dest_slug} {pair_label} {direction} {european_iata}: '
        f'{len(promising)} promising dates → {len(promising) * len(LONDON_ORIGINS)} detail calls'
    )

    # Stage 2 — detail calls per promising date × London airport
    for dep_date in promising:
        for london_iata in LONDON_ORIGINS:
            origin      = london_iata    if direction == 'outbound' else european_iata
            destination = european_iata  if direction == 'outbound' else london_iata

            counters['total'] += 1
            time.sleep(API_DELAY_SECS)

            try:
                results = _fetch_flights(origin, destination, dep_date)
            except Exception as exc:
                print(
                    f'[snapshot] {dest_slug} {pair_label} '
                    f'{origin}→{destination} {dep_date} FAILED: {exc}'
                )
                counters['failed'] += 1
                continue

            if not results:
                print(
                    f'[snapshot] {dest_slug} {pair_label} '
                    f'{origin}→{destination} {dep_date}: 0 results'
                )
                counters['success'] += 1
                continue

            best_price = next((r['price'] for r in results if r['is_best']), results[0]['price'])
            ok, fail   = _insert_fare_snapshots(sb, run_id, results, dep_date, origin, destination)

            print(
                f'[snapshot] {dest_slug} {pair_label} '
                f'{origin}→{destination} {dep_date}: '
                f'{len(results)} result(s), best £{best_price:.0f}, {ok} row(s) written'
                + (f', {fail} INSERT failed' if fail else '')
            )
            if fail:
                counters['failed'] += 1
            else:
                counters['success'] += 1

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print(f'[snapshot] job started {datetime.now(timezone.utc).isoformat()}')
    print(f'[snapshot] party={ADULTS}A+{CHILDREN}C+{INFANTS}I  window=2026-10-halfterm')
    print(f'[snapshot] outbound={OUTBOUND_START}..{OUTBOUND_END}  return={RETURN_START}..{RETURN_END}')

    sb       = get_supabase()
    counters = {'total': 0, 'success': 0, 'failed': 0}

    # 1. Register run
    try:
        run_id = start_run(sb)
        print(f'[snapshot] run_id={run_id}')
    except Exception as exc:
        print(f'[snapshot] FATAL: cannot register run: {exc}')
        sys.exit(1)

    # 2. Load airport pools
    try:
        pools = load_destination_pools(sb)
        total_airports = sum(len(p['airport_codes']) for p in pools)
        print(f'[snapshot] {len(pools)} destination(s), {total_airports} airport(s) in pools')
        if not pools:
            finish_run(sb, run_id, 0, 0, 0,
                       'No airport pools — seed destination_airports before running')
            sys.exit(0)
    except Exception as exc:
        finish_run(sb, run_id, 0, 0, 0, f'Pool load failed: {exc}')
        print(f'[snapshot] FATAL: pool load failed: {exc}')
        sys.exit(1)

    # 3. Main loop: destinations × airport pairs × directions
    #
    # All (airport_a, airport_b) combinations including same-airport round trips.
    # Outbound = London → airport_a; return = airport_b → London.
    try:
        for pool in pools:
            slug  = pool['slug']
            codes = pool['airport_codes']
            pairs = list(itertools.product(codes, codes))
            print(f'[snapshot] {slug}: {len(codes)} airport(s) → {len(pairs)} pair(s)')

            for airport_a, airport_b in pairs:
                pair_label = f'{airport_a}↔{airport_b}'

                # Outbound: London → airport_a
                _run_direction(
                    sb, run_id, slug, pair_label,
                    airport_a, 'outbound',
                    OUTBOUND_START, OUTBOUND_END,
                    counters,
                )

                # Return: airport_b → London
                _run_direction(
                    sb, run_id, slug, pair_label,
                    airport_b, 'return',
                    RETURN_START, RETURN_END,
                    counters,
                )

    except Exception as exc:
        print(f'[snapshot] Unexpected error in main loop: {exc}')
        finish_run(sb, run_id,
                   counters['total'], counters['success'], counters['failed'],
                   f'Terminated with error: {exc}')
        raise

    # 4. Mark run complete
    finish_run(sb, run_id, counters['total'], counters['success'], counters['failed'])
    print(
        f'[snapshot] job complete {datetime.now(timezone.utc).isoformat()}  '
        f'total={counters["total"]}  success={counters["success"]}  failed={counters["failed"]}'
    )


if __name__ == '__main__':
    main()
