/**
 * Minimal PostgREST client exposing ONLY the supabase-js calls weatherSnapshotJob.ts
 * makes (from().select().in(), .insert().select().single(), .update().eq(), .upsert()).
 *
 * Used when SUPABASE_SERVICE_ROLE_KEY is absent from the environment — i.e. in the cloud
 * sandbox, where the agent proxy injects `apikey` + `Authorization` onto requests to the
 * Supabase host AFTER they leave the process (see backfillWindowDerivation.ts header), so
 * supabase-js, which needs the literal key, cannot be used. Same transport as the 4a/4b
 * scripts. Everywhere the key IS in env (Vercel), the real supabase-js client is used.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

type Result<T> = { data: T | null; error: { message: string } | null };

async function call(url: string, path: string, init: RequestInit): Promise<Result<unknown>> {
  const res = await fetch(`${url}/rest/v1${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) return { data: null, error: { message: `PostgREST ${res.status}: ${text}` } };
  return { data: text ? JSON.parse(text) : null, error: null };
}

const enc = (pairs: Array<[string, string]>) => new URLSearchParams(pairs).toString();

export function createProxyRestClient(supabaseUrl: string): SupabaseClient {
  const from = (table: string) => ({
    select(columns: string) {
      let filters: Array<[string, string]> = [];
      const q = {
        in(col: string, values: string[]) {
          filters.push([col, `in.(${values.join(',')})`]);
          return q;
        },
        then(resolve: (r: Result<unknown>) => unknown, reject?: (e: unknown) => unknown) {
          return call(supabaseUrl, `/${table}?${enc([['select', columns.replace(/\s+/g, '')], ...filters])}`, {}).then(resolve, reject);
        },
      };
      return q;
    },
    insert(row: Record<string, unknown>) {
      const q = {
        select(columns: string) {
          return {
            async single(): Promise<Result<unknown>> {
              const r = await call(supabaseUrl, `/${table}?${enc([['select', columns]])}`, {
                method: 'POST',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify(row),
              });
              if (r.error) return r;
              const arr = r.data as unknown[];
              return { data: arr[0] ?? null, error: arr.length === 1 ? null : { message: `expected 1 row, got ${arr.length}` } };
            },
          };
        },
      };
      return q;
    },
    update(patch: Record<string, unknown>) {
      return {
        eq(col: string, val: string): Promise<Result<unknown>> {
          return call(supabaseUrl, `/${table}?${enc([[col, `eq.${val}`]])}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(patch),
          });
        },
      };
    },
    upsert(records: Array<Record<string, unknown>>, opts: { onConflict: string }): Promise<Result<unknown>> {
      return call(supabaseUrl, `/${table}?${enc([['on_conflict', opts.onConflict]])}`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(records),
      });
    },
  });
  return { from } as unknown as SupabaseClient;
}
