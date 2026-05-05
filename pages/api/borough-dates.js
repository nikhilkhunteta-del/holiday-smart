import { supabase } from '../../lib/supabase';

export default async function handler(req, res) {
  const { borough } = req.query;
  if (!borough) return res.status(400).json({ error: 'borough is required' });

  const { data, error } = await supabase
    .from('borough_term_dates')
    .select('term_label, start_date, end_date, academic_year')
    .eq('borough', borough)
    .order('academic_year', { ascending: false });

  if (error) {
    console.error('[/api/borough-dates]', error);
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json(data || []);
}
