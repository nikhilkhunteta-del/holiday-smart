#!/usr/bin/env python3
"""
Holiday Smart — Pilot flight snapshot runner (Crawlio via RapidAPI).

Reads airport pools from destination_airports table (NOT destination_legs — that table
no longer exists). Uses LON city code for all London-side queries.
Runs 4 family compositions per call: 1A+1C, 2A+1C, 2A+2C, 2A+1inf.
Pilot scope: barcelona, andalusian-corridor, malta. October 2026 half-term.
Date ranges are destination-type-aware: cities/resorts use a wider window, circuits a narrower outbound window.

Usage (Colab):
  # Run this file as a cell to define all functions, then call manually:
  test_single_call()              # validate API key + print raw response
  main()                          # start a brand-new run
  main(resume_run_id="<uuid>")    # resume a run that crashed mid-execution —
                                   # ONLY use this if the crash happened recently
                                   # (same session / same day). Resuming a run that
                                   # sat for a day+ blends observed_at timestamps
                                   # across that gap and muddies the booking-curve
                                   # history. If in doubt, delete the dead run and
                                   # start a fresh one instead.

Requirements:
  pip install requests supabase

Environment variables required:
  RAPIDAPI_KEY              RapidAPI key for google-flights8
  NEXT_PUBLIC_SUPABASE_URL  or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
"""

import os
import time
import json
import logging
from datetime import date, timedelta
from urllib.parse import urlparse, parse_qs
from typing import Optional

import requests
from supabase import create_client, Client

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("run_pilot")

# ── Constants ─────────────────────────────────────────────────────────────────

RAPIDAPI_HOST = "google-flights8.p.rapidapi.com"
BASE_URL = f"https://{RAPIDAPI_HOST}/api/v1/search"

# LON city code — collapses all 5 London airports into one Crawlio call.
# Individual airport attribution visible in response segments[0].from.
LON = "LON"

PILOT_SLUGS = ["barcelona", "andalusian-corridor", "malta"]

WINDOW_LABEL = "2026-10-halfterm"

# 4 standard family compositions.
COMPOSITIONS = [
    {"adults": 1, "children": 1, "infants": 0, "label": "1A+1C"},
    {"adults": 2, "children": 1, "infants": 0, "label": "2A+1C"},
    {"adults": 2, "children": 2, "infants": 0, "label": "2A+2C"},
    {"adults": 2, "children": 0, "infants": 1, "label": "2A+1inf"},
]

API_DELAY_SECS = 0.6   # delay between calls to stay within rate limits

# NOTE: RESUME_MODE now controls "skip already-collected calls" behaviour.
# It is only meaningful when main() is called with an existing resume_run_id —
# see main()'s docstring above for when resuming is (and isn't) appropriate.
RESUME_MODE = False  # set True only when resuming a failed/interrupted run

AIRLINE_IATA = {
    # Major carriers
    'Vueling': 'VY',
    'British Airways': 'BA',
    'Iberia': 'IB',
    'Wizz Air': 'W6',
    'Wizz Air Malta': 'W6',
    'Eurowings': 'EW',
    'easyJet': 'U2',
    'easyJet Switzerland': 'DS',
    'Ryanair': 'FR',
    'Ryanair UK': 'RK',
    'KLM': 'KL',
    'Air France': 'AF',
    'Lufthansa': 'LH',
    'Lufthansa City Airlines': 'CL',
    'Tap Air Portugal': 'TP',
    'TAP Air Portugal': 'TP',
    'Norwegian': 'DY',
    'SWISS': 'LX',
    'Turkish Airlines': 'TK',
    'Condor': 'DE',
    'ITA': 'AZ',
    'Air Europa': 'UX',
    'Scandinavian Airlines': 'SK',
    'KM Malta Airlines': 'KM',
    'Air Malta': 'KM',
    'Malta Air': 'KM',
    'Jet2': 'LS',
    'TUI Airways': 'BY',
    'Transavia': 'HV',
    'Volotea': 'V7',
    'Brussels Airlines': 'SN',
    'Luxair': 'LG',
    'Aegean': 'A3',
    'Air Dolomiti': 'EN',
    'Austrian': 'OS',
    'LOT': 'LO',
    'Finnair': 'AY',
    'Edelweiss Air': 'WK',
    'Discover Airlines': '4Y',
    'Air Serbia': 'JU',
    'Royal Air Maroc': 'AT',
}

# ── Crawlio API ───────────────────────────────────────────────────────────────

