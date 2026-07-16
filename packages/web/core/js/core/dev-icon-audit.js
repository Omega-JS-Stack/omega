// Dev icon audit (development only; main.js only imports this chunk when
// omega.isDevelopment()). The build-time icon loader stamps every fallback
// triangle with data-omega-icon-missing="<slug>" (template-kit media.js) —
// this scan turns those silent triangles into console errors you can't
// miss, and re-checks once after load for late-rendered markup.

/**
 * Scan the DOM for tagged fallback icons and console.error each distinct
 * miss once.
 */
export default function devIconAudit() {
  const reported = new Set();

  const scan = () => {
    document.querySelectorAll('[data-omega-icon-missing]').forEach((el) => {
      const slug = el.getAttribute('data-omega-icon-missing');
      const key = `${slug}`;
      if (reported.has(key)) return;
      reported.add(key);
      console.error(`[omega] Missing icon "${slug}" — rendered the fallback triangle`, el);
    });
  };

  scan();
  // One delayed pass for markup that lands after boot (bindings, lazy HTML)
  setTimeout(scan, 2500);
}
