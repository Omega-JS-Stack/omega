/**
 * The data-display surface (#72), ported from the workkit tower: the chart
 * helper (`core/js/libs/charts.js` — lazy Chart.js, token colors, the chart
 * slot), the `data/org-chart` component's animated connectors, the
 * categorical tone tokens/utilities, and the `.omega-interactive` card
 * affordance.
 *
 * The four chart BUILDERS (bar/stacked/doughnut/line) are not pinned here —
 * Chart.js needs a real 2d context, which node has none of. What is pinned is
 * everything around them: the load lane, the token reads, and the slot markup
 * that write-on-change rendering depends on.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const sass = require('sass');

const { buildAssets } = require('../src/assets.js');
const { buildWith: sharedBuildWith, miniData, PKG } = require('./lib/build.js');

// Namespace this file's Eleventy output dirs (test files run concurrently)
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'dataviz-test');

const charts = require('../core/js/libs/charts.js');
const ORG_CHART = path.join(PKG, 'themes', 'classy', '_components', 'data', 'org-chart');

/** Install a token sheet as the document's computed :root styles. */
function stubTokens(tokens) {
  global.document = { documentElement: {} };
  global.getComputedStyle = () => ({ getPropertyValue: (name) => tokens[name] || '' });
}

// ─── Chart helper ────────────────────────────────────────────────────────────

test('chartSlot: no library yet → the figures-are-in-the-table line, never a hole', () => {
  assert.equal(charts.chartsReady(), false, 'nothing is loaded until a page asks');
  assert.match(charts.chartSlot('chart-signups'), /chart library unavailable/);
});

test('chartSlot: an unusable id is a programmer error and crashes', () => {
  assert.throws(() => charts.chartSlot('chart"><img src=x>'), /not a usable element id/);
  assert.throws(() => charts.chartSlot(''), /not a usable element id/);
});

test('loadCharts: pulls the real Chart.js on demand, once', async () => {
  assert.equal(await charts.loadCharts(), true);
  assert.equal(charts.chartsReady(), true, 'the sync gate render paths read flips');
  assert.equal(await charts.loadCharts(), true, 'idempotent — safe on every poll');
});

test('chartSlot: the box carries the height AND stamps its series for write-on-change', () => {
  const markup = charts.chartSlot('chart-signups', 180, [3, 1, '4']);

  assert.match(markup, /<canvas id="chart-signups"><\/canvas>/);
  assert.match(markup, /height: 180px/, 'a canvas has no intrinsic height — the box carries it');
  assert.match(markup, /data-series="3,1,4"/, 'data-only changes reach swap() through the stamp');
  assert.match(charts.chartSlot('chart-signups'), /data-series=""/, 'no series → an empty stamp, not "undefined"');
});

test('chartColors: the categorical palette IS the tone ramp — same color, same thing', () => {
  stubTokens({
    '--omega-ink-muted': '#6d6d6c',
    '--omega-line': '#e8e8e6',
    '--omega-accent': '#3b5bdb',
    '--omega-chart-1': '#3b5bdb',
    '--omega-chart-2': '#0f8fa9',
    '--omega-chart-3': '#7a45b5',
    '--omega-chart-4': '#b0416a',
    '--omega-chart-5': '#a06a08',
    '--omega-chart-6': '#6a7f2b',
  });

  const colors = charts.chartColors();

  assert.equal(colors.text, '#6d6d6c');
  assert.equal(colors.grid, '#e8e8e6');
  assert.equal(colors.accent, '#3b5bdb');
  assert.deepEqual(colors.palette, ['#3b5bdb', '#0f8fa9', '#7a45b5', '#b0416a', '#a06a08', '#6a7f2b']);
});

test('chartColors: a sheet-less page still draws — bootstrap/hardcoded fallbacks', () => {
  stubTokens({ '--bs-body-color': '#212529' });

  const colors = charts.chartColors();

  assert.equal(colors.text, '#212529', 'bootstrap variable is the first fallback');
  assert.equal(colors.accent, '#2563eb', 'the token sheet placeholder is the last');
  assert.equal(colors.palette.length, 6);
});

test('resolveColor: Chart.js needs a real color, so var() tokens resolve first', () => {
  stubTokens({ '--omega-accent': '#3b5bdb', '--omega-ok': '#12925c' });

  assert.equal(charts.resolveColor('var(--omega-ok)'), '#12925c');
  assert.equal(charts.resolveColor('#ff0000'), '#ff0000', 'a literal passes through');
  assert.equal(charts.resolveColor('var(--nope)'), '#3b5bdb', 'an unset token falls back to the accent');
});

