import { useState, useRef, useCallback } from 'react';
import Head from 'next/head';
import BreakCalendarReveal from '../components/landing/BreakCalendarReveal';

const BREAKS = [
  { label: 'Autumn half-term',   key: 'autumn_half_term'  },
  { label: 'Christmas',          key: 'christmas_holiday' },
  { label: 'February half-term', key: 'spring_half_term'  },
  { label: 'Easter',             key: 'easter_holiday'    },
  { label: 'May half-term',      key: 'summer_half_term'  },
  { label: 'Summer',             key: 'summer_holiday'    },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
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

function fmtRange(startStr, endStr) {
  if (!startStr || !endStr) return '';
  const s = new Date(startStr + 'T00:00:00');
  const e = new Date(endStr   + 'T00:00:00');
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const sy = s.getFullYear(), ey = e.getFullYear();
  const sf = s.getDate() + ' ' + M[s.getMonth()] + (sy !== ey ? ' ' + sy : '');
  const ef = e.getDate() + ' ' + M[e.getMonth()] + ' ' + ey;
  return sf + ' – ' + ef;
}

export default function Home() {
  // ── School search ─────────────────────────────────────────────────────────
  const [query,        setQuery]        = useState('');
  const [dropItems,    setDropItems]    = useState([]);
  const [dropOpen,     setDropOpen]     = useState(false);
  const [hlIdx,        setHlIdx]        = useState(-1);
  const [connError,    setConnError]    = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [lockedSchool, setLockedSchool] = useState(null); // { urn, schoolName, borough }
  const searchTimer = useRef(null);

  // ── Borough mode ──────────────────────────────────────────────────────────
  const [boroughMode,     setBoroughMode]     = useState(false);
  const [boroughs,        setBoroughs]        = useState([]);
  const [selectedBorough, setSelectedBorough] = useState('');

  // ── Break pills ───────────────────────────────────────────────────────────
  const [pills,          setPills]          = useState(BREAKS.map(b => ({ ...b, start: '', end: '', source: 'none' })));
  const [pillsVisible,   setPillsVisible]   = useState(false);
  const [selectedPillKey,setSelectedPillKey]= useState(null);

  // ── Inset days + trip style ───────────────────────────────────────────────
  const [insetDays, setInsetDays] = useState([]);
  const [tripStyle, setTripStyle] = useState(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const activePill     = pills.find(p => p.key === selectedPillKey) || null;
  const currentBorough = lockedSchool?.borough || selectedBorough || '';
  const currentSchool  = lockedSchool?.schoolName || '';
  const currentUrn     = lockedSchool?.urn || null;
  const isLocked       = !!lockedSchool;
  const canSubmit      = !!(activePill?.start) && !!tripStyle;

  // ── Fetch schools (debounced) ─────────────────────────────────────────────
  const fetchSchools = useCallback(async (q) => {
    try {
      const res  = await fetch('/api/schools?q=' + encodeURIComponent(q));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      setConnError(false);
      if (!data || !data.length) {
        setDropItems([]); setDropOpen(false); setShowFallback(true);
        return;
      }
      setShowFallback(false);
      setDropItems(data); setDropOpen(true); setHlIdx(-1);
    } catch {
      setDropItems([]); setDropOpen(false); setConnError(true);
    }
  }, []);

  function handleQueryChange(e) {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(searchTimer.current);
    setConnError(false);
    if (q.trim().length < 3) {
      setDropOpen(false); setDropItems([]); setShowFallback(false);
      return;
    }
    searchTimer.current = setTimeout(() => fetchSchools(q.trim()), 250);
  }

  function handleKeyDown(e) {
    if (!dropOpen || !dropItems.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setHlIdx(i => Math.min(i + 1, dropItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setHlIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && hlIdx >= 0) {
      e.preventDefault(); pickSchool(dropItems[hlIdx]);
    } else if (e.key === 'Escape') {
      setDropOpen(false);
    }
  }

  async function pickSchool(school) {
    setLockedSchool({ urn: school.urn, schoolName: school.school_name, borough: school.borough });
    setQuery(school.school_name);
    setDropOpen(false); setDropItems([]); setShowFallback(false);
    resetBreakState();
    await loadTermDates(school.urn, school.borough);
  }

  function clearSchool() {
    setLockedSchool(null);
    setQuery(''); setDropOpen(false); setDropItems([]);
    setShowFallback(false); setConnError(false);
    setPillsVisible(false);
    resetBreakState();
    setBoroughMode(false); setSelectedBorough('');
  }

  // ── Borough mode ──────────────────────────────────────────────────────────
  function switchToBoroughMode() {
    setBoroughMode(true);
    if (!boroughs.length) {
      fetch('/api/boroughs')
        .then(r => r.json())
        .then(data => setBoroughs(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }

  async function handleBoroughChange(e) {
    const b = e.target.value;
    setSelectedBorough(b);
    resetBreakState();
    if (!b) { setPillsVisible(false); return; }
    try {
      const res  = await fetch('/api/borough-dates?borough=' + encodeURIComponent(b));
      const rows = res.ok ? (await res.json() || []) : [];
      populatePills({}, buildUpcomingMap(rows));
    } catch {
      populatePills({}, {});
    }
  }

  // ── Term dates ────────────────────────────────────────────────────────────
  async function loadTermDates(urn, borough) {
    try {
      const [sr, br] = await Promise.all([
        fetch('/api/term-dates?urn='      + encodeURIComponent(urn)),
        fetch('/api/borough-dates?borough=' + encodeURIComponent(borough)),
      ]);
      const schoolRows  = sr.ok ? (await sr.json() || []) : [];
      const boroughRows = br.ok ? (await br.json() || []) : [];
      populatePills(buildUpcomingMap(schoolRows), buildUpcomingMap(boroughRows));
    } catch {
      populatePills({}, {});
    }
  }

  function populatePills(schoolMap, boroughMap) {
    const sorted = BREAKS.slice().sort((a, b) => {
      const da = schoolMap[a.key] || boroughMap[a.key];
      const db = schoolMap[b.key] || boroughMap[b.key];
      const sa = da ? da.start : '', sb = db ? db.start : '';
      if (!sa && !sb) return 0;
      if (!sa) return 1; if (!sb) return -1;
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    setPills(sorted.map(brk => {
      const sd    = schoolMap[brk.key];
      const dates = sd || boroughMap[brk.key];
      return {
        label:  brk.label,
        key:    brk.key,
        start:  dates?.start || '',
        end:    dates?.end   || '',
        source: sd ? 'school' : (dates ? 'borough' : 'none'),
      };
    }));
    setPillsVisible(true);
  }

  // ── Pill selection ────────────────────────────────────────────────────────
  async function selectPill(pill) {
    setSelectedPillKey(pill.key);
    setInsetDays([]);
    setTripStyle(null);
    if (pill.source === 'school' && currentUrn && pill.start && pill.end) {
      try {
        const res = await fetch(
          `/api/inset-days?urn=${encodeURIComponent(currentUrn)}` +
          `&start=${encodeURIComponent(pill.start)}&end=${encodeURIComponent(pill.end)}`
        );
        if (res.ok) setInsetDays((await res.json()) || []);
      } catch { /* silent */ }
    }
  }

  function resetBreakState() {
    setSelectedPillKey(null);
    setInsetDays([]);
    setTripStyle(null);
  }

  // ── CTA ───────────────────────────────────────────────────────────────────
  function handleCTA() {
    if (!canSubmit || !activePill) return;
    const p = new URLSearchParams({
      borough: currentBorough,
      break:   activePill.label,
      start:   activePill.start,
      end:     activePill.end,
    });
    if (currentUrn)    p.set('urn',    currentUrn);
    if (currentSchool) p.set('school', currentSchool);
    window.location.href = '/results/flight-insights?' + p.toString();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Holiday Smart</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>

      <nav>
        <a className="nav-logo" href="#">Holiday Smart</a>
        <ul className="nav-links">
          <li><a href="#">How it works</a></li>
          <li><a href="#">Sign in</a></li>
        </ul>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <span className="hero-eyebrow">London family travel · Curated by data</span>
          <h1 className="hero-headline">Your school&apos;s exact travel windows. Priced and timed.</h1>
          <p className="hero-body">We find the inset days, price windows, and shortcuts most London parents never spot.</p>
        </div>

        <div className="selector-card">

          {/* ── School search OR borough select ── */}
          {!boroughMode ? (
            <div id="school-search-section">
              <label className="field-label" htmlFor="school-search">Your child&apos;s school</label>
              <div className="school-search-wrap">
                <svg className="school-search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  className={`school-search-input${isLocked ? ' school-search-input--locked' : ''}`}
                  id="school-search"
                  type="search"
                  value={query}
                  onChange={handleQueryChange}
                  onKeyDown={handleKeyDown}
                  onBlur={() => setTimeout(() => setDropOpen(false), 150)}
                  readOnly={isLocked}
                  placeholder="Type your school name…"
                  autoComplete="off"
                  spellCheck={false}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={dropOpen}
                  aria-controls="school-dropdown"
                />
                {isLocked && (
                  <button className="school-clear-btn" onClick={clearSchool} aria-label="Clear school selection">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                )}
                {dropOpen && dropItems.length > 0 && (
                  <ul className="school-dropdown" id="school-dropdown" role="listbox">
                    {dropItems.map((school, i) => (
                      <li
                        key={school.urn || i}
                        className="school-dropdown-item"
                        role="option"
                        aria-selected={i === hlIdx}
                        onMouseDown={e => { e.preventDefault(); pickSchool(school); }}
                      >
                        <span className="item-name">{school.school_name}</span>
                        <span className="item-borough"> — {school.borough}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {connError && (
                <p className="fallback-text text-error">
                  Could not reach the school database — check your connection or try refreshing.
                </p>
              )}
              {showFallback && !isLocked && (
                <p className="fallback-text">
                  Can&apos;t find your school?{' '}
                  <a href="#" onClick={e => { e.preventDefault(); switchToBoroughMode(); }}>
                    Choose your borough instead.
                  </a>
                </p>
              )}
            </div>
          ) : (
            <div id="borough-mode">
              <label className="field-label" htmlFor="borough-select">Your borough</label>
              <select
                className="borough-select"
                id="borough-select"
                value={selectedBorough}
                onChange={handleBoroughChange}
              >
                <option value="">Select a borough…</option>
                {boroughs.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
          )}

          {/* ── Break pills ── */}
          {pillsVisible && (
            <div id="break-pills-section">
              <span className="break-pills-label">Which break?</span>
              <div className="break-pills-grid">
                {pills.map(pill => (
                  <button
                    key={pill.key}
                    className={`break-pill${selectedPillKey === pill.key ? ' active' : ''}`}
                    type="button"
                    onClick={() => selectPill(pill)}
                  >
                    <span className="pill-name">{pill.label}</span>
                    {pill.start && pill.end && (
                      <span className="pill-dates">{fmtRange(pill.start, pill.end)}</span>
                    )}
                  </button>
                ))}
              </div>

              {/* ── Calendar reveal (replaces old inset-reveal line) ── */}
              {activePill?.start && activePill?.end && (
                <BreakCalendarReveal
                  schoolName={currentSchool}
                  borough={currentBorough}
                  breakLabel={activePill.label}
                  officialStart={activePill.start}
                  officialEnd={activePill.end}
                  insetDays={insetDays}
                  dataSource={activePill.source === 'borough' ? 'borough' : 'school'}
                  onTripStyleSelect={style => setTripStyle(style)}
                />
              )}

              <button
                className="btn-primary"
                id="cta-btn"
                type="button"
                disabled={!canSubmit}
                onClick={handleCTA}
                style={{ marginTop: 24 }}
              >
                Show me the data →
              </button>
            </div>
          )}

        </div>
      </section>

      <div className="insight-section">
        <span className="example-label">Example data</span>
        <div className="insight-grid">

          <div className="insight-card">
            <span className="insight-tag">Inset Day Alert</span>
            <div className="insight-divider"></div>
            <p className="insight-metric">10 days off in a row</p>
            <div>
              <p className="insight-title">St. John&apos;s CE Primary, Hackney</p>
              <p className="insight-body">Friday 24 Oct is an inset day. Leave Thursday evening and you get a 10-night window at standard half-term prices. Most parents won&apos;t realise until the week before.</p>
            </div>
            <span className="insight-badge">High value window</span>
          </div>

          <div className="insight-card">
            <span className="insight-tag">Weather Data</span>
            <div className="insight-divider"></div>
            <p className="insight-metric">18°C · 7 hrs sun</p>
            <div>
              <p className="insight-title">February half-term · Algarve</p>
              <p className="insight-body">The warmest budget-accessible destination for London families this winter. Flight prices sit 40% below August. Schools in 29 boroughs break 15–23 Feb.</p>
            </div>
            <span className="insight-badge">Weather window</span>
          </div>

          <div className="insight-card">
            <span className="insight-tag">Price Trend</span>
            <div className="insight-divider"></div>
            <p className="insight-metric">34% cheaper mid-week</p>
            <div>
              <p className="insight-title">London → Edinburgh · May half-term</p>
              <p className="insight-body">Mon–Wed departures are 34% below the Fri–Sun peak. Travelling Sunday evening unlocks the lowest fares — returns under £80pp still available for 6+ nights.</p>
            </div>
            <span className="insight-badge">Price opportunity</span>
          </div>

        </div>
      </div>

      <footer>
        <div className="footer-inner">
          <a className="footer-logo" href="#">Holiday Smart</a>
          <ul className="footer-links">
            <li><a href="#">About Us</a></li>
            <li><a href="#">Privacy Policy</a></li>
            <li><a href="#">Holiday Calendar</a></li>
            <li><a href="#">Contact Support</a></li>
          </ul>
        </div>
        <div className="footer-bottom">
          <div className="footer-bottom-inner">
            <span className="footer-legal">© 2026 Smart Travel Planning.</span>
          </div>
        </div>
      </footer>
    </>
  );
}
