(function () {
  const p = new URLSearchParams(window.location.search);

  const school  = p.get('school')  || null;
  const urn     = p.get('urn')     || null;
  const borough = p.get('borough') || null;
  const brk     = p.get('break')   || null;
  const start   = p.get('start')   || null;
  const end     = p.get('end')     || null;

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function fmtDate(str) {
    if (!str) return null;
    const d = new Date(str);
    return d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  function row(label, value) {
    const missing = !value || value.trim() === '';
    return '<div class="summary-row">' +
      '<span class="summary-label">' + label + '</span>' +
      '<span class="summary-value">' +
        (missing ? '<span class="missing-param">—</span>' : '<strong>' + value + '</strong>') +
      '</span>' +
    '</div>';
  }

  const dateStr = (start && end) ? (fmtDate(start) + ' – ' + fmtDate(end)) : null;

  const rows = [
    school  ? row('School',  school)  : null,
    !school && urn ? row('URN', urn)  : null,
    row('Borough', borough),
    row('Break',   brk),
    row('Dates',   dateStr),
  ].filter(Boolean).join('');

  document.getElementById('summary-rows').innerHTML =
    rows || '<p class="missing-param" style="font-size:14px">No parameters received.</p>';
})();
