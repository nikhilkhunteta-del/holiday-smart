import { supabase } from '../../lib/supabase';

export default async function handler(req, res) {
  const { data, error } = await supabase
    .from('borough_term_dates')
    .select('borough')
    .order('borough');

  if (error) {
    console.error('[/api/boroughs]', error);
    return res.status(500).json({ error: error.message });
  }

  const boroughs = [...new Set((data || []).map(r => r.borough).filter(Boolean))];
  res.status(200).json(boroughs);
}
