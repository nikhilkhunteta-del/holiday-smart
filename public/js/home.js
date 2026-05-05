(function () {
  // ── DOM refs ──────────────────────────────────────────────────────────────
  const input         = document.getElementById('school-search');
  const dropdown      = document.getElementById('school-dropdown');
  const clearBtn      = document.getElementById('school-clear');
  const fallback      = document.getElementById('school-fallback');
  const connError     = document.getElementById('search-conn-error');
  const schoolSection = document.getElementById('school-search-section');
  const boroughMode   = document.getElementById('borough-mode');
  const boroughSelect = document.getElementById('borough-select');
  const boroughLink   = document.getElementById('use-borough-link');
  const breakSection  = document.getElementById('break-pills-section');
  const ctaBtn        = document.getElementById('cta-btn');

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
    window.location.href = '/results?' + p.toString();
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
    await loadTermDates('school', school.urn);
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
      await loadTermDates('borough', borough);
    } else {
      breakSection.hidden = true;
      resetPills();
      updateCTAState();
    }
  });

  // ── Term date loading ─────────────────────────────────────────────────────
  async function loadTermDates(type, id) {
    const acYear = academicYear();
    let rows = null;

    if (type === 'school') {
      rows = await fetchTermRows('school', id, acYear);
      if (!rows && selected.borough) {
        rows = await fetchTermRows('borough', selected.borough, acYear);
      }
    } else {
      rows = await fetchTermRows('borough', id, acYear);
    }

    populatePills(buildTermMap(rows));
  }

  async function fetchTermRows(type, id, acYear) {
    try {
      const endpoint = type === 'school'
        ? '/api/term-dates?urn=' + encodeURIComponent(id)
        : '/api/borough-dates?borough=' + encodeURIComponent(id);
      const res  = await fetch(endpoint);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const all  = await res.json();
      if (!all || all.length === 0) return null;

      const curr = all.filter(r => r.academic_year === acYear);
      if (curr.length > 0) return curr;

      // Fall back to most recent academic year
      const latest = all[0].academic_year;
      return all.filter(r => r.academic_year === latest);
    } catch (err) {
      console.error('[HolidaySmart] fetchTermRows(' + type + ') failed:', err);
      return null;
    }
  }

  function buildTermMap(rows) {
    if (!rows) return {};
    return Object.fromEntries(
      rows.map(r => [r.term_label, { start: r.start_date, end: r.end_date }])
    );
  }

  function populatePills(termMap) {
    const pills = document.querySelectorAll('.break-pill');
    BREAKS.forEach((brk, i) => {
      const pill  = pills[i];
      const dates = termMap[brk.key];
      pill.classList.remove('active');
      pill.dataset.start = dates && dates.start ? dates.start : '';
      pill.dataset.end   = dates && dates.end   ? dates.end   : '';
      pill.innerHTML = (dates && dates.start && dates.end)
        ? '<span class="pill-name">' + esc(brk.label) + '</span><span class="pill-dates">' + fmtDate(dates.start) + ' – ' + fmtDate(dates.end) + '</span>'
        : '<span class="pill-name">' + esc(brk.label) + '</span>';
    });
    selected.break_label = null;
    selected.break_start = null;
    selected.break_end   = null;
    breakSection.hidden  = false;
    updateCTAState();
  }

  function resetPills() {
    const pills = document.querySelectorAll('.break-pill');
    BREAKS.forEach((brk, i) => {
      const pill = pills[i];
      pill.classList.remove('active');
      pill.dataset.start = '';
      pill.dataset.end   = '';
      pill.innerHTML = '<span class="pill-name">' + esc(brk.label) + '</span>';
    });
    selected.break_label = null;
    selected.break_start = null;
    selected.break_end   = null;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function academicYear() {
    const now = new Date();
    const y   = now.getFullYear();
    return now.getMonth() >= 8 ? (y + '-' + (y + 1)) : ((y - 1) + '-' + y);
  }

  function fmtDate(str) {
    if (!str) return '';
    const d = new Date(str);
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate() + ' ' + M[d.getMonth()];
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
