#!/usr/bin/env python3
"""
Holiday Smart — Pilot flight snapshot runner (Crawlio via RapidAPI).

Reads airport pools from destination_airports table (NOT destination_legs — that table
no longer exists). Uses LON city code for all London-side queries.
Runs 4 family compositions per call: 1A+1C, 2A+1C, 2A+2C, 2A+1inf.
Pilot scope: barcelona, andalusian-corridor, malta. October 2026 half-term only.

Usage (Colab):
  # Run this file as a cell to define all functions, then call manually:
  test_single_call()   # validate API key + print raw response
  main()               # run full pilot and insert results into fare_snapshots

Requirements:
  pip install requests supabase

Environment variables required:
  RAPIDAPI_KEY              RapidAPI key for google-flights8
  NEXT_PUBLIC_SUPABASE_URL  or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
"""

import os
import re
import time
import json
import base64
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

# October 2026 half-term — 12 outbound date candidates (window ±3 days).
# Same date range used for return leg queries.
OCTOBER_2026_DATES = [
    str(date(2026, 10, 22) + timedelta(days=i))
    for i in range(12)   # 2026-10-22 through 2026-11-02
]
WINDOW_LABEL = "2026-10-halfterm"

# 4 standard family compositions.
COMPOSITIONS = [
    {"adults": 1, "children": 1, "infants": 0, "label": "1A+1C"},
    {"adults": 2, "children": 1, "infants": 0, "label": "2A+1C"},
    {"adults": 2, "children": 2, "infants": 0, "label": "2A+2C"},
    {"adults": 2, "children": 0, "infants": 1, "label": "2A+1inf"},
]

API_DELAY_S = 0.3   # delay between calls to stay within rate limits

# ── Crawlio API ───────────────────────────────────────────────────────────────

