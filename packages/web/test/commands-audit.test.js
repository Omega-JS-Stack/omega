/**
 * `omega audit` — the Lighthouse gate. The pure surface is unit-tested here
 * (flag parsing, page list, the pass/fail decision, clean-URL serving); the
 * REAL Lighthouse pass is opt-in behind OMEGA_AUDIT_LIVE=1, the way every
 * browser lane in this repo gates — a missing Chrome skips with its reason
 * printed, it never lies green.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const audit = require('../src/commands/audit.js');

const LIVE = /^(1|true)$/i.test(process.env.OMEGA_AUDIT_LIVE || '');

// ─── Thresholds: report-only unless a --min-<category> flag arms the gate ───

test('parseThresholds: no flag = no gate (report-only default)', () => {
  assert.deepStrictEqual(audit.parseThresholds({ _: ['audit'] }), {});
});

test('parseThresholds: dashed and yargs-camelized flags both arm their category', () => {
  const thresholds = audit.parseThresholds({
    _: ['audit'],
    'min-performance': 90,
    minPerformance: 90,
    'min-best-practices': 80,
    minBestPractices: 80,
    'min-seo': '95',
    minSeo: '95',
  });

  assert.deepStrictEqual(thresholds, {
    performance: 90,
    'best-practices': 80,
    seo: 95,
  }, 'only the flagged categories are gated, values numeric');
});

test('parseThresholds: a non-score value fails loudly, before any build runs', () => {
  assert.throws(
    () => audit.parseThresholds({ _: ['audit'], 'min-performance': 'high' }),
    /--min-performance must be a score between 0 and 100 \(got "high"\)/,
  );
  assert.throws(
    () => audit.parseThresholds({ _: ['audit'], 'min-seo': 101 }),
    /--min-seo must be a score between 0 and 100/,
  );
});

// ─── The LCP bar: --max-lcp arms the 1s interactive gate ────────────────────

test('parseMaxLcp: no flag = no LCP gate (report-only default)', () => {
  assert.strictEqual(audit.parseMaxLcp({ _: ['audit'] }), null);
});

test('parseMaxLcp: dashed and yargs-camelized flags both arm the gate', () => {
  assert.strictEqual(audit.parseMaxLcp({ _: ['audit'], 'max-lcp': 1000 }), 1000);
  assert.strictEqual(audit.parseMaxLcp({ _: ['audit'], maxLcp: '1000' }), 1000);
  assert.strictEqual(audit.parseMaxLcp({ _: ['audit'], 'max-lcp': 1000, maxLcp: 1000 }), 1000);
});

test('parseMaxLcp: a non-duration value fails loudly, before any build runs', () => {
  assert.throws(
    () => audit.parseMaxLcp({ _: ['audit'], 'max-lcp': 'fast' }),
    /--max-lcp must be a duration in milliseconds above 0 \(got "fast"\)/,
  );
  assert.throws(
    () => audit.parseMaxLcp({ _: ['audit'], 'max-lcp': 0 }),
    /--max-lcp must be a duration in milliseconds above 0/,
  );
});

// ─── Pages: the home page always, plus the args ─────────────────────────────

test('parsePages: bare audit audits the home page', () => {
  assert.deepStrictEqual(audit.parsePages({ _: ['audit'] }), ['/']);
});

test('parsePages: args join the home page, normalized and de-duplicated', () => {
  const pages = audit.parsePages({ _: ['audit', 'pricing', '/blog/', '/pricing', '/'] });
  assert.deepStrictEqual(pages, ['/', '/pricing', '/blog']);
});

test('parsePages: a full URL is rejected — page args are site paths', () => {
  assert.throws(
    () => audit.parsePages({ _: ['audit', 'https://example.com/pricing'] }),
    /Page arguments are site paths, not URLs — pass "\/pricing"/,
  );
});

// ─── The gate: which score under which threshold fails ──────────────────────

const GREEN = { performance: 95, accessibility: 100, 'best-practices': 100, seo: 92 };

test('evaluateScores: an ungated category never fails, whatever it scored', () => {
  const failures = audit.evaluateScores(
    [{ page: '/', scores: { ...GREEN, performance: 12 } }],
    { seo: 90 },
  );
  assert.deepStrictEqual(failures, [], 'performance 12 with no --min-performance is reported, not gated');
});

test('evaluateScores: a score under its threshold fails, per page and category', () => {
  const failures = audit.evaluateScores([
    { page: '/', scores: GREEN },
    { page: '/pricing', scores: { ...GREEN, performance: 71, seo: 80 } },
  ], { performance: 90, seo: 90 });

  assert.deepStrictEqual(failures, [
    { page: '/pricing', category: 'performance', score: 71, min: 90 },
    { page: '/pricing', category: 'seo', score: 80, min: 90 },
  ]);
});

test('evaluateScores: a score exactly at the threshold passes', () => {
  assert.deepStrictEqual(audit.evaluateScores([{ page: '/', scores: GREEN }], { performance: 95 }), []);
});

test('evaluateScores: a MISSING score under an armed threshold fails — a run that produced nothing has not passed', () => {
  const failures = audit.evaluateScores(
    [{ page: '/', scores: { ...GREEN, accessibility: null } }],
    { accessibility: 90 },
  );
  assert.deepStrictEqual(failures, [{ page: '/', category: 'accessibility', score: null, min: 90 }]);
});

test('categoryScores: the four categories out of 100, null when Lighthouse produced none', () => {
  const scores = audit.categoryScores({
    categories: {
      performance: { score: 0.9151 },
      accessibility: { score: 1 },
      'best-practices': { score: null },
      // seo absent entirely
    },
  });
  assert.deepStrictEqual(scores, {
    performance: 92,
    accessibility: 100,
    'best-practices': null,
    seo: null,
  });
});

// ─── Metrics: LCP and CLS beside the scores, with the form factor ───────────

const LHR = (lcp, cls) => ({
  configSettings: { formFactor: 'mobile' },
  audits: {
    'largest-contentful-paint': { numericValue: lcp },
    'cumulative-layout-shift': { numericValue: cls },
  },
});

test('pageMetrics: LCP in whole ms, CLS, and the form factor the run used', () => {
  assert.deepStrictEqual(audit.pageMetrics(LHR(784.4213, 0.0021)), {
    lcp: 784,
    cls: 0.0021,
    formFactor: 'mobile',
  });
});

test('pageMetrics: a metric Lighthouse did not produce reads null, never 0', () => {
  assert.deepStrictEqual(audit.pageMetrics({ audits: {} }), { lcp: null, cls: null, formFactor: null });
});

test('evaluateLcp: no --max-lcp never fails, whatever the page measured', () => {
  assert.deepStrictEqual(audit.evaluateLcp([{ page: '/', metrics: audit.pageMetrics(LHR(9000, 0)) }], null), []);
});

test('evaluateLcp: an LCP over the bar fails, at or under it passes', () => {
  const results = [
    { page: '/', metrics: audit.pageMetrics(LHR(784, 0)) },
    { page: '/pricing', metrics: audit.pageMetrics(LHR(2588, 0)) },
  ];
  assert.deepStrictEqual(audit.evaluateLcp(results, 1000), [
    { page: '/pricing', metric: 'lcp', value: 2588, max: 1000 },
  ], 'the fast page is reported, the slow one is the failure');

  assert.deepStrictEqual(
    audit.evaluateLcp([{ page: '/', metrics: audit.pageMetrics(LHR(1000, 0)) }], 1000),
    [],
    'exactly at the bar passes',
  );
});

test('evaluateLcp: a MISSING LCP under an armed bar fails — a run that measured nothing has not passed', () => {
  const failures = audit.evaluateLcp([{ page: '/', metrics: { lcp: null, cls: null, formFactor: null } }], 1000);
  assert.deepStrictEqual(failures, [{ page: '/', metric: 'lcp', value: null, max: 1000 }]);
});

test('formatSummary: the per-page printout carries the scores, the metrics and the form factor', () => {
  assert.strictEqual(
    audit.formatSummary(GREEN, { lcp: 784, cls: 0.021, formFactor: 'mobile' }),
    'Performance 95/100 · Accessibility 100/100 · Best Practices 100/100 · SEO 92/100 · LCP 784 ms · CLS 0.021 (mobile emulation)',
  );
  assert.strictEqual(
    audit.formatSummary({ ...GREEN, seo: null }, { lcp: null, cls: null, formFactor: null }),
    'Performance 95/100 · Accessibility 100/100 · Best Practices 100/100 · SEO n/a · LCP n/a · CLS n/a (unknown emulation)',
  );
});

// ─── Serving dist/: clean URLs on an ephemeral port ─────────────────────────

function fixtureDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-audit-'));
  fs.writeFileSync(path.join(dir, 'index.html'), PAGE('Home'));
  fs.writeFileSync(path.join(dir, 'pricing.html'), PAGE('Pricing'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'main.css'), 'body { color: #111; }');
  return dir;
}

const PAGE = (title) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="The ${title} page of the audit fixture site.">
<link rel="stylesheet" href="/assets/main.css">
</head>
<body><h1>${title}</h1><p><a href="/pricing">Pricing</a></p></body>
</html>
`;

test('serveDist: clean URLs, real files, 404s — on an ephemeral loopback port', async () => {
  const dir = fixtureDist();
  const server = await audit.serveDist(dir);

  try {
    assert.ok(server.port > 0, 'listening on an OS-assigned port, never a fixed one');
    assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/, 'loopback only');

    const home = await fetch(`${server.origin}/`);
    assert.strictEqual(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.match(await home.text(), /<h1>Home<\/h1>/);

    // The dev server's contract: /pricing serves pricing.html
    const clean = await fetch(`${server.origin}/pricing`);
    assert.strictEqual(clean.status, 200);
    assert.match(await clean.text(), /<h1>Pricing<\/h1>/);

    const trailing = await fetch(`${server.origin}/pricing/`);
    assert.strictEqual(trailing.status, 200, 'a stray trailing slash resolves too');

    const asset = await fetch(`${server.origin}/assets/main.css`);
    assert.strictEqual(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /text\/css/);

    const missing = await fetch(`${server.origin}/nope`);
    assert.strictEqual(missing.status, 404);
  } finally {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveFile: no path escapes the build output', () => {
  const dir = fixtureDist();
  try {
    const secret = path.join(path.dirname(dir), 'outside.html');
    fs.writeFileSync(secret, PAGE('Outside'));

    assert.strictEqual(audit.resolveFile(dir, '/'), path.join(dir, 'index.html'));
    assert.strictEqual(audit.resolveFile(dir, '/pricing'), path.join(dir, 'pricing.html'));
    assert.strictEqual(audit.resolveFile(dir, '/../outside'), null, 'traversal resolves to nothing');
    assert.strictEqual(audit.resolveFile(dir, '/%ZZ'), null, 'a malformed escape is not a candidate');

    fs.rmSync(secret, { force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── The live pass: opt-in, real Chrome, real Lighthouse ────────────────────

test('LIVE: Lighthouse scores a served page through headless Chrome', {
  skip: LIVE ? false : 'opt-in — run with OMEGA_AUDIT_LIVE=1 (needs a headless Chrome)',
}, async (t) => {
  const dir = fixtureDist();
  const server = await audit.serveDist(dir);
  let chrome = null;

  try {
    try {
      chrome = await audit.launchChrome();
    } catch (error) {
      // Preconditions skip, never lie (docs/shared/testing.md)
      return t.skip(`no headless Chrome — ${error.message}`);
    }

    const { scores, metrics } = await audit.auditPage(`${server.origin}/`, chrome.port);
    console.log(`    live run: ${audit.formatSummary(scores, metrics)}`);

    for (const category of ['performance', 'accessibility', 'best-practices', 'seo']) {
      assert.strictEqual(typeof scores[category], 'number', `${category} produced a real score`);
    }
    assert.strictEqual(typeof metrics.lcp, 'number', 'the run measured a real LCP');
    assert.strictEqual(typeof metrics.cls, 'number', 'the run measured a real CLS');
    assert.strictEqual(metrics.formFactor, 'mobile', "Lighthouse's default preset is the mobile emulation PSI reports");

    // The LCP bar decides on the REAL number, both ways
    assert.deepStrictEqual(audit.evaluateLcp([{ page: '/', metrics }], metrics.lcp), [],
      'a bar AT the observed LCP passes');
    assert.deepStrictEqual(audit.evaluateLcp([{ page: '/', metrics }], metrics.lcp - 1), [
      { page: '/', metric: 'lcp', value: metrics.lcp, max: metrics.lcp - 1 },
    ], 'a bar under the observed LCP fails');
    // The gate decides on the REAL numbers, both ways
    assert.deepStrictEqual(audit.evaluateScores([{ page: '/', scores }], scores), [],
      'thresholds AT the observed scores pass');

    const lowest = Math.min(...Object.values(scores));
    if (lowest < 100) {
      const strict = Object.fromEntries(Object.keys(scores).map((category) => [category, 100]));
      assert.ok(audit.evaluateScores([{ page: '/', scores }], strict).length > 0,
        'a threshold above an observed score fails');
    }
  } finally {
    if (chrome) await chrome.kill();
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
