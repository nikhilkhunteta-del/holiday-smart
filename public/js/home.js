(function () {
  // ── DOM refs ──────────────────────────────────────────────────────────────
  const input          = document.getElementById('school-search');
  const dropdown       = document.getElementById('school-dropdown');
  const clearBtn       = document.getElementById('school-clear');
  const fallback       = document.getElementById('school-fallback');
  const connError      = document.getElementById('search-conn-error');
  const schoolSection  = document.getElementById('school-search-section');
  const boroughMode    = document.getElementById('borough-mode');
  const boroughSelect  = document.getElementById('borough-select');
  const boroughLink    = document.getElementById('use-borough-link');
  const breakSection   = document.getElementById('break-pills-section');
  const ctaBtn         = document.getElementById('cta-btn');

  // ── Break definitions keyed to term_label values in Supabase ─────────────
  const BREAKS = [
    { label: 'Autumn half-term',   key: 'autumn_half_term'  },
    { label: 'Christmas',          key: 'christmas_holiday' },
    { label: 'February half-term', key: 'spring_half_term'  },
    { label: 'Easter',             key: 'easter_holiday'    },
    { label: 'May half-term',      key: 'summer_half_term'  },
    { label: 'Summer',             key: 'summer_holiday'    },
  ];

  // ── Component state ───────────────────────────────────────────────────────
  const selected = {
    urn: null, school_name: null, borough: null,
    break_label: null, break_start: null, break_end: null,
  };
  let highlightIdx = -1;
  let searchTimer  = null;

  // ── CTA ───────────────────────────────────────────────────────────────────
  function updateCTAState() {
    ctaBtn.disabled = !(selected.urn || selected.borough) || !selected.break_label;
  }

  ctaBtn.addEventListener('click', () => {
    const p = new URLSearchParams({
      borough: selected.borough || '',
      break:   selected.break_label,
      start:   selected.break_start || '',
      end:     selected.break_end   || '',
    });
    if (selected.urn)         p.set('urn', selected.urn);
    if (selected.school_name) p.set('school', selected.school_name);
    window.location.href = '/results/flight-insights?' + p.toString();
  });

  // ── Break pills ───────────────────────────────────────────────────────────
  document.querySelectorAll('.break-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.break-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selected.break_label = pill.dataset.breakLabel;
      selected.break_start = pill.dataset.start || null;
      selected.break_end   = pill.dataset.end   || null;
      updateCTAState();

      const source = pill.dataset.source;
      if (source === 'borough' && selected.break_start) {
        const panel = document.getElementById('inset-reveal');
        panel.innerHTML =
          '<span class="inset-icon">📍</span>' +
          '<span>' + esc(selected.borough) + ' borough dates — confirm exact dates on your school website</span>';
        panel.hidden = false;
      } else if (source === 'school' && selected.urn && selected.break_start && selected.break_end) {
        loadInsetDay(selected.urn, selected.break_start, selected.break_end);
      } else {
        hideInsetReveal();
      }
    });
  });

  // ── School search ─────────────────────────────────────────────────────────
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(searchTimer);
    connError.hidden = true;
    if (q.length < 3) { closeDropdown(); fallback.hidden = true; return; }
    searchTimer = setTimeout(() => fetchSchools(q), 250);
  });

  async function fetchSchools(q) {
    try {
      const res = await fetch('/api/schools?q=' + encodeURIComponent(q));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      connError.hidden = true;
      if (!data || data.length === 0) { closeDropdown(); fallback.hidden = false; return; }
      fallback.hidden = true;
      renderDropdown(data);
    } catch (err) {
      console.error('[HolidaySmart] fetchSchools failed:', err);
      closeDropdown();
      fallback.hidden  = true;
      connError.hidden = false;
    }
  }

  function renderDropdown(schools) {
    highlightIdx = -1;
    dropdown.innerHTML = '';
    schools.forEach((school, i) => {
      const li = document.createElement('li');
      li.className = 'school-dropdown-item';
      li.setAttribute('role', 'option');
      li.setAttribute('id', 'school-opt-' + i);
      li.setAttribute('aria-selected', 'false');
      li.innerHTML =
        '<span class="item-name">' + esc(school.school_name) + '</span>' +
        '<span class="item-borough"> — ' + esc(school.borough) + '</span>';
      li.addEventListener('mousedown', e => { e.preventDefault(); pickSchool(school); });
      dropdown.appendChild(li);
    });
    dropdown.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown() {
    dropdown.hidden = true;
    dropdown.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    highlightIdx = -1;
  }

  async function pickSchool(school) {
    Object.assign(selected, {
      urn: school.urn, school_name: school.school_name, borough: school.borough,
      break_label: null, break_start: null, break_end: null,
    });
    input.value    = school.school_name;
    input.readOnly = true;
    input.classList.add('school-search-input--locked');
    clearBtn.hidden = false;
    closeDropdown();
    fallback.hidden = true;
    updateCTAState();
    await loadTermDates(school.urn);
  }

  // ── Clear ─────────────────────────────────────────────────────────────────
  clearBtn.addEventListener('click', () => {
    Object.assign(selected, {
      urn: null, school_name: null, borough: null,
      break_label: null, break_start: null, break_end: null,
    });
    input.value    = '';
    input.readOnly = false;
    input.classList.remove('school-search-input--locked');
    clearBtn.hidden     = true;
    breakSection.hidden = true;
    resetPills();
    updateCTAState();
    input.focus();
  });

  // ── Keyboard navigation ───────────────────────────────────────────────────
  input.addEventListener('keydown', e => {
    const items = [...dropdown.querySelectorAll('.school-dropdown-item')];
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      applyHighlight(Math.min(highlightIdx + 1, items.length - 1), items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      applyHighlight(Math.max(highlightIdx - 1, 0), items);
    } else if (e.key === 'Enter' && highlightIdx >= 0) {
      e.preventDefault();
      items[highlightIdx].dispatchEvent(new MouseEvent('mousedown'));
    } else if (e.key === 'Escape') {
      closeDropdown();
      fallback.hidden = true;
    }
  });

  function applyHighlight(idx, items) {
    items.forEach((item, i) => item.setAttribute('aria-selected', i === idx ? 'true' : 'false'));
    highlightIdx = idx;
    items[idx] && items[idx].scrollIntoView({ block: 'nearest' });
  }

  document.addEventListener('mousedown', e => {
    if (!input.closest('.school-search-wrap').contains(e.target)) closeDropdown();
  });

  // ── Borough fallback ──────────────────────────────────────────────────────
  boroughLink.addEventListener('click', async e => {
    e.preventDefault();
    try {
      const res  = await fetch('/api/boroughs');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const list = await res.json();
      list.forEach(borough => {
        const opt = document.createElement('option');
        opt.value = borough;
        opt.textContent = borough;
        boroughSelect.appendChild(opt);
      });
    } catch (err) {
      console.error('[HolidaySmart] borough list fetch failed:', err);
    }
    schoolSection.hidden = true;
    fallback.hidden      = true;
    boroughMode.hidden   = false;
  });

  boroughSelect.addEventListener('change', async () => {
    const borough = boroughSelect.value;
    Object.assign(selected, {
      urn: null, school_name: null, borough,
      break_label: null, break_start: null, break_end: null,
    });
    if (borough) {
      updateCTAState();
      await loadBoroughDates(borough);
    } else {
      breakSection.hidden = true;
      resetPills();
      updateCTAState();
    }
  });

  // ── Term date loading ─────────────────────────────────────────────────────
  async function loadTermDates(urn) {
    try {
      const [schoolRes, boroughRes] = await Promise.all([
        fetch('/api/term-dates?urn=' + encodeURIComponent(urn)),
        fetch('/api/borough-dates?borough=' + encodeURIComponent(selected.borough)),
      ]);
      const schoolRows  = schoolRes.ok  ? (await schoolRes.json()  || []) : [];
      const boroughRows = boroughRes.ok ? (await boroughRes.json() || []) : [];
      populatePills(buildUpcomingMap(schoolRows), buildUpcomingMap(boroughRows));
    } catch (err) {
      console.error('[HolidaySmart] loadTermDates failed:', err);
      populatePills({}, {});
    }
  }

  function buildUpcomingMap(rows) {
    const today = todayStr();
    const map = {};
    (rows || [])
      .filter(r => r.end_date >= today)
      .forEach(r => {
        if (!map[r.term_label] || r.start_date < map[r.term_label].start) {
          map[r.term_label] = { start: r.start_date, end: r.end_date };
        }
      });
    return map;
  }

  function populatePills(schoolMap, boroughMap) {
    boroughMap = boroughMap || {};
    const pills = document.querySelectorAll('.break-pill');

    const sorted = BREAKS.slice().sort((a, b) => {
      const da = schoolMap[a.key] || boroughMap[a.key];
      const db = schoolMap[b.key] || boroughMap[b.key];
      const sa = da ? da.start : '';
      const sb = db ? db.start : '';
      if (!sa && !sb) return 0;
      if (!sa) return 1;
      if (!sb) return -1;
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });

    sorted.forEach((brk, i) => {
      const pill        = pills[i];
      const schoolDates = schoolMap[brk.key];
      const dates       = schoolDates || boroughMap[brk.key];
      pill.hidden = false;
      pill.classList.remove('active');
      pill.dataset.breakLabel = brk.label;
      if (schoolDates) {
        pill.dataset.source = 'school';
        pill.dataset.start  = schoolDates.start;
        pill.dataset.end    = schoolDates.end;
        pill.innerHTML =
          '<span class="pill-name">' + esc(brk.label) + '</span>' +
          '<span class="pill-dates">' + fmtRange(schoolDates.start, schoolDates.end) + '</span>';
      } else if (dates) {
        pill.dataset.source = 'borough';
        pill.dataset.start  = dates.start;
        pill.dataset.end    = dates.end;
        pill.innerHTML =
          '<span class="pill-name">' + esc(brk.label) + '</span>' +
          '<span class="pill-dates">' + fmtRange(dates.start, dates.end) + '</span>';
      } else {
        pill.dataset.source = 'none';
        pill.dataset.start  = '';
        pill.dataset.end    = '';
        pill.innerHTML = '<span class="pill-name">' + esc(brk.label) + '</span>';
      }
    });

    selected.break_label = null;
    selected.break_start = null;
    selected.break_end   = null;
    hideInsetReveal();
    breakSection.hidden = false;
    updateCTAState();
  }

  async function loadBoroughDates(borough) {
    try {
      const res = await fetch('/api/borough-dates?borough=' + encodeURIComponent(borough));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json() || [];
      populatePills(buildUpcomingMap(rows));
    } catch (err) {
      console.error('[HolidaySmart] loadBoroughDates failed:', err);
      populatePills({});
    }
  }

  function resetPills() {
    const pills = document.querySelectorAll('.break-pill');
    BREAKS.forEach((brk, i) => {
      const pill = pills[i];
      pill.hidden = false;
      pill.classList.remove('active');
      pill.dataset.start = '';
      pill.dataset.end   = '';
      pill.innerHTML = '<span class="pill-name">' + esc(brk.label) + '</span>';
    });
    selected.break_label = null;
    selected.break_start = null;
    selected.break_end   = null;
    hideInsetReveal();
  }

  // ── Inset day reveal ──────────────────────────────────────────────────────
  async function loadInsetDay(urn, breakStart, breakEnd) {
    hideInsetReveal();
    try {
      const res = await fetch(
        '/api/inset-days?urn='   + encodeURIComponent(urn) +
        '&start='                + encodeURIComponent(breakStart) +
        '&end='                  + encodeURIComponent(breakEnd)
      );
      if (!res.ok) return;
      const days = await res.json();
      if (!days || !days.length) return;

      const before = days.filter(d => d.date <  breakStart);
      const after  = days.filter(d => d.date >  breakEnd);
      const inside = days.filter(d => d.date >= breakStart && d.date <= breakEnd);

      const panel = document.getElementById('inset-reveal');
      if (before.length) {
        // Scenario B: earliest before-day maximises extension
        const day = before[0].date;
        panel.innerHTML =
          '<span class="inset-icon">⚡</span>' +
          '<span>Inset day ' + fmtInsetDate(day) + ' — fly earlier and save</span>';
        panel.hidden = false;
      } else if (after.length) {
        // Scenario C: latest after-day maximises extension
        const day = after[after.length - 1].date;
        panel.innerHTML =
          '<span class="inset-icon">⚡</span>' +
          '<span>Inset day ' + fmtInsetDate(day) + ' — return later and save</span>';
        panel.hidden = false;
      } else if (inside.length) {
        // Scenario A: list dates (first 3, then +N more)
        const n       = inside.length;
        const M       = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const fmtD    = s => { const d = new Date(s + 'T00:00:00'); return d.getDate() + ' ' + M[d.getMonth()]; };
        const shown   = inside.slice(0, 3).map(d => fmtD(d.date)).join(', ');
        const extra   = n > 3 ? ' +' + (n - 3) + ' more' : '';
        panel.innerHTML =
          '<span class="inset-icon">ℹ️</span>' +
          '<span>Includes <strong>' + n + '</strong> inset day' + (n > 1 ? 's' : '') +
          ' (' + shown + extra + ') — children are off the full period</span>';
        panel.hidden = false;
      }
    } catch (err) {
      console.error('[HolidaySmart] loadInsetDay failed:', err);
    }
  }

  function hideInsetReveal() {
    const panel = document.getElementById('inset-reveal');
    if (panel) { panel.hidden = true; panel.innerHTML = ''; }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  // "27 Oct – 31 Oct 2026"  or  "19 Dec 2026 – 3 Jan 2027" for year-boundary breaks
  function fmtRange(startStr, endStr) {
    if (!startStr || !endStr) return '';
    const s  = new Date(startStr + 'T00:00:00');
    const e  = new Date(endStr   + 'T00:00:00');
    const M  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const sy = s.getFullYear();
    const ey = e.getFullYear();
    const sf = s.getDate() + ' ' + M[s.getMonth()] + (sy !== ey ? ' ' + sy : '');
    const ef = e.getDate() + ' ' + M[e.getMonth()] + ' ' + ey;
    return sf + ' – ' + ef;
  }

  // "Fri 24 Oct"
  function fmtInsetDate(str) {
    if (!str) return '';
    const d    = new Date(str + 'T00:00:00');
    const Days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const M    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return Days[d.getDay()] + ' ' + d.getDate() + ' ' + M[d.getMonth()];
  }

  function daysBetweenInclusive(dateStr1, dateStr2) {
    const d1 = new Date(dateStr1 + 'T00:00:00');
    const d2 = new Date(dateStr2 + 'T00:00:00');
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
  }

  function esc(str) {
    return String(str)
      .replace(/&/g,  '&amp;').replace(/</g, '&lt;')
      .replace(/>/g,  '&gt;').replace(/"/g, '&quot;');
  }
})();
