import { supabase } from '../../lib/supabase';

export default async function handler(req, res) {
  const { urn, break_start, break_end } = req.query;
  if (!urn || !break_start || !break_end) {
    return res.status(400).json({ error: 'urn, break_start and break_end required' });
  }

  const windowStart = new Date(break_start + 'T00:00:00');
  windowStart.setDate(windowStart.getDate() - 7);

  const windowEnd = new Date(break_end + 'T00:00:00');
  windowEnd.setDate(windowEnd.getDate() + 7);

  const { data, error } = await supabase
    .from('inset_days')
    .select('date')
    .eq('urn', urn)
    .gte('date', windowStart.toISOString().slice(0, 10))
    .lte('date', windowEnd.toISOString().slice(0, 10))
    // exclude days that fall within the break itself
    .or('date.lt.' + break_start + ',date.gt.' + break_end)
    .order('date', { ascending: true });

  if (error) {
    console.error('[/api/inset-days]', error);
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json(data || []);
}
