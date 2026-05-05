import { supabase } from '../../lib/supabase';

export default async function handler(req, res) {
  const q = (req.query.q || '').trim();
  if (q.length < 3) {
    return res.status(400).json({ error: 'q must be at least 3 characters' });
  }

  const { data, error } = await supabase
    .from('school_term_dates')
    .select('urn, school_name, borough')
    .ilike('school_name', `%${q}%`)
    .limit(8);

  if (error) {
    console.error('[/api/schools]', error);
    return res.status(500).json({ error: error.message });
  }

  // Deduplicate by urn in case of multiple term rows per school
  const seen = new Set();
  const unique = (data || []).filter(r => {
    if (seen.has(r.urn)) return false;
    seen.add(r.urn);
    return true;
  });

  res.status(200).json(unique);
}
