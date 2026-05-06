import { supabase } from '../../lib/supabase';

export default async function handler(req, res) {
  const { urn } = req.query;
  if (!urn) return res.status(400).json({ error: 'urn is required' });

  const { data, error } = await supabase
    .from('school_term_dates')
    .select('term_label, start_date, end_date, academic_year')
    .eq('urn', parseInt(urn, 10))
    .order('academic_year', { ascending: false });

  if (error) {
    console.error('[/api/term-dates]', error);
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json(data || []);
}
