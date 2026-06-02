#!/usr/bin/env python3
"""
Holiday Smart — Data diagnostic for Feature 3 (All-in Cost).

Checks:
  1. Most recent cross-sectional run_id and its fare_snapshots row counts
     for pilot destinations (barcelona, andalusian-corridor, malta).
     Breaks down by result_bucket, departure_date, airline_iata, composition.
  2. Which airlines from fare_snapshots are missing from airline_baggage_fees.

Usage (Colab):
  # Cell 1: pip install supabase
  # Cell 2: paste this script
  # Cell 3:
  #   import os
  #   os.environ['NEXT_PUBLIC_SUPABASE_URL'] = '...'
  #   os.environ['SUPABASE_SERVICE_ROLE_KEY'] = '...'
  #   main()
"""

import os
from supabase import create_client

def main():
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise EnvironmentError("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

    db = create_client(url, key)

    # ── 1. Latest cross-sectional run ─────────────────────────────────────────

    run = (
        db.table("snapshot_runs")
          .select("id, started_at, completed_at, total_calls, success_calls, failed_calls")
          .eq("run_type", "cross_sectional")
          .order("started_at", desc=True)
          .limit(3)
          .execute()
    )

    print("=" * 60)
    print("RECENT CROSS-SECTIONAL RUNS (latest 3)")
    print("=" * 60)
    for r in run.data:
        print(f"  id:           {r['id']}")
        print(f"  started_at:   {r['started_at']}")
        print(f"  completed_at: {r['completed_at']}")
        print(f"  calls:        total={r['total_calls']}  ok={r['success_calls']}  fail={r['failed_calls']}")
        print()

    if not run.data:
        print("  !! No cross-sectional runs found.")
        return

    run_id = run.data[0]["id"]
    print(f"Using run_id: {run_id}\n")

    # ── 2. Destination airport pools ──────────────────────────────────────────

    dest_rows = (
        db.table("destinations")
          .select("id, slug")
          .in_("slug", ["barcelona", "andalusian-corridor", "malta"])
          .execute()
    )
    dest_map = {r["slug"]: r["id"] for r in dest_rows.data}

    airport_pools = {}
    for slug, dest_id in dest_map.items():
        ap = (
            db.table("destination_airports")
              .select("iata_code")
              .eq("destination_id", dest_id)
              .eq("excluded", False)
              .execute()
        )
        airport_pools[slug] = [r["iata_code"] for r in ap.data]

    print("=" * 60)
    print("DESTINATION AIRPORT POOLS")
    print("=" * 60)
    for slug, pool in airport_pools.items():
        print(f"  {slug}: {pool}")
    print()

    all_dest_airports = [iata for pool in airport_pools.values() for iata in pool]

    # ── 3. fare_snapshots row counts for this run ─────────────────────────────

    LONDON_ORIGINS = ["LHR", "LGW", "STN", "LTN", "LCY"]

    # All rows for this run touching pilot destinations (either direction)
    snap = (
        db.table("fare_snapshots")
          .select(
              "origin_iata, destination_iata, departure_date, result_bucket, "
              "airline_iata, adults, children, infants"
          )
          .eq("run_id", run_id)
          .execute()
    )

    rows = snap.data
    print(f"Total fare_snapshots rows for this run: {len(rows)}")

    # Filter to pilot-relevant rows (either outbound or return legs)
    pilot_rows = [
        r for r in rows
        if (r["origin_iata"] in LONDON_ORIGINS and r["destination_iata"] in all_dest_airports)
        or (r["destination_iata"] in LONDON_ORIGINS and r["origin_iata"] in all_dest_airports)
    ]
    print(f"Pilot-destination rows (both directions):  {len(pilot_rows)}")

    outbound_rows = [
        r for r in pilot_rows
        if r["origin_iata"] in LONDON_ORIGINS and r["destination_iata"] in all_dest_airports
    ]
    return_rows = [
        r for r in pilot_rows
        if r["destination_iata"] in LONDON_ORIGINS and r["origin_iata"] in all_dest_airports
    ]
    print(f"  Outbound (LON → dest): {len(outbound_rows)}")
    print(f"  Return   (dest → LON): {len(return_rows)}")

    best_outbound = [r for r in outbound_rows if r["result_bucket"] == "best"]
    print(f"  result_bucket='best' outbound rows: {len(best_outbound)}")
    print()

    # ── 4. Breakdown by result_bucket ─────────────────────────────────────────

    print("=" * 60)
    print("OUTBOUND ROWS — result_bucket breakdown")
    print("=" * 60)
    from collections import Counter
    bucket_counts = Counter(r["result_bucket"] for r in outbound_rows)
    for bucket, count in sorted(bucket_counts.items()):
        print(f"  {bucket}: {count}")
    print()

    # ── 5. Breakdown by departure_date (outbound, best bucket only) ───────────

    print("=" * 60)
    print("OUTBOUND 'best' ROWS — by departure_date")
    print("=" * 60)
    date_counts = Counter(r["departure_date"] for r in best_outbound)
    for d in sorted(date_counts):
        print(f"  {d}: {date_counts[d]} rows")
    print()

    # ── 6. Breakdown by composition (outbound, best) ──────────────────────────

    print("=" * 60)
    print("OUTBOUND 'best' ROWS — by composition")
    print("=" * 60)
    comp_counts = Counter(
        f"{r['adults']}A+{r['children']}C+{r['infants']}inf"
        for r in best_outbound
    )
    for comp, count in sorted(comp_counts.items()):
        print(f"  {comp}: {count}")
    print()

    # ── 7. Breakdown by destination (outbound, best) ──────────────────────────

    print("=" * 60)
    print("OUTBOUND 'best' ROWS — by destination airport")
    print("=" * 60)
    dest_counts = Counter(r["destination_iata"] for r in best_outbound)
    for dest, count in sorted(dest_counts.items()):
        slug = next((s for s, pool in airport_pools.items() if dest in pool), "?")
        print(f"  {dest} ({slug}): {count}")
    print()

    # ── 8. October 2026 window check ─────────────────────────────────────────

    oct_best = [r for r in best_outbound if str(r["departure_date"]).startswith("2026-10")]
    print("=" * 60)
    print("OCTOBER 2026 OUTBOUND 'best' ROWS")
    print("=" * 60)
    print(f"  Count: {len(oct_best)}")
    if oct_best:
        dates = sorted(set(r["departure_date"] for r in oct_best))
        print(f"  Date range: {dates[0]} → {dates[-1]}")
        print(f"  Distinct dates: {len(dates)}")
    print()

    # ── 9. Airline coverage — fare_snapshots vs airline_baggage_fees ──────────

    print("=" * 60)
    print("AIRLINE COVERAGE CHECK")
    print("=" * 60)

    airlines_in_snap = set(r["airline_iata"] for r in pilot_rows if r["airline_iata"])
    print(f"Distinct airlines in fare_snapshots (pilot rows): {sorted(airlines_in_snap)}")

    baggage = db.table("airline_baggage_fees").select("airline_iata").execute()
    airlines_in_baggage = set(r["airline_iata"] for r in baggage.data)
    print(f"Airlines in airline_baggage_fees: {sorted(airlines_in_baggage)}")

    missing = airlines_in_snap - airlines_in_baggage
    covered = airlines_in_snap & airlines_in_baggage
    print()
    print(f"Covered ({len(covered)}): {sorted(covered)}")
    print(f"MISSING ({len(missing)}): {sorted(missing)}")

    if missing:
        # Show how many rows are affected per missing airline
        print()
        print("Rows per missing airline (pilot destinations, both directions):")
        missing_counts = Counter(
            r["airline_iata"]
            for r in pilot_rows
            if r["airline_iata"] in missing
        )
        for airline, count in sorted(missing_counts.items()):
            print(f"  {airline}: {count} rows")
    print()

    # ── 10. Summary verdict ───────────────────────────────────────────────────

    print("=" * 60)
    print("SUMMARY VERDICT")
    print("=" * 60)
    if len(oct_best) == 0:
        print("  !! FAIL: No October 2026 'best' outbound rows — function cannot be exercised.")
    elif len(oct_best) < 20:
        print(f"  WARN: Only {len(oct_best)} October 'best' outbound rows — thin data.")
    else:
        print(f"  OK: {len(oct_best)} October 2026 'best' outbound rows.")

    if missing:
        print(f"  WARN: {len(missing)} airline(s) in snapshots have no baggage data: {sorted(missing)}")
    else:
        print("  OK: All snapshot airlines covered in airline_baggage_fees.")


if __name__ == "__main__":
    main()
