import { supabase } from '../../lib/supabase';

export default async function handler(req, res) {
  const { urn, break_start } = req.query;
  if (!urn || !break_start) return res.status(400).json({ error: 'urn and break_start required' });

  const start = new Date(break_start + 'T00:00:00');
  const windowStart = new Date(start);
  windowStart.setDate(windowStart.getDate() - 3);

  const { data, error } = await supabase
    .from('inset_days')
    .select('date')
    .eq('urn', urn)
    .gte('date', windowStart.toISOString().slice(0, 10))
    .lt('date', break_start)
    .order('date', { ascending: false }); // closest to break start first

  if (error) {
    console.error('[/api/inset-days]', error);
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json(data || []);
}