def crawlio_call(
    origin: str,
    destination: str,
    flight_date: str,
    adults: int,
    children: int,
    infants: int,
) -> dict:
    """
    Make one one-way flight search call to Crawlio (google-flights8 on RapidAPI).
    Returns the raw response dict. Raises on HTTP or API error.
    """
    key = os.environ.get("RAPIDAPI_KEY")
    if not key:
        raise EnvironmentError("RAPIDAPI_KEY env var is not set")

    params = {
        "departure_id":  origin,
        "arrival_id":    destination,
        "outbound_date": flight_date,
        "type":          2,          # 2 = one-way
        "adults":        adults,
        "children":      children,
        "infants_on_lap": infants,
        "currency":      "GBP",
        "hl":            "en",
        "sort_by":       1,          # 1 = price ascending
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

def extract_airline_iata(flight_url: str) -> Optional[str]:
    """
    Base64-decode the tfu URL param to extract the IATA airline code.
    e.g. tfu=EgZGUjc4MDc → decoded bytes contain 'FR7807' → returns 'FR'
    """
    try:
        parsed = urlparse(flight_url)
        params = parse_qs(parsed.query)
        tfu_list = params.get("tfu", [])
        if not tfu_list:
            return None
        tfu = tfu_list[0]
        # Add padding
        padded = tfu + "=" * ((4 - len(tfu) % 4) % 4)
        decoded = base64.b64decode(padded).decode("latin-1")
        match = re.search(r"([A-Z][A-Z0-9])\d{2,5}", decoded)
        return match.group(1) if match else None
    except Exception:
        return None


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
    flight_date: str,
    adults: int,
    children: int,
    infants: int,
) -> list[dict]:
    """
    Parse a Crawlio response into a list of fare_snapshots-shaped row dicts.
    Caller must add: run_id, snapshot_type.
    """
    flights = raw.get("flights", [])
    results = raw.get("results", [])

    rows = []
    best_rank = 1
    other_rank = 1

    for i in range(min(len(flights), len(results))):
        flight = flights[i]
        result = results[i]
        if not flight or not result:
            continue

        seg = (result.get("segments") or [{}])[0]
        is_best = flight.get("is_best", False)
        url = flight.get("url", "")

        dep_time = to_hhmm(seg.get("departure"))
        arr_time = to_hhmm(seg.get("arrival"))

        # Skip rows where times are null if DB columns are still NOT NULL.
        # Remove this guard once departure_time / arrival_time are made nullable.
        if dep_time is None or arr_time is None:
            log.debug("Skipping codeshare row with null departure/arrival time")
            continue

        rows.append({
            "origin_iata":      (seg.get("from") or origin)[:3],
            "destination_iata": (seg.get("to")   or destination)[:3],
            "departure_date":   flight_date,
            "flight_number":    None,
            "airline_iata":     extract_airline_iata(url),
            "departure_time":   dep_time,
            "arrival_time":     arr_time,
            "duration_minutes": result.get("duration_min"),
            "stops":            result.get("stops", 0),
            "aircraft_type":    seg.get("plane"),
            "is_overnight":     is_overnight(seg.get("departure"), seg.get("arrival")),
            "adults":           adults,
            "children":         children,
            "infants":          infants,
            "party_total_gbp":  result.get("price"),
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


def finish_run(supabase: Client, run_id: str, total: int, success: int, failed: int) -> None:
    from datetime import datetime, timezone
    supabase.table("snapshot_runs").update({
        "completed_at":  datetime.now(timezone.utc).isoformat(),
        "total_calls":   total,
        "success_calls": success,
        "failed_calls":  failed,
    }).eq("id", run_id).execute()


def load_destination_pools(supabase: Client) -> dict[str, list[str]]:
    """
    Returns {slug: [iata_code, ...]} for pilot destinations.
    Reads from destination_airports — destination_legs no longer exists.
    """
    dest_resp = (
        supabase.table("destinations")
        .select("id, slug")
        .in_("slug", PILOT_SLUGS)
        .execute()
    )
    dests = dest_resp.data or []
    log.info(f"destinations: {len(dests)} row(s)")

    if not dests:
        log.warning(f"No destinations matched slugs: {PILOT_SLUGS}")
        return {}

    dest_id_to_slug = {d["id"]: d["slug"] for d in dests}
    dest_ids = list(dest_id_to_slug.keys())

    airport_resp = (
        supabase.table("destination_airports")
        .select("destination_id, iata_code")
        .in_("destination_id", dest_ids)
        .eq("excluded", False)
        .execute()
    )
    airports = airport_resp.data or []
    log.info(f"destination_airports: {len(airports)} row(s)")

    pools: dict[str, list[str]] = {}
    for row in airports:
        slug = dest_id_to_slug.get(row["destination_id"])
        if slug:
            pools.setdefault(slug, []).append(row["iata_code"])

    for slug, codes in pools.items():
        log.info(f"  {slug}: pool = {codes}")

    return pools


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
        flight_date="2026-10-25",
        adults=2,
        children=2,
        infants=0,
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

def main() -> None:
    """
    Run the full October 2026 half-term pilot.
    Destinations: barcelona, andalusian-corridor, malta.
    Dates: 2026-10-22 – 2026-11-02 (12 dates).
    Compositions: 1A+1C, 2A+1C, 2A+2C, 2A+1inf.
    Directions: outbound (LON → airport) + return (airport → LON).

    Call from a Colab cell: main()
    """
    supabase = get_supabase()
    pools = load_destination_pools(supabase)

    if not pools:
        log.error("No airport pools — seed destinations and destination_airports first.")
        return

    run_id = start_run(supabase, [WINDOW_LABEL])

    total = success = failed = 0
    inserted_rows = 0

    try:
        for slug, airport_codes in pools.items():
            log.info(f"destination: {slug}  airports: {airport_codes}")

            for iata in airport_codes:
                for flight_date in OCTOBER_2026_DATES:
                    for comp in COMPOSITIONS:
                        label = comp["label"]

                        for direction, origin, destination in [
                            ("outbound", LON,  iata),
                            ("return",   iata, LON),
                        ]:
                            total += 1
                            time.sleep(API_DELAY_S)

                            try:
                                raw = crawlio_call(
                                    origin=origin,
                                    destination=destination,
                                    flight_date=flight_date,
                                    adults=comp["adults"],
                                    children=comp["children"],
                                    infants=comp["infants"],
                                )
                                rows = parse_response(
                                    raw, origin, destination, flight_date,
                                    comp["adults"], comp["children"], comp["infants"],
                                )
                                ok, fail = insert_rows(supabase, run_id, rows)
                                inserted_rows += ok
                                log.info(
                                    f"{origin}→{destination} {flight_date} {label}: "
                                    f"{ok} rows inserted"
                                    + (f" ({fail} failed)" if fail else "")
                                )
                                if fail:
                                    failed += 1
                                else:
                                    success += 1
                            except Exception as exc:
                                log.error(
                                    f"{origin}→{destination} {flight_date} {label}: {exc}"
                                )
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
#   test_single_call()   # validate API + print raw response
#   main()               # run full October 2026 half-term pilot
