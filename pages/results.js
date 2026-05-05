import Head from 'next/head';
import Script from 'next/script';

export default function Results() {
  return (
    <>
      <Head>
        <title>Results — Holiday Smart</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>

      <nav>
        <a className="nav-logo" href="/">Holiday Smart</a>
        <ul className="nav-links">
          <li><a href="/#how-it-works">How it works</a></li>
          <li><a href="#">Sign in</a></li>
        </ul>
      </nav>

      <main>
        <span className="page-eyebrow">Results</span>
        <h1 className="page-heading">Results coming soon</h1>

        <div className="summary-card" id="summary-card">
          <p className="summary-card-title">Your selection</p>
          <div className="summary-divider"></div>
          <div id="summary-rows"></div>
        </div>
      </main>

      <footer>
        <div className="footer-inner">
          <a className="footer-logo" href="/">Holiday Smart</a>
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

      <Script src="/js/results.js" strategy="afterInteractive" />
    </>
  );
}