test('charts.js names Chart.js ONLY in the lazy import — a chartless page pays nothing', () => {
  const source = fs.readFileSync(path.join(PKG, 'core', 'js', 'libs', 'charts.js'), 'utf8');

  assert.ok(!/^import .*chart\.js/m.test(source), 'no static import — esbuild would fold it into the entry');
  assert.match(source, /await import\('chart\.js\/auto'\)/, 'the split chunk is fetched when a page asks');
});

// #74: the admin dashboard carried its own getChartColors and a STATIC
// `import 'chart.js'`, which folded the library into the entry every admin
// visit paid for. It goes through the helper now — keeping status hues,
// because a plan slice means healthy/attention/trouble, not "category 3".
test('#74: the admin dashboard draws through the helper, and never names Chart.js', () => {
  const source = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'admin', 'index.js'), 'utf8');

  assert.ok(!/from ['"]chart\.js/.test(source), 'the page never imports the library — delivery stays the helper\'s to change');
  assert.ok(!/\bnew Chart\b/.test(source), 'and never constructs one');
  assert.ok(!/getChartColors/.test(source), 'no second copy of the token reads');
  assert.match(source, /import \{[^}]*loadCharts[^}]*\} from '__main_assets__\/js\/libs\/charts\.js'/, 'the lazy load goes through the helper');
  assert.match(source, /await loadCharts\(\)/, 'and it is awaited before a builder is called');

  // Status hues, passed as tokens so the helper's resolveColor reads the live
  // sheet — the categorical ramp would trade the meaning for "different".
  for (const token of ['--omega-accent', '--omega-ok', '--omega-warn', '--omega-danger']) {
    assert.ok(source.includes(`'var(${token})'`), `the plan doughnut keeps its ${token} slice`);
  }
  assert.ok(!/colors\.palette/.test(source), 'nothing reaches for the categorical ramp');
});

test('#74: the admin chart canvases sit in height-bearing boxes (the helper drops the aspect ratio)', () => {
  const layout = fs.readFileSync(path.join(PKG, 'core', '_layouts', 'blueprint', 'admin', 'dashboard', 'index.html'), 'utf8');
  const css = sass.compile(path.join(PKG, 'core', 'css', 'pages', 'admin', 'index.scss'), {
    logger: { warn: () => {}, debug: () => {} },
  }).css;

  for (const id of ['chart-signups', 'chart-plans']) {
    assert.match(layout, new RegExp(`admin-chart-box[^>]*>\\s*<canvas id="${id}"`), `${id} is wrapped in the sized box`);
  }
  assert.match(css, /\.admin-chart-box\s*\{[^}]*position: relative/s, 'the box is the canvas\' positioning parent');
  assert.match(css, /\.admin-chart-box\s*\{[^}]*height: \d+px/s, 'a canvas has no intrinsic height — the box carries it');
});

test('the real bundler splits Chart.js into its own chunk — the page entry stays free of it', async () => {
  // A one-page consumer layer that does what a charting page does: import the
  // framework helper, never the library.
  const layer = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-charts-'));
  fs.mkdirSync(path.join(layer, 'js', 'pages'), { recursive: true });
  fs.writeFileSync(
    path.join(layer, 'js', 'pages', 'index.js'),
    "import { loadCharts, barChart } from '__main_assets__/js/libs/charts.js';\nexport default async () => { await loadCharts(); barChart('chart-x', { labels: [], values: [] }); };\n",
  );

  const outDir = path.join(PKG, '.omega', 'dataviz-test-assets');
  fs.rmSync(outDir, { recursive: true, force: true });
  const themeRoots = [path.join(PKG, 'themes', 'classy')];
  const manifest = await buildAssets({
    layers: [layer, ...themeRoots, path.join(PKG, 'core')],
    themeRoots,
    sectionRoots: [layer, ...themeRoots],
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    outDir,
    clientEntry: path.join(PKG, '..', 'client', 'src', 'index.js'),
  });

  // Chart.js' own words — present in the library, nowhere else.
  const MARKER = "Failed to create chart: can't acquire context";
  const files = fs.readdirSync(path.join(outDir, 'assets', 'js', 'chunks')).map((name) => path.join(outDir, 'assets', 'js', 'chunks', name));
  const entry = path.join(outDir, manifest.js.pages.index.slice(1));
  const carriers = [...files, entry].filter((file) => fs.readFileSync(file, 'utf8').includes(MARKER));

  assert.equal(carriers.length, 1, `Chart.js lands in exactly one file (found ${carriers.length})`);
  assert.ok(carriers[0].includes(`${path.sep}chunks${path.sep}`), 'and that file is a chunk, fetched only when a page asks');
  assert.ok(!fs.readFileSync(entry, 'utf8').includes(MARKER), 'the page entry never carries the library');
});

// ─── The org-chart component ─────────────────────────────────────────────────

