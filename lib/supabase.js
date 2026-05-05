import { createClient } from '@supabase/supabase-js';

// Server-side only — never imported by browser code
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