def crawlio_call(
    origin: str,
    destination: str,
    date: str,
    adults: int,
    children: int,
    infants: int = 0,
) -> dict:
    """
    Make one one-way flight search call to Crawlio (google-flights8 on RapidAPI).
    Returns the raw response dict. Raises on HTTP or API error.
    """
    key = os.environ.get("RAPIDAPI_KEY")
    if not key:
        raise EnvironmentError("RAPIDAPI_KEY env var is not set")

    params = {
        "origin":        origin,
        "destination":   destination,
        "date":          date,
        "adults":        adults,
        "children":      children,
        "infants_on_lap": infants,
        "currency":      "GBP",
        "sort_by":       "price",
    }

    headers = {
        "X-RapidAPI-Key":  key,
        "X-RapidAPI-Host": RAPIDAPI_HOST,
    }

    resp = requests.get(BASE_URL, params=params, headers=headers, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    if "message" in data:
        raise RuntimeError(f"Crawlio API error: {data['message']}")

    return data


# ── Response parsing ──────────────────────────────────────────────────────────

def lookup_airline_iata(name: Optional[str]) -> Optional[str]:
    """Look up IATA code from airline name via AIRLINE_IATA dict."""
    if not name:
        return None
    iata = AIRLINE_IATA.get(name)
    if iata:
        return iata
    fallback = name[:2].upper()
    log.warning(f"[snapshot] WARNING: unknown airline name \"{name}\" — stored fallback code \"{fallback}\". Add to AIRLINE_IATA lookup.")
    return fallback


def extract_booking_token(flight_url: str) -> Optional[str]:
    try:
        parsed = urlparse(flight_url)
        params = parse_qs(parsed.query)
        tfu = params.get("tfu", [None])[0]
        return tfu
    except Exception:
        return None


def to_hhmm(iso: Optional[str]) -> Optional[str]:
    """Extract HH:MM from ISO datetime string. Returns None if absent or unparseable."""
    if not iso:
        return None
    parts = iso.strip().replace("T", " ").split(" ")
    time_part = parts[-1][:5]
    return time_part if len(time_part) == 5 else None


def is_overnight(dep: Optional[str], arr: Optional[str]) -> bool:
    if not dep or not arr:
        return False
    dep_parts = dep.strip().replace("T", " ").split(" ")
    arr_parts = arr.strip().replace("T", " ").split(" ")
    if len(dep_parts) >= 2 and len(arr_parts) >= 2:
        return dep_parts[0] != arr_parts[0]
    return False


def parse_response(
    raw: dict,
    origin: str,
    destination: str,
    date: str,
    adults: int,
    children: int,
    infants: int,
) -> list[dict]:
    """
    Parse a Crawlio response into a list of fare_snapshots-shaped row dicts.
    Caller must add: run_id, snapshot_type.

    Dedupes exact-duplicate rows within a single API response (a known quirk
    of the underlying Google Flights data — the same flight sometimes appears
    twice, once as "best" and again as "other"). Keeps the first occurrence.
    This does not affect any MIN(party_total_gbp) query, but it keeps row
    counts meaningful and avoids wasting storage.
    """
    flights = raw.get("flights", [])
    results = raw.get("results", [])

    rows = []
    seen_keys = set()
    best_rank = 1
    other_rank = 1

    for i in range(min(len(flights), len(results))):
        flight = flights[i]
        result = results[i]
        if not flight or not result:
            continue

        segments = result.get("segments") or [{}]
        first_seg = segments[0]
        last_seg = segments[-1]
        is_best = flight.get("is_best", False)
        url = flight.get("url", "")
        airline_name = (flight.get("airlines") or [None])[0]

        dep_time = to_hhmm(first_seg.get("departure"))
        arr_time = to_hhmm(last_seg.get("arrival"))

        # Skip rows where times are null if DB columns are still NOT NULL.
        # Remove this guard once departure_time / arrival_time are made nullable.
        if dep_time is None or arr_time is None:
            log.debug("Skipping codeshare row with null departure/arrival time")
            continue

        airline_iata = lookup_airline_iata(airline_name)
        price = result.get("price")
        stops = result.get("stops", 0)

        # Dedup key: same flight identity + price, regardless of best/other bucket.
        dedup_key = (dep_time, arr_time, airline_iata, price, stops)
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)

        rows.append({
            "origin_iata":      (first_seg.get("from") or origin)[:3],
            "destination_iata": (last_seg.get("to")    or destination)[:3],
            "departure_date":   date,
            "flight_number":    None,
            "airline_iata":     airline_iata,
            "departure_time":   dep_time,
            "arrival_time":     arr_time,
            "duration_minutes": result.get("duration_min"),
            "stops":            stops,
            "aircraft_type":    first_seg.get("plane"),
            "is_overnight":     is_overnight(first_seg.get("departure"), last_seg.get("arrival")),
            "adults":           adults,
            "children":         children,
            "infants":          infants,
            "party_total_gbp":  price,
            "booking_token":    extract_booking_token(url),
            "result_bucket":    "best" if is_best else "other",
            "result_rank":      best_rank if is_best else other_rank,
            "raw_json":         {"flight": flight, "result": result},
        })

        if is_best:
            best_rank += 1
        else:
            other_rank += 1

    return rows