test('data/org-chart: both demo variants render through the real engine', async () => {
  const pages = await buildWith(miniData);
  const page = pages.get('/test/sections/component/data/org-chart');

  assert.ok(page, 'the entry joins the library with zero authoring (spec §9)');
  assert.equal((page.match(/class="omega-org-chart"/g) || []).length, 2, 'both demo variants render live');
  assert.equal((page.match(/omega-org-chart__node/g) || []).length, 4, 'one node per entry');
  assert.equal((page.match(/omega-org-chart__children/g) || []).length, 1, 'the root-alone variant draws no bus — no children, no trunk');
  assert.ok(page.includes('omega-badge-tone omega-tone-2'), 'a node chip rides the shared categorical ramp');
});

test('data/org-chart: connectors are animated GRADIENTS, tilt narrow, and stop for reduced motion', () => {
  const warnings = [];
  const result = sass.compile(path.join(ORG_CHART, 'component.scss'), {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  });

  assert.deepEqual(warnings, [], 'new css never warns — the #16 bar');

  // Borders cannot animate a dash — every line is a repeating gradient.
  assert.match(result.css, /repeating-linear-gradient\(180deg/, 'the trunk/stub run down');
  assert.match(result.css, /repeating-linear-gradient\(90deg/, 'the bus runs across');
  assert.ok(!/border-style:\s*dashed/.test(result.css), 'no dashed borders — they cannot move');
  assert.match(result.css, /@keyframes omega-org-flow-down/);
  assert.match(result.css, /@keyframes omega-org-flow-right/);
  assert.match(result.css, /var\(--omega-line\)/, 'the line color comes from the token sheet');

  // The narrow tilt: the same tree on its side, spine down the left.
  assert.match(result.css, /max-width: 767\.98px/, 'the tilt rides bootstrap\'s md cutover');

  // The carve-out names the trimmed first/last segments too — a media query
  // lends no specificity of its own.
  const reduced = result.css.slice(result.css.indexOf('prefers-reduced-motion'));
  assert.match(reduced, /prefers-reduced-motion: reduce/);
  assert.match(reduced, /:first-child::after/, 'the trimmed segments are named or they keep animating');
  assert.match(reduced, /:last-child::after/);
});

// ─── Tone tokens + the interactive card affordance ───────────────────────────

test('tone sheet: six categorical slots, each pointing at its chart token', () => {
  const warnings = [];
  const result = sass.compile(path.join(PKG, 'core', 'css', 'core', '_tones.scss'), {
    logger: { warn: (message) => warnings.push(message), debug: () => {} },
  });

  assert.deepEqual(warnings, [], 'new core css never warns — the #16 bar');

  for (const slot of [1, 2, 3, 4, 5, 6]) {
    assert.match(result.css, new RegExp(`\\.omega-tone-${slot}\\s*\\{\\s*--omega-tone: var\\(--omega-chart-${slot}\\)`), `slot ${slot} rides its chart token`);
  }
  assert.ok(!/\.omega-tone-7/.test(result.css), 'six slots, not a ramp that wraps silently');
  assert.match(result.css, /\.omega-badge-tone\s*\{[^}]*color-mix\(in srgb, var\(--omega-tone/s, 'the chip tints its own tone');
  assert.match(result.css, /text-transform: none/, 'a tone label is an identifier, never a word');
});

test('main.scss loads the tones AFTER the theme so they outrank theme chip rules', () => {
  const main = fs.readFileSync(path.join(PKG, 'core', 'css', 'main.scss'), 'utf8');

  assert.ok(main.includes("@use 'core/_tones'"), 'the tone sheet is wired');
  assert.ok(main.indexOf("@use 'omega:theme'") < main.indexOf("@use 'core/_tones'"), 'core utilities land after the theme');
});

test('.omega-interactive: warm + lift + ring + press, all from tokens, off for reduced motion', () => {
  const result = sass.compile(path.join(PKG, 'core', 'css', 'motion', '_index.scss'), {
    logger: { warn: () => {}, debug: () => {} },
  });

  assert.match(result.css, /\.omega-interactive\s*\{[^}]*cursor: pointer/s);
  assert.match(result.css, /\.omega-interactive:hover[^{]*\{[^}]*var\(--omega-surface-2\)/s, 'the surface warms under the pointer');
  assert.match(result.css, /\.omega-interactive:focus-visible\s*\{[^}]*outline: 2px solid var\(--omega-accent-ring\)/s, 'the keyboard gets the same affordance');
  assert.match(result.css, /\.omega-interactive:active\s*\{[^}]*var\(--omega-accent-subtle\)/s, 'pressing has somewhere to land');
  assert.match(result.css, /\.omega-interactive--lift:hover[^{]*\{[^}]*translateY\(-2px\)/s, 'a card lifts; a row (no modifier) only warms');

  const reduced = result.css.slice(result.css.indexOf('prefers-reduced-motion: reduce'));
  assert.match(reduced, /\.omega-interactive/, 'the transition is dropped for reduced motion');
});
