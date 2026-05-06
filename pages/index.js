import Head from 'next/head';
import Script from 'next/script';

export default function Home() {
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

          <div id="school-search-section">
            <label className="field-label" htmlFor="school-search">Your child&apos;s school</label>
            <div className="school-search-wrap">
              <svg className="school-search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                className="school-search-input"
                id="school-search"
                type="search"
                name="school"
                placeholder="Type your school name…"
                autoComplete="off"
                spellCheck="false"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="false"
                aria-controls="school-dropdown"
              />
              <button className="school-clear-btn" id="school-clear" hidden aria-label="Clear school selection">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
              <ul className="school-dropdown" id="school-dropdown" role="listbox" hidden></ul>
            </div>
            <p className="fallback-text text-error" id="search-conn-error" hidden>
              Could not reach the school database — check your connection or try refreshing.
            </p>
            <p className="fallback-text" id="school-fallback" hidden>
              Can&apos;t find your school? <a href="#" id="use-borough-link">Choose your borough instead.</a>
            </p>
          </div>

          <div id="borough-mode" hidden>
            <label className="field-label" htmlFor="borough-select">Your borough</label>
            <select className="borough-select" id="borough-select">
              <option value="">Select a borough…</option>
            </select>
          </div>

          <div id="break-pills-section" hidden>
            <span className="break-pills-label">Which break?</span>
            <p id="borough-notice" className="borough-notice" hidden></p>
            <div className="break-pills-grid">
              <button className="break-pill" type="button" data-break-label="Autumn half-term"><span className="pill-name">Autumn half-term</span></button>
              <button className="break-pill" type="button" data-break-label="Christmas"><span className="pill-name">Christmas</span></button>
              <button className="break-pill" type="button" data-break-label="February half-term"><span className="pill-name">February half-term</span></button>
              <button className="break-pill" type="button" data-break-label="Easter"><span className="pill-name">Easter</span></button>
              <button className="break-pill" type="button" data-break-label="May half-term"><span className="pill-name">May half-term</span></button>
              <button className="break-pill" type="button" data-break-label="Summer"><span className="pill-name">Summer</span></button>
            </div>
            <div id="inset-reveal" className="inset-reveal" hidden></div>
            <button className="btn-primary" id="cta-btn" type="button" disabled>Show me the data →</button>
          </div>

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

      <Script src="/js/home.js" strategy="afterInteractive" />
    </>
  );
}
