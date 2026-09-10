/**
 * `omega audit` — Lighthouse over a production build (the UJM audit port's
 * Lighthouse half). The site builds FULL through the same `omega build`
 * plumbing a deploy runs, dist/ is served on an ephemeral loopback port, and
 * Lighthouse scores the home page plus every page path passed as an argument.
 *
 * Every page also reports its LCP and CLS, and the form factor the run used
 * (Lighthouse's default preset is mobile emulation on Slow 4G, the same shape
 * PageSpeed Insights reports for mobile).
 *
 * Report-only by default (legacy UJM parity: the scores print, the command
 * exits 0). A `--min-<category>` flag ARMS the gate for that category, and
 * `--max-lcp=<ms>` arms the perceived-usability bar (#467) — any page under a
 * stated minimum, or over the stated LCP, fails loudly and exits non-zero.
 *
 *   omega audit                                   # home page, report only
 *   omega audit /pricing /blog                    # home + two more pages
 *   omega audit --min-performance=90 --min-seo=95 # gated: under = exit 1
 *   omega audit --max-lcp=1300                    # gated: LCP over 1.3s = exit 1
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const jetpack = require('fs-jetpack');
const Logger = require('@omega.js/devkit/logger');
const { consumerPaths } = require('../consumer.js');

const logger = new Logger('audit');

// Lighthouse's own category ids, in report order. Each one's threshold flag is
// `--min-<id>` — one source for the flags, the printout and the gate.
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

const LABELS = {
  performance: 'Performance',
  accessibility: 'Accessibility',
  'best-practices': 'Best Practices',
  seo: 'SEO',
};

// The two field metrics the perceived-usability bar is read from: LCP is the
// #467 gate (`--max-lcp`), CLS rides along because a late shift is the other
// half of "usable", and both come free with the performance category.
const METRIC_AUDITS = {
  lcp: 'largest-contentful-paint',
  cls: 'cumulative-layout-shift',
};

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
};

module.exports = async function (options) {
  options = options || {};

  // Parse before building — a typo'd flag must not cost a full build first
  const thresholds = parseThresholds(options);
  const maxLcp = parseMaxLcp(options);
  const pages = parsePages(options);
  const paths = consumerPaths();

  // FULL production build, never an incremental dev artifact: an audit that
  // does not measure what deploys measures nothing
  await require('./build.js')(options);

  const missing = pages.filter((page) => !resolveFile(paths.out, page));
  if (missing.length) {
    throw new Error(`No built page for ${missing.join(', ')} — check the paths against ${path.relative(paths.root, paths.out)}/`);
  }

  const server = await serveDist(paths.out);
  logger.log(`Serving ${path.relative(paths.root, paths.out)}/ on ${server.origin}`);

  const results = [];
  let chrome = null;
  try {
    chrome = await launchChrome();
    for (const page of pages) {
      logger.log(`Auditing ${page}...`);
      const { scores, metrics } = await auditPage(`${server.origin}${page}`, chrome.port);
      results.push({ page, scores, metrics });
      logger.log(`${page} — ${formatSummary(scores, metrics)}`);
    }
  } finally {
    if (chrome) {
      await chrome.kill();
    }
    await server.close();
  }

  if (!Object.keys(thresholds).length && maxLcp === null) {
    logger.log('Report only — pass --min-<category> (e.g. --min-performance=90) or --max-lcp=1300 to gate the exit code');
    return results;
  }

  const scoreFailures = evaluateScores(results, thresholds);
  const lcpFailures = evaluateLcp(results, maxLcp);
  if (scoreFailures.length || lcpFailures.length) {
    for (const failure of scoreFailures) {
      logger.error(`${failure.page}: ${LABELS[failure.category]} ${formatScore(failure.score)} is under --min-${failure.category}=${failure.min}`);
    }
    for (const failure of lcpFailures) {
      logger.error(`${failure.page}: LCP ${formatMs(failure.value)} is over --max-lcp=${failure.max}`);
    }
    logger.error(`Audit FAILED — ${scoreFailures.length + lcpFailures.length} gate(s) missed`);
    process.exitCode = 1;
    return results;
  }

  logger.log(`Audit passed — every armed gate is met across ${results.length} page(s)`);
  return results;
};

/**
 * The armed thresholds: `--min-<category>` for each Lighthouse category, in
 * both the dashed and yargs' camelized form. An absent flag leaves its
 * category ungated (report-only is the default, legacy UJM parity).
 * @param {object} options - the parsed CLI options
 * @returns {Object<string, number>} category id → minimum score
 */
function parseThresholds(options) {
  const thresholds = {};

  for (const category of CATEGORIES) {
    const flag = `min-${category}`;
    const camel = flag.replace(/-([a-z])/g, (m, letter) => letter.toUpperCase());
    const raw = options[flag] !== undefined ? options[flag] : options[camel];

    if (raw === undefined || raw === null || raw === '' || raw === false) {
      continue;
    }

    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`--${flag} must be a score between 0 and 100 (got "${raw}")`);
    }

    thresholds[category] = value;
  }

  return thresholds;
}