# ── Supabase helpers ──────────────────────────────────────────────────────────

def get_supabase() -> Client:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise EnvironmentError(
            "Missing env vars: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) "
            "and SUPABASE_SERVICE_ROLE_KEY are both required."
        )
    return create_client(url, key)


def start_run(supabase: Client, window_labels: list[str]) -> str:
    resp = (
        supabase.table("snapshot_runs")
        .insert({"run_type": "cross_sectional", "target_windows": window_labels})
        .execute()
    )
    if not resp.data:
        raise RuntimeError("snapshot_runs INSERT returned no data")
    run_id = resp.data[0]["id"]
    log.info(f"run_id = {run_id}")
    return run_id


def get_existing_run(supabase: Client, run_id: str) -> Optional[dict]:
    """
    Look up an existing snapshot_runs row by id. Returns None if not found.
    Used by main(resume_run_id=...) to validate the run exists and to warn
    if it looks like a stale/old run rather than a same-session crash.
    """
    resp = (
        supabase.table("snapshot_runs")
        .select("*")
        .eq("id", run_id)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


def finish_run(supabase: Client, run_id: str, total: int, success: int, failed: int) -> None:
    from datetime import datetime, timezone
    supabase.table("snapshot_runs").update({
        "completed_at":  datetime.now(timezone.utc).isoformat(),
        "total_calls":   total,
        "success_calls": success,
        "failed_calls":  failed,
    }).eq("id", run_id).execute()


def date_range(start: str, end: str) -> list[str]:
    """Generate all YYYY-MM-DD strings from start to end inclusive."""
    result = []
    cur = date.fromisoformat(start)
    last = date.fromisoformat(end)
    while cur <= last:
        result.append(str(cur))
        cur += timedelta(days=1)
    return result


def load_destination_pools(supabase: Client) -> dict[str, dict]:
    """
    Returns {slug: {"type": str, "airport_codes": [iata, ...]}} for pilot destinations.
    Reads from destination_airports — destination_legs no longer exists.
    The type field drives per-destination date range selection in main().
    """
    dest_resp = (
        supabase.table("destinations")
        .select("id, slug, type")
        .in_("slug", PILOT_SLUGS)
        .execute()
    )
    dests = dest_resp.data or []
    log.info(f"destinations: {len(dests)} row(s)")

    if not dests:
        log.warning(f"No destinations matched slugs: {PILOT_SLUGS}")
        return {}

    dest_id_to_meta = {d["id"]: {"slug": d["slug"], "type": d.get("type")} for d in dests}
    dest_ids = list(dest_id_to_meta.keys())

    airport_resp = (
        supabase.table("destination_airports")
        .select("destination_id, iata_code")
        .in_("destination_id", dest_ids)
        .eq("excluded", False)
        .execute()
    )
    airports = airport_resp.data or []
    log.info(f"destination_airports: {len(airports)} row(s)")

    pools: dict[str, dict] = {}
    for row in airports:
        meta = dest_id_to_meta.get(row["destination_id"])
        if meta:
            slug = meta["slug"]
            if slug not in pools:
                pools[slug] = {"type": meta["type"], "airport_codes": []}
            pools[slug]["airport_codes"].append(row["iata_code"])

    for slug, info in pools.items():
        log.info(f"  {slug} (type={info['type']}): pool = {info['airport_codes']}")

    return pools


def already_collected(
    supabase: Client,
    run_id: str,
    origin: str,
    destination: str,
    date: str,
    adults: int,
    children: int,
    infants: int,
) -> bool:
    """
    Returns True if fare_snapshots already has rows for this combination within the current run.
    For outbound calls (origin=LON), matches on destination_iata = destination.
    For return calls (destination=LON), matches on origin_iata = origin.
    Only called when RESUME_MODE = True.
    """
    q = (
        supabase.table("fare_snapshots")
        .select("id")
        .eq("run_id", run_id)
        .eq("departure_date", date)
        .eq("adults", adults)
        .eq("children", children)
        .eq("infants", infants)
    )
    if origin == LON:
        q = q.eq("destination_iata", destination)
    else:
        q = q.eq("origin_iata", origin)
    return bool(q.limit(1).execute().data)


def insert_rows(supabase: Client, run_id: str, rows: list[dict]) -> tuple[int, int]:
    if not rows:
        return 0, 0
    for row in rows:
        row["run_id"] = run_id
        row["snapshot_type"] = "cross_sectional"

    resp = supabase.table("fare_snapshots").insert(rows).execute()
    if not resp.data and hasattr(resp, "error") and resp.error:
        log.error(f"INSERT failed: {resp.error}")
        return 0, len(rows)
    return len(rows), 0


# ── Single-call test ──────────────────────────────────────────────────────────

def test_single_call() -> None:
    """
    Fire one Crawlio call — LON→BCN, 2026-10-25, 2A+2C — and print the raw response.
    Use this to validate API connectivity and response format before running the full pilot.
    """
    log.info("test_single_call: LON→BCN 2026-10-25 2A+2C")
    raw = crawlio_call(
        origin="LON",
        destination="BCN",
        date="2026-10-25",
        adults=2,
        children=2,
    )
    print("\n── Raw Crawlio response ───────────────────────────────")
    print(json.dumps(raw, indent=2))
    print("───────────────────────────────────────────────────────")

    flights = raw.get("flights", [])
    results = raw.get("results", [])
    log.info(f"flights[]: {len(flights)} items  |  results[]: {len(results)} items")

    if results:
        first = results[0]
        seg = (first.get("segments") or [{}])[0]
        log.info(
            f"First result: price=£{first.get('price')}  "
            f"duration={first.get('duration_min')}m  "
            f"stops={first.get('stops')}  "
            f"from={seg.get('from')}  to={seg.get('to')}  "
            f"dep={seg.get('departure')}  arr={seg.get('arrival')}"
        )


# ── Full pilot run ────────────────────────────────────────────────────────────

def _dates_for_type(dest_type: Optional[str]) -> tuple[list[str], list[str]]:
    """
    Return (outbound_dates, return_dates) for a destination based on its type.

    Cities / resorts: wide window to capture weekend-to-weekend trips.
      outbound 2026-10-21 – 2026-11-01  (12 dates)
      return   2026-10-24 – 2026-11-04  (12 dates)

    Circuits: narrow outbound (short departure window) + wide return.
      outbound 2026-10-21 – 2026-10-26  (6 dates)
      return   2026-10-28 – 2026-11-04  (8 dates)
    """
    if dest_type == "circuit":
        return (
            date_range("2026-10-21", "2026-10-26"),
            date_range("2026-10-28", "2026-11-04"),
        )
    # city, resort, or unknown — use wide window
    return (
        date_range("2026-10-21", "2026-11-01"),
        date_range("2026-10-24", "2026-11-04"),
    )


def main(resume_run_id: Optional[str] = None) -> None:
    """
    Run the full October 2026 half-term pilot.
    Destinations: barcelona, andalusian-corridor, malta.
    Date ranges: type-aware — cities/resorts use a wider window, circuits a narrower one.
    Compositions: 1A+1C, 2A+1C, 2A+2C, 2A+1inf.
    Directions: outbound (LON → airport) + return (airport → LON).

    Call from a Colab cell:
      main()                          — start a brand-new run (normal weekly usage)
      main(resume_run_id="<uuid>")     — resume a run that crashed mid-execution.

    Only pass resume_run_id if the crash happened recently (same session / same
    day). Resuming a run that's been sitting dead for a day or more will blend
    observed_at timestamps across that gap within a single run_id, which muddies
    any time-series analysis that assumes a run is one point in time. If the dead
    run is old, delete it and start fresh with main() instead.

    When resuming, set RESUME_MODE = True beforehand so already-collected calls
    are skipped rather than re-queried.
    """
    supabase = get_supabase()
    pools = load_destination_pools(supabase)

    if not pools:
        log.error("No airport pools — seed destinations and destination_airports first.")
        return

    if resume_run_id:
        existing = get_existing_run(supabase, resume_run_id)
        if not existing:
            raise ValueError(f"resume_run_id {resume_run_id} not found in snapshot_runs")
        if existing.get("completed_at"):
            log.warning(
                f"run {resume_run_id} already has completed_at set "
                f"({existing['completed_at']}) — resuming will overwrite it."
            )
        run_id = resume_run_id
        log.info(f"RESUMING run_id = {run_id} (started_at={existing.get('started_at')})")
        if not RESUME_MODE:
            log.warning(
                "resume_run_id was passed but RESUME_MODE is False — every call "
                "will be re-queried from scratch rather than skipped. Set "
                "RESUME_MODE = True before calling main(resume_run_id=...) if "
                "you want already-collected calls skipped."
            )
    else:
        run_id = start_run(supabase, [WINDOW_LABEL])

    total = success = failed = 0
    inserted_rows = 0

    try:
        for slug, dest_info in pools.items():
            airport_codes = dest_info["airport_codes"]
            outbound_dates, return_dates = _dates_for_type(dest_info["type"])
            log.info(
                f"destination: {slug} (type={dest_info['type']})  airports: {airport_codes}  "
                f"outbound_dates: {outbound_dates[0]}–{outbound_dates[-1]}  "
                f"return_dates: {return_dates[0]}–{return_dates[-1]}"
            )

            for iata in airport_codes:
                # Outbound: LON → iata
                for flight_date in outbound_dates:
                    for comp in COMPOSITIONS:
                        label = comp["label"]

                        if RESUME_MODE and already_collected(
                            supabase, run_id, LON, iata,
                            flight_date, comp["adults"], comp["children"], comp["infants"],
                        ):
                            log.info(f"skip (resume mode): LON→{iata} {flight_date} {label}")
                            continue

                        total += 1
                        time.sleep(API_DELAY_SECS)

                        try:
                            raw = crawlio_call(
                                origin=LON,
                                destination=iata,
                                date=flight_date,
                                adults=comp["adults"],
                                children=comp["children"],
                                infants=comp["infants"],
                            )
                            rows = parse_response(
                                raw, LON, iata, flight_date,
                                comp["adults"], comp["children"], comp["infants"],
                            )
                            ok, fail = insert_rows(supabase, run_id, rows)
                            inserted_rows += ok
                            log.info(
                                f"LON→{iata} {flight_date} {label}: {ok} rows inserted"
                                + (f" ({fail} failed)" if fail else "")
                            )
                            if fail:
                                failed += 1
                            else:
                                success += 1
                        except Exception as exc:
                            log.error(f"LON→{iata} {flight_date} {label}: {exc}")
                            failed += 1

                # Return: iata → LON
                for flight_date in return_dates:
                    for comp in COMPOSITIONS:
                        label = comp["label"]

                        if RESUME_MODE and already_collected(
                            supabase, run_id, iata, LON,
                            flight_date, comp["adults"], comp["children"], comp["infants"],
                        ):
                            log.info(f"skip (resume mode): {iata}→LON {flight_date} {label}")
                            continue

                        total += 1
                        time.sleep(API_DELAY_SECS)

                        try:
                            raw = crawlio_call(
                                origin=iata,
                                destination=LON,
                                date=flight_date,
                                adults=comp["adults"],
                                children=comp["children"],
                                infants=comp["infants"],
                            )
                            rows = parse_response(
                                raw, iata, LON, flight_date,
                                comp["adults"], comp["children"], comp["infants"],
                            )
                            ok, fail = insert_rows(supabase, run_id, rows)
                            inserted_rows += ok
                            log.info(
                                f"{iata}→LON {flight_date} {label}: {ok} rows inserted"
                                + (f" ({fail} failed)" if fail else "")
                            )
                            if fail:
                                failed += 1
                            else:
                                success += 1
                        except Exception as exc:
                            log.error(f"{iata}→LON {flight_date} {label}: {exc}")
                            failed += 1

    finally:
        finish_run(supabase, run_id, total, success, failed)
        log.info(
            f"pilot complete  total={total}  success={success}  failed={failed}  "
            f"rows_inserted={inserted_rows}"
        )


# ── Usage (Colab) ─────────────────────────────────────────────────────────────
# Import or run this file to define all functions, then call manually:
#
#   test_single_call()               # validate API + print raw response
#   main()                           # run a brand-new full October 2026 half-term pilot
#   main(resume_run_id="<uuid>")     # resume a run that crashed recently (see main()'s
#                                     # docstring for when this is/isn't appropriate)
