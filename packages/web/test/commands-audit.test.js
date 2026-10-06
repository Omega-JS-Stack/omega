/**
 * `omega audit` — the Lighthouse gate. The pure surface is unit-tested here
 * (flag parsing, page list, the pass/fail decision, clean-URL serving); the
 * REAL Lighthouse pass is opt-in behind OMEGA_AUDIT_LIVE=1, the way every
 * browser lane in this repo gates — a missing Chrome skips with its reason
 * printed, it never lies green.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const audit = require('../src/commands/audit.js');

const LIVE = /^(1|true)$/i.test(process.env.OMEGA_AUDIT_LIVE || '');

// ─── The gate: which score under which threshold fails ──────────────────────

const GREEN = { performance: 95, accessibility: 100, 'best-practices': 100, seo: 92 };

// ─── Metrics: LCP and CLS beside the scores, with the form factor ───────────

const LHR = (lcp, cls) => ({
  configSettings: { formFactor: 'mobile' },
  audits: {
    'largest-contentful-paint': { numericValue: lcp },
    'cumulative-layout-shift': { numericValue: cls },
  },
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

module.exports = defineCases({
  type: 'group',
  description: 'commands-audit',
  tests: [
    // ─── Thresholds: report-only unless a --min-<category> flag arms the gate ───

    {
      name: 'parseThresholds: no flag = no gate (report-only default)',
      run: (ctx) => {
        ctx.expect(audit.parseThresholds({ _: ['audit'] })).toEqual({});
      },
    },

    {
      name: 'parseThresholds: dashed and camelized flags both arm their category',
      run: (ctx) => {
        const thresholds = audit.parseThresholds({
          _: ['audit'],
          'min-performance': 90,
          minPerformance: 90,
          'min-best-practices': 80,
          minBestPractices: 80,
          'min-seo': '95',
          minSeo: '95',
        });

        ctx.expect(thresholds, 'only the flagged categories are gated, values numeric').toEqual({
          performance: 90,
          'best-practices': 80,
          seo: 95,
        });
      },
    },

    {
      name: 'parseThresholds: a non-score value fails loudly, before any build runs',
      run: (ctx) => {
        ctx.expect(() => audit.parseThresholds({ _: ['audit'], 'min-performance': 'high' })).toThrow(/--min-performance must be a score between 0 and 100 \(got "high"\)/);
        ctx.expect(() => audit.parseThresholds({ _: ['audit'], 'min-seo': 101 })).toThrow(/--min-seo must be a score between 0 and 100/);
      },
    },

    // ─── The LCP bar: --max-lcp arms the 1s interactive gate ────────────────────

    {
      name: 'parseMaxLcp: no flag = no LCP gate (report-only default)',
      run: (ctx) => {
        ctx.expect(audit.parseMaxLcp({ _: ['audit'] })).toBe(null);
      },
    },

    {
      name: 'parseMaxLcp: dashed and camelized flags both arm the gate',
      run: (ctx) => {
        ctx.expect(audit.parseMaxLcp({ _: ['audit'], 'max-lcp': 1000 })).toBe(1000);
        ctx.expect(audit.parseMaxLcp({ _: ['audit'], maxLcp: '1000' })).toBe(1000);
        ctx.expect(audit.parseMaxLcp({ _: ['audit'], 'max-lcp': 1000, maxLcp: 1000 })).toBe(1000);
      },
    },

    {
      name: 'parseMaxLcp: a non-duration value fails loudly, before any build runs',
      run: (ctx) => {
        ctx.expect(() => audit.parseMaxLcp({ _: ['audit'], 'max-lcp': 'fast' })).toThrow(/--max-lcp must be a duration in milliseconds above 0 \(got "fast"\)/);
        ctx.expect(() => audit.parseMaxLcp({ _: ['audit'], 'max-lcp': 0 })).toThrow(/--max-lcp must be a duration in milliseconds above 0/);
      },
    },

    // ─── Pages: the home page always, plus the args ─────────────────────────────

    {
      name: 'parsePages: bare audit audits the home page',
      run: (ctx) => {
        ctx.expect(audit.parsePages({ _: ['audit'] })).toEqual(['/']);
      },
    },

    {
      name: 'parsePages: args join the home page, normalized and de-duplicated',
      run: (ctx) => {
        const pages = audit.parsePages({ _: ['audit', 'pricing', '/blog/', '/pricing', '/'] });
        ctx.expect(pages).toEqual(['/', '/pricing', '/blog']);
      },
    },

    {
      name: 'parsePages: a full URL is rejected — page args are site paths',
      run: (ctx) => {
        ctx.expect(() => audit.parsePages({ _: ['audit', 'https://example.com/pricing'] })).toThrow(/Page arguments are site paths, not URLs — pass "\/pricing"/);
      },
    },

    {
      name: 'evaluateScores: an ungated category never fails, whatever it scored',
      run: (ctx) => {
        const failures = audit.evaluateScores(
          [{ page: '/', scores: { ...GREEN, performance: 12 } }],
          { seo: 90 },
        );
        ctx.expect(failures, 'performance 12 with no --min-performance is reported, not gated').toEqual([]);
      },
    },

    {
      name: 'evaluateScores: a score under its threshold fails, per page and category',
      run: (ctx) => {
        const failures = audit.evaluateScores([
          { page: '/', scores: GREEN },
          { page: '/pricing', scores: { ...GREEN, performance: 71, seo: 80 } },
        ], { performance: 90, seo: 90 });

        ctx.expect(failures).toEqual([
          { page: '/pricing', category: 'performance', score: 71, min: 90 },
          { page: '/pricing', category: 'seo', score: 80, min: 90 },
        ]);
      },
    },

    {
      name: 'evaluateScores: a score exactly at the threshold passes',
      run: (ctx) => {
        ctx.expect(audit.evaluateScores([{ page: '/', scores: GREEN }], { performance: 95 })).toEqual([]);
      },
    },

    {
      name: 'evaluateScores: a MISSING score under an armed threshold fails — a run that produced nothing has not passed',
      run: (ctx) => {
        const failures = audit.evaluateScores(
          [{ page: '/', scores: { ...GREEN, accessibility: null } }],
          { accessibility: 90 },
        );
        ctx.expect(failures).toEqual([{ page: '/', category: 'accessibility', score: null, min: 90 }]);
      },
    },

    {
      name: 'categoryScores: the four categories out of 100, null when Lighthouse produced none',
      run: (ctx) => {
        const scores = audit.categoryScores({
          categories: {
            performance: { score: 0.9151 },
            accessibility: { score: 1 },
            'best-practices': { score: null },
            // seo absent entirely
          },
        });
        ctx.expect(scores).toEqual({
          performance: 92,
          accessibility: 100,
          'best-practices': null,
          seo: null,
        });
      },
    },

    {
      name: 'pageMetrics: LCP in whole ms, CLS, and the form factor the run used',
      run: (ctx) => {
        ctx.expect(audit.pageMetrics(LHR(784.4213, 0.0021))).toEqual({
          lcp: 784,
          cls: 0.0021,
          formFactor: 'mobile',
        });
      },
    },

    {
      name: 'pageMetrics: a metric Lighthouse did not produce reads null, never 0',
      run: (ctx) => {
        ctx.expect(audit.pageMetrics({ audits: {} })).toEqual({ lcp: null, cls: null, formFactor: null });
      },
    },

    {
      name: 'evaluateLcp: no --max-lcp never fails, whatever the page measured',
      run: (ctx) => {
        ctx.expect(audit.evaluateLcp([{ page: '/', metrics: audit.pageMetrics(LHR(9000, 0)) }], null)).toEqual([]);
      },
    },

    {
      name: 'evaluateLcp: an LCP over the bar fails, at or under it passes',
      run: (ctx) => {
        const results = [
          { page: '/', metrics: audit.pageMetrics(LHR(784, 0)) },
          { page: '/pricing', metrics: audit.pageMetrics(LHR(2588, 0)) },
        ];
        ctx.expect(audit.evaluateLcp(results, 1000), 'the fast page is reported, the slow one is the failure').toEqual([
          { page: '/pricing', metric: 'lcp', value: 2588, max: 1000 },
        ]);

        ctx.expect(audit.evaluateLcp([{ page: '/', metrics: audit.pageMetrics(LHR(1000, 0)) }], 1000), 'exactly at the bar passes').toEqual([]);
      },
    },

    {
      name: 'evaluateLcp: a MISSING LCP under an armed bar fails — a run that measured nothing has not passed',
      run: (ctx) => {
        const failures = audit.evaluateLcp([{ page: '/', metrics: { lcp: null, cls: null, formFactor: null } }], 1000);
        ctx.expect(failures).toEqual([{ page: '/', metric: 'lcp', value: null, max: 1000 }]);
      },
    },

    {
      name: 'formatSummary: the per-page printout carries the scores, the metrics and the form factor',
      run: (ctx) => {
        ctx.expect(audit.formatSummary(GREEN, { lcp: 784, cls: 0.021, formFactor: 'mobile' })).toBe('Performance 95/100 · Accessibility 100/100 · Best Practices 100/100 · SEO 92/100 · LCP 784 ms · CLS 0.021 (mobile emulation)');
        ctx.expect(audit.formatSummary({ ...GREEN, seo: null }, { lcp: null, cls: null, formFactor: null })).toBe('Performance 95/100 · Accessibility 100/100 · Best Practices 100/100 · SEO n/a · LCP n/a · CLS n/a (unknown emulation)');
      },
    },

    {
      name: 'serveDist: clean URLs, real files, 404s — on an ephemeral loopback port',
      run: async (ctx) => {
        const dir = fixtureDist();
        const server = await audit.serveDist(dir);

        try {
          ctx.expect(server.port > 0, 'listening on an OS-assigned port, never a fixed one').toBeTruthy();
          ctx.expect(server.origin, 'loopback only').toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

          const home = await fetch(`${server.origin}/`);
          ctx.expect(home.status).toBe(200);
          ctx.expect(home.headers.get('content-type')).toMatch(/text\/html/);
          ctx.expect(await home.text()).toMatch(/<h1>Home<\/h1>/);

          // The dev server's contract: /pricing serves pricing.html
          const clean = await fetch(`${server.origin}/pricing`);
          ctx.expect(clean.status).toBe(200);
          ctx.expect(await clean.text()).toMatch(/<h1>Pricing<\/h1>/);

          const trailing = await fetch(`${server.origin}/pricing/`);
          ctx.expect(trailing.status, 'a stray trailing slash resolves too').toBe(200);

          const asset = await fetch(`${server.origin}/assets/main.css`);
          ctx.expect(asset.status).toBe(200);
          ctx.expect(asset.headers.get('content-type')).toMatch(/text\/css/);

          const missing = await fetch(`${server.origin}/nope`);
          ctx.expect(missing.status).toBe(404);
        } finally {
          await server.close();
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'resolveFile: no path escapes the build output',
      run: (ctx) => {
        const dir = fixtureDist();
        try {
          const secret = path.join(path.dirname(dir), 'outside.html');
          fs.writeFileSync(secret, PAGE('Outside'));

          ctx.expect(audit.resolveFile(dir, '/')).toBe(path.join(dir, 'index.html'));
          ctx.expect(audit.resolveFile(dir, '/pricing')).toBe(path.join(dir, 'pricing.html'));
          ctx.expect(audit.resolveFile(dir, '/../outside'), 'traversal resolves to nothing').toBe(null);
          ctx.expect(audit.resolveFile(dir, '/%ZZ'), 'a malformed escape is not a candidate').toBe(null);

          fs.rmSync(secret, { force: true });
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    // ─── The live pass: opt-in, real Chrome, real Lighthouse ────────────────────

    {
      name: 'LIVE: Lighthouse scores a served page through headless Chrome',
      skip: LIVE ? false : 'opt-in — run with OMEGA_AUDIT_LIVE=1 (needs a headless Chrome)',
      run: async (ctx) => {
        const dir = fixtureDist();
        const server = await audit.serveDist(dir);
        let chrome = null;

        try {
          try {
            chrome = await audit.launchChrome();
          } catch (error) {
            // Preconditions skip, never lie (docs/shared/testing.md)
            return ctx.skip(`no headless Chrome — ${error.message}`);
          }

          const { scores, metrics } = await audit.auditPage(`${server.origin}/`, chrome.port);
          console.log(`    live run: ${audit.formatSummary(scores, metrics)}`);

          for (const category of ['performance', 'accessibility', 'best-practices', 'seo']) {
            ctx.expect(typeof scores[category], `${category} produced a real score`).toBe('number');
          }
          ctx.expect(typeof metrics.lcp, 'the run measured a real LCP').toBe('number');
          ctx.expect(typeof metrics.cls, 'the run measured a real CLS').toBe('number');
          ctx.expect(metrics.formFactor, "Lighthouse's default preset is the mobile emulation PSI reports").toBe('mobile');

          // The LCP bar decides on the REAL number, both ways
          ctx.expect(audit.evaluateLcp([{ page: '/', metrics }], metrics.lcp), 'a bar AT the observed LCP passes').toEqual([]);
          ctx.expect(audit.evaluateLcp([{ page: '/', metrics }], metrics.lcp - 1), 'a bar under the observed LCP fails').toEqual([
            { page: '/', metric: 'lcp', value: metrics.lcp, max: metrics.lcp - 1 },
          ]);
          // The gate decides on the REAL numbers, both ways
          ctx.expect(audit.evaluateScores([{ page: '/', scores }], scores), 'thresholds AT the observed scores pass').toEqual([]);

          const lowest = Math.min(...Object.values(scores));
          if (lowest < 100) {
            const strict = Object.fromEntries(Object.keys(scores).map((category) => [category, 100]));
            ctx.expect(audit.evaluateScores([{ page: '/', scores }], strict).length > 0, 'a threshold above an observed score fails').toBeTruthy();
          }
        } finally {
          if (chrome) await chrome.kill();
          await server.close();
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  ],
});