/**
 * The perceived-usability bar: `--max-lcp=<ms>` in both the dashed and yargs'
 * camelized form, null when the flag is absent (report-only, same default as
 * the category thresholds). Ian's bar is 1s to usable (#467).
 * @param {object} options - the parsed CLI options
 * @returns {number|null} the maximum acceptable LCP in milliseconds
 */
function parseMaxLcp(options) {
  const raw = options['max-lcp'] !== undefined ? options['max-lcp'] : options.maxLcp;

  if (raw === undefined || raw === null || raw === '' || raw === false) {
    return null;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--max-lcp must be a duration in milliseconds above 0 (got "${raw}")`);
  }

  return value;
}

/**
 * The pages to audit: the home page ALWAYS, plus every path argument, in the
 * order given and de-duplicated.
 * @param {object} options - the parsed CLI options (`_[0]` is the command name)
 * @returns {string[]} site-root-relative page paths
 */
function parsePages(options) {
  const args = (options._ || []).slice(1).map(String);
  const pages = ['/'];

  for (const arg of args) {
    if (arg.includes('://')) {
      throw new Error(`Page arguments are site paths, not URLs — pass "${new URL(arg).pathname}" instead of "${arg}"`);
    }

    const page = `/${arg.replace(/^\/+/, '').replace(/\/+$/, '')}`;
    if (page !== '/' && !pages.includes(page)) {
      pages.push(page);
    }
  }

  return pages;
}

/**
 * The built file a request path serves, or null when nothing does. Clean-URL
 * resolution mirrors the dev server's contract (`/pricing` → `pricing.html`)
 * so an audit measures the same URLs a browser walks in dev and on Pages.
 * @param {string} outDir - the build output directory
 * @param {string} pathname - the request path (no query string)
 * @returns {string|null} absolute file path
 */
function resolveFile(outDir, pathname) {
  const root = path.resolve(outDir);

  // A malformed percent-escape is not a candidate for anything
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (e) {
    return null;
  }

  const clean = decoded.replace(/\/+$/, '');
  const candidates = clean ? [clean, `${clean}.html`, `${clean}/index.html`] : ['/index.html'];

  for (const candidate of candidates) {
    const resolved = path.resolve(root, `.${candidate}`);
    if (!resolved.startsWith(root + path.sep)) {
      continue;
    }
    if (jetpack.exists(resolved) === 'file') {
      return resolved;
    }
  }

  return null;
}

/**
 * Serve a built site on an ephemeral loopback port. Files stream (a sync read
 * would block the loop and skew the very performance numbers being measured).
 * @param {string} outDir - the build output directory
 * @returns {Promise<{ origin: string, port: number, close: function }>}
 */
function serveDist(outDir) {
  const server = http.createServer((req, res) => {
    const file = resolveFile(outDir, (req.url || '/').split('?')[0]);

    if (!file) {
      res.statusCode = 404;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end('Not found');
      return;
    }

    res.statusCode = 200;
    res.setHeader('content-type', CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        port,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

/**
 * Headless Chrome, found the way every browser lane in this repo finds it:
 * puppeteer's downloaded Chrome for Testing (scripts/e2e-flows.js,
 * packages/extension's chromium runner), with CHROME_PATH — chrome-launcher's
 * own convention — winning when set. Null means "let chrome-launcher find a
 * system Chrome"; nothing here hardcodes a path.
 * @returns {string|null} absolute Chrome executable path
 */
function resolveChromePath() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }

  // puppeteer is not a dependency of this framework — it is the repo's test
  // browser, present in dev and absent in a consumer install. Missing is an
  // expected external condition, not a bug: fall through to system Chrome.
  try {
    const executable = require('puppeteer').executablePath();
    return jetpack.exists(executable) === 'file' ? executable : null;
  } catch (e) {
    return null;
  }
}

/**
 * Launch headless Chrome for Lighthouse to drive.
 * @returns {Promise<object>} the chrome-launcher instance (`.port`, `.kill()`)
 */
async function launchChrome() {
  const { launch } = await import('chrome-launcher');

  try {
    return await launch({
      chromePath: resolveChromePath() || undefined,
      chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox'],
    });
  } catch (error) {
    throw new Error(`Could not launch headless Chrome (${error.message}) — install one with \`npx puppeteer browsers install chrome\`, or point CHROME_PATH at an executable`);
  }
}

/**
 * Run Lighthouse against one URL through an already-launched Chrome.
 * @param {string} url - the absolute URL to audit
 * @param {number} chromePort - the launched Chrome's debugging port
 * @returns {Promise<{ scores: object, metrics: object }>} the category scores and the field metrics
 */
async function auditPage(url, chromePort) {
  // Lighthouse is ESM-only from v10 — dynamic import is how CJS reaches it
  const lighthouse = (await import('lighthouse')).default;

  const result = await lighthouse(url, {
    port: chromePort,
    output: 'json',
    logLevel: 'error',
    onlyCategories: CATEGORIES,
    // A local static server is HTTP/1.1 by definition — docking the page for
    // it would measure this command, not the site
    skipAudits: ['uses-http2'],
  });

  return { scores: categoryScores(result.lhr), metrics: pageMetrics(result.lhr) };
}

