import { createClient } from '@supabase/supabase-js';

// Server-only Supabase client using the service role key.
// Never import this file from client components or browser code.
//
// Every request is sent with cache: 'no-store'. Next.js 14 otherwise stores each Supabase
// response in its Data Cache for a year (even under `dynamic = 'force-dynamic'`), and on
// Vercel that cache outlives deployments — so fares, and weather rows written after a page
// was first visited, were never seen again. With no-store every read hits the database on
// every visit and nothing is kept between visits.
export const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: 'no-store' }),
    },
  },
);
