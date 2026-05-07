import { supabase } from '../../lib/supabase';

export default async function handler(req, res) {
  const q = (req.query.q || '').trim();
  if (q.length < 3) {
    return res.status(400).json({ error: 'q must be at least 3 characters' });
  }

  const { data, error } = await supabase
    .from('all_schools')
    .select('urn, school_name, borough')
    .ilike('school_name', `%${q}%`)
    .limit(8);

  if (error) {
    console.error('[/api/schools]', error);
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json(data || []);
}