/**
 * The four category scores out of 100 from a Lighthouse result.
 * @param {object} lhr - the Lighthouse result object
 * @returns {Object<string, number|null>} null when a category produced no score
 */
function categoryScores(lhr) {
  const scores = {};

  for (const category of CATEGORIES) {
    const score = lhr.categories && lhr.categories[category] && lhr.categories[category].score;
    scores[category] = typeof score === 'number' ? Math.round(score * 100) : null;
  }

  return scores;
}

/**
 * The field metrics beside the scores: LCP in whole milliseconds, CLS as
 * Lighthouse scored it, and the form factor the run emulated (so a printed
 * number is never mistaken for the other device class). A metric Lighthouse
 * did not produce reads null, never 0 — an unmeasured page is not a fast one.
 * @param {object} lhr - the Lighthouse result object
 * @returns {{ lcp: number|null, cls: number|null, formFactor: string|null }}
 */
function pageMetrics(lhr) {
  const audits = lhr.audits || {};

  const numeric = (id) => {
    const value = audits[id] && audits[id].numericValue;
    return typeof value === 'number' ? value : null;
  };

  const lcp = numeric(METRIC_AUDITS.lcp);

  return {
    lcp: lcp === null ? null : Math.round(lcp),
    cls: numeric(METRIC_AUDITS.cls),
    formFactor: (lhr.configSettings && lhr.configSettings.formFactor) || null,
  };
}

/**
 * The gate: every page/category pair that came in under its threshold. A
 * category with no threshold is never gated; a MISSING score under an armed
 * threshold is a failure (an audit that did not run has not passed).
 * @param {Array<{ page: string, scores: object }>} results - the per-page scores
 * @param {Object<string, number>} thresholds - category id → minimum score
 * @returns {Array<{ page: string, category: string, score: number|null, min: number }>}
 */
function evaluateScores(results, thresholds) {
  const failures = [];

  for (const { page, scores } of results) {
    for (const [category, min] of Object.entries(thresholds)) {
      const score = scores[category];
      if (typeof score !== 'number' || score < min) {
        failures.push({ page, category, score: typeof score === 'number' ? score : null, min });
      }
    }
  }

  return failures;
}

/**
 * The LCP gate: every page whose largest contentful paint came in over the
 * bar. No bar = no gate; a MISSING LCP under an armed bar is a failure (same
 * doctrine as the scores — a run that measured nothing has not passed).
 * @param {Array<{ page: string, metrics: object }>} results - the per-page results
 * @param {number|null} maxLcp - the maximum acceptable LCP in milliseconds
 * @returns {Array<{ page: string, metric: string, value: number|null, max: number }>}
 */
function evaluateLcp(results, maxLcp) {
  if (typeof maxLcp !== 'number') {
    return [];
  }

  const failures = [];

  for (const { page, metrics } of results) {
    const lcp = metrics && metrics.lcp;
    if (typeof lcp !== 'number' || lcp > maxLcp) {
      failures.push({ page, metric: 'lcp', value: typeof lcp === 'number' ? lcp : null, max: maxLcp });
    }
  }

  return failures;
}

/**
 * One page's printed line: the four scores, then the metrics, then the form
 * factor the run emulated.
 * @param {Object<string, number|null>} scores - category id → score out of 100
 * @param {object} metrics - the page's LCP/CLS/form factor
 * @returns {string} the summary, without the page path
 */
function formatSummary(scores, metrics) {
  const parts = CATEGORIES.map((category) => `${LABELS[category]} ${formatScore(scores[category])}`);
  parts.push(`LCP ${formatMs(metrics.lcp)}`, `CLS ${formatCls(metrics.cls)}`);

  return `${parts.join(' · ')} (${metrics.formFactor || 'unknown'} emulation)`;
}

function formatScore(score) {
  return typeof score === 'number' ? `${score}/100` : 'n/a';
}

function formatMs(ms) {
  return typeof ms === 'number' ? `${Math.round(ms)} ms` : 'n/a';
}

function formatCls(cls) {
  return typeof cls === 'number' ? cls.toFixed(3) : 'n/a';
}

// Exposed for tests (the command function stays the main export)
module.exports.parseThresholds = parseThresholds;
module.exports.parseMaxLcp = parseMaxLcp;
module.exports.parsePages = parsePages;
module.exports.evaluateScores = evaluateScores;
module.exports.evaluateLcp = evaluateLcp;
module.exports.categoryScores = categoryScores;
module.exports.pageMetrics = pageMetrics;
module.exports.formatSummary = formatSummary;
module.exports.resolveFile = resolveFile;
module.exports.serveDist = serveDist;
module.exports.resolveChromePath = resolveChromePath;
module.exports.launchChrome = launchChrome;
module.exports.auditPage = auditPage;
