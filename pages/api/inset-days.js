import { supabase } from '../../lib/supabase';

export default async function handler(req, res) {
  const { urn, start, end } = req.query;
  console.log('[/api/inset-days] urn=%s start=%s end=%s', urn, start, end);
  if (!urn || !start || !end) {
    return res.status(400).json({ error: 'urn, start and end required' });
  }

  const windowStart = new Date(start + 'T00:00:00');
  windowStart.setDate(windowStart.getDate() - 7);

  const windowEnd = new Date(end + 'T00:00:00');
  windowEnd.setDate(windowEnd.getDate() + 7);

  const { data, error } = await supabase
    .from('school_inset_days')
    .select('date')
    .eq('urn', urn)
    .gte('date', windowStart.toISOString().slice(0, 10))
    .lte('date', windowEnd.toISOString().slice(0, 10))
    .order('date', { ascending: true });

  if (error) {
    console.error('[/api/inset-days]', error);
    return res.status(500).json({ error: error.message });
  }

  const rows = data || [];
  res.setHeader('X-Debug-Count', rows.length);
  res.status(200).json(rows);
}
