#!/usr/bin/env python3
"""
Holiday Smart — Round-trip baseline price collector (Crawlio via RapidAPI).

Makes one round-trip call per destination × composition (12 calls total) using
the Crawlio /api/v1/roundtrip endpoint. Stores only the cheapest result per call
in baseline_snapshots. Origin is always LHR (not LON — round-trip endpoint
requires a single IATA code, not a city code).

No run bookkeeping — baseline collection is lightweight and append-only.

Usage (Colab):
  # Cell 1: pip install requests supabase
  # Cell 2: paste this script
  # Cell 3: set env vars (RAPIDAPI_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  # Cell 4: run_baseline()

Environment variables required:
  RAPIDAPI_KEY              RapidAPI key for google-flights8
  NEXT_PUBLIC_SUPABASE_URL  or SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
"""

import os
import time
import json
import logging
from typing import Optional

import requests
from supabase import create_client, Client

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("run_baseline")

# ── Constants ─────────────────────────────────────────────────────────────────

RAPIDAPI_HOST = "google-flights8.p.rapidapi.com"
BASE_URL = f"https://{RAPIDAPI_HOST}/api/v1/roundtrip"

API_DELAY_SECS = 0.6

BASELINE_CONFIG = {
    'barcelona': {
        'primary_airport': 'BCN',
        'outbound_date': '2026-10-24',  # Saturday
        'return_date':   '2026-10-28',  # Wednesday (4 nights — city break)
    },
    'malta': {
        'primary_airport': 'MLA',
        'outbound_date': '2026-10-24',
        'return_date':   '2026-10-28',  # 4 nights — resort treated as city
    },
    'andalusian-corridor': {
        'primary_airport': 'AGP',
        'outbound_date': '2026-10-24',
        'return_date':   '2026-11-01',  # Sunday (8 nights — circuit)
    },
}

COMPOSITIONS = [
    {'adults': 1, 'children': 1, 'infants': 0, 'label': '1A+1C'},
    {'adults': 2, 'children': 1, 'infants': 0, 'label': '2A+1C'},
    {'adults': 2, 'children': 2, 'infants': 0, 'label': '2A+2C'},
    {'adults': 2, 'children': 0, 'infants': 1, 'label': '2A+1inf'},
]

AIRLINE_IATA = {
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

def crawlio_roundtrip(
    origin: str,
    destination: str,
    outbound_date: str,
    return_date: str,
    adults: int,
    children: int,
    infants: int = 0,
) -> dict:
    """
    Make one round-trip search call to Crawlio (google-flights8 on RapidAPI).
    Returns the raw response dict. Raises on HTTP or API error.
    """
    key = os.environ.get("RAPIDAPI_KEY")
    if not key:
        raise EnvironmentError("RAPIDAPI_KEY env var is not set")

    params = {
        "origin":         origin,
        "destination":    destination,
        "date":           outbound_date,
        "return_date":    return_date,
        "adults":         adults,
        "children":       children,
        "infants_on_lap": infants,
        "currency":       "GBP",
        "sort_by":        "price",
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


# ── Helpers ───────────────────────────────────────────────────────────────────

def lookup_airline_iata(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    iata = AIRLINE_IATA.get(name)
    if iata:
        return iata
    fallback = name[:2].upper()
    log.warning(f"Unknown airline name \"{name}\" — stored fallback \"{fallback}\". Add to AIRLINE_IATA.")
    return fallback


# ── Supabase ──────────────────────────────────────────────────────────────────

def get_supabase() -> Client:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise EnvironmentError(
            "Missing env vars: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) "
            "and SUPABASE_SERVICE_ROLE_KEY are both required."
        )
    return create_client(url, key)


def insert_baseline(supabase: Client, row: dict) -> None:
    resp = supabase.table("baseline_snapshots").insert(row).execute()
    if not resp.data and hasattr(resp, "error") and resp.error:
        raise RuntimeError(f"baseline_snapshots INSERT failed: {resp.error}")


# ── Single-call test ──────────────────────────────────────────────────────────

def test_single_call() -> None:
    """
    Fire one round-trip call — LHR→BCN, 2026-10-24 / 2026-10-28, 2A+2C — and print the raw response.
    Use this to validate API connectivity and response format before running the full baseline.
    """
    log.info("test_single_call: LHR→BCN 2026-10-24/2026-10-28 2A+2C")
    raw = crawlio_roundtrip(
        origin="LHR",
        destination="BCN",
        outbound_date="2026-10-24",
        return_date="2026-10-28",
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
        airline_name = (flights[0].get("airlines") or [None])[0] if flights else None
        log.info(
            f"Cheapest: price=£{first.get('price')}  "
            f"stops={first.get('stops')}  "
            f"duration={first.get('duration_min')}m  "
            f"airline={airline_name}"
        )


# ── Full baseline run ─────────────────────────────────────────────────────────

def run_baseline() -> None:
    """
    Collect round-trip baseline prices for all pilot destinations × compositions.
    3 destinations × 4 compositions = 12 API calls.
    Stores one row per call (cheapest result only) in baseline_snapshots.

    Call from a Colab cell: run_baseline()
    """
    supabase = get_supabase()

    total = success = failed = 0

    for slug, config in BASELINE_CONFIG.items():
        airport = config['primary_airport']
        outbound_date = config['outbound_date']
        return_date = config['return_date']

        for comp in COMPOSITIONS:
            label = comp['label']
            total += 1
            time.sleep(API_DELAY_SECS)

            try:
                raw = crawlio_roundtrip(
                    origin="LHR",
                    destination=airport,
                    outbound_date=outbound_date,
                    return_date=return_date,
                    adults=comp['adults'],
                    children=comp['children'],
                    infants=comp['infants'],
                )

                results = raw.get("results", [])

                if not results:
                    log.warning(f"[baseline] {slug} {airport} {label}: no results returned")
                    failed += 1
                    continue

                best_result = results[0]
                airline_name = (best_result.get("airlines") or [None])[0]
                airline_iata = lookup_airline_iata(airline_name)
                price = best_result.get("price")
                stops = best_result.get("stops", 0)
                duration_min = best_result.get("duration_min")

                row = {
                    "destination_slug":  slug,
                    "outbound_date":     outbound_date,
                    "return_date":       return_date,
                    "origin_iata":       "LHR",
                    "destination_iata":  airport,
                    "adults":            comp['adults'],
                    "children":          comp['children'],
                    "infants":           comp['infants'],
                    "party_total_gbp":   price,
                    "airline_iata":      airline_iata,
                    "stops":             stops,
                    "duration_min":      duration_min,
                    "raw_json":          {"result": best_result},
                }

                insert_baseline(supabase, row)
                log.info(
                    f"[baseline] {slug} {airport} {label}: "
                    f"£{price} ({airline_name}, {stops} stop{'s' if stops != 1 else ''})"
                )
                success += 1

            except Exception as exc:
                log.error(f"[baseline] {slug} {airport} {label}: {exc}")
                failed += 1

    log.info(f"baseline complete  total={total}  success={success}  failed={failed}")


# ── Usage (Colab) ─────────────────────────────────────────────────────────────
# Run this file as a cell to define all functions, then call manually:
#
#   test_single_call()   # validate API + print raw response
#   run_baseline()       # collect all 12 baseline prices
