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

    const scores = await audit.auditPage(`${server.origin}/`, chrome.port);
    console.log(`    live scores: ${JSON.stringify(scores)}`);

    for (const category of ['performance', 'accessibility', 'best-practices', 'seo']) {
      assert.strictEqual(typeof scores[category], 'number', `${category} produced a real score`);
    }
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
