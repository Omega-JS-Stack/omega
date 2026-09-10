/**
 * The data-display surface (#72), ported from the workkit tower: the chart
 * helper (`core/js/libs/charts.js` — lazy @tanstack/charts, token colors, the
 * chart slot), the `data/org-chart` component's animated connectors, the
 * categorical tone tokens/utilities, and the `.omega-interactive` card
 * affordance.
 *
 * The four chart BUILDERS (bar/stacked/doughnut/line) ARE pinned here (#772):
 * a TanStack definition is renderer-neutral, so `createChartScene` compiles
 * one into real geometry with no DOM at all. Around them sit the load lane,
 * the token reads, and the slot markup write-on-change rendering depends on.
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
const ORG_CHART = path.join(PKG, 'themes', 'base', '_components', 'data', 'org-chart');

/** Install a token sheet as the document's computed :root styles. */
function stubTokens(tokens) {
  global.document = { documentElement: {} };
  global.getComputedStyle = () => ({ getPropertyValue: (name) => tokens[name] || '' });
}

/**
 * The painted point markers in a compiled scene. A line mark anchors every
 * reading with an interaction dot whether or not it paints one, so the count
 * that answers "did `points: true` survive" is the marker's own scene node.
 */
function markers(scene) {
  const found = [];
  const walk = (nodes) => nodes.forEach((node) => {
    if (node.kind === 'dot' && node.key.endsWith(':dot')) {
      found.push(node);
    }
    if (node.children) {
      walk(node.children);
    }
  });

  walk(scene.nodes);
  return found.length;
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

test('loadCharts: pulls the real @tanstack/charts on demand, once', async () => {
  assert.equal(await charts.loadCharts(), true);
  assert.equal(charts.chartsReady(), true, 'the sync gate render paths read flips');
  assert.equal(await charts.loadCharts(), true, 'idempotent — safe on every poll');
});

test('chartSlot: the box carries the height AND stamps its series for write-on-change', () => {
  const markup = charts.chartSlot('chart-signups', 180, [3, 1, '4']);

  assert.match(markup, /<div id="chart-signups" style="height: 100%;"><\/div>/, 'an SVG chart has no canvas — the host is a div');
  assert.match(markup, /height: 180px/, 'the host is told the height the box carries');
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

test('resolveColor: a color scale range is real colors, so var() tokens resolve first', () => {
  stubTokens({ '--omega-accent': '#3b5bdb', '--omega-ok': '#12925c' });

  assert.equal(charts.resolveColor('var(--omega-ok)'), '#12925c');
  assert.equal(charts.resolveColor('#ff0000'), '#ff0000', 'a literal passes through');
  assert.equal(charts.resolveColor('var(--nope)'), '#3b5bdb', 'an unset token falls back to the accent');
});

// #772: a TanStack definition is renderer-neutral — `createChartScene` turns
// one into real scales, points and geometry with no DOM at all — so the four
// builders are pinned right here instead of only in a real browser.
test('#772: all four builders compile a scene with the geometry their data implies', async () => {
  stubTokens({
    '--omega-ink-muted': '#6d6d6c',
    '--omega-line': '#e8e8e6',
    '--omega-accent': '#3b5bdb',
    '--omega-chart-1': '#3b5bdb',
    '--omega-chart-2': '#0f8fa9',
    '--omega-ok': '#12925c',
    '--omega-warn': '#a06a08',
    '--omega-danger': '#b0416a',
  });

  const { createChartScene } = await import('@tanstack/charts');
  const size = { width: 400, height: 200 };
  const labels = ['Mon', 'Tue', 'Wed'];
  const values = [3, 7, 5];
  const series = [{ label: 'A', values }, { label: 'B', values: [1, 2, 3] }];
  const scene = (kind, data) => createChartScene(charts.chartDefinition(kind, data), size);

  // One bar per label, and the plot has real room to draw them in.
  const bar = scene('bar', { labels, values, label: 'Signups' });
  assert.equal(bar.points.length, labels.length, 'one bar per label');
  assert.ok(bar.chart.width > 0 && bar.chart.height > 0, 'the plot has area after the guides are measured');
  assert.deepEqual(bar.scales.x.domain, labels, 'the categorical axis IS the labels, in order');

  // horizontal transposes it: the labels run down the y axis.
  const ranked = scene('bar', { labels, values, horizontal: true });
  assert.equal(ranked.points.length, labels.length, 'one row per label');
  assert.deepEqual(ranked.scales.y.domain, labels, 'ranked rows put the categories on y');

  // Stacked: one point per label per series, painted off the ramp in order.
  const stacked = scene('stacked', { labels, series });
  assert.equal(stacked.points.length, labels.length * series.length, 'labels × series');
  assert.deepEqual(stacked.colors.range, ['#3b5bdb', '#0f8fa9'], 'series ride the categorical ramp, in order');

  // The doughnut: one arc per value, and status tokens resolved to real hues.
  const doughnut = scene('doughnut', {
    labels,
    values,
    colors: ['var(--omega-ok)', 'var(--omega-warn)', 'var(--omega-danger)'],
  });
  assert.equal(doughnut.points.length, values.length, 'one arc per value');
  assert.deepEqual(doughnut.colors.range, ['#12925c', '#a06a08', '#b0416a'], 'STATUS beats the categorical ramp');

  // The line: one point per value, and `points: true` paints a marker on each
  // one, so a single reading is visible where a bare polyline shows nothing.
  const line = scene('line', { labels, series: [{ label: 'A', values }] });
  assert.equal(line.points.length, values.length, 'one point per value');
  assert.equal(markers(line), values.length, 'every reading is painted, not just joined');

  for (const [kind, drawn] of Object.entries({ bar, ranked, stacked, doughnut, line })) {
    assert.equal(drawn.theme.grid, '#e8e8e6', `${kind} draws its gridlines in the token sheet's line color`);
  }

  // A polled page repaints on every feed answer, so an animated chart would
  // spend most of its life growing back out of the axis. Off, said out loud.
  for (const kind of ['bar', 'stacked', 'doughnut', 'line']) {
    const definition = charts.chartDefinition(kind, { labels, values, series });
    assert.equal(definition.svgAnimation, false, `${kind} draws in the first painted frame`);
  }
});

// A chart here counts THINGS, and the library's default tick policy is a
// responsive COUNT of ticks — on a small domain that lands on 0.5, and half a
// signup is not a reading. The rendered LABEL is what the reader sees, and the
// library's own formatter prints "0.0"/"1.0" once the domain is that small, so
// the labels are the claim. Every shape carrying a value axis is pinned.
test('#772: a count axis is labelled in whole numbers, never half a signup', async () => {
  stubTokens({ '--omega-accent': '#3b5bdb' });

  const { createChartScene } = await import('@tanstack/charts');
  const size = { width: 400, height: 200 };
  const labels = ['Mon', 'Tue', 'Wed'];
  const values = [0, 1, 1]; // the domain the library halves AND prints decimal
  const series = [{ label: 'A', values }, { label: 'B', values: [1, 0, 0] }];
  const ticks = (kind, data, dimension) => createChartScene(charts.chartDefinition(kind, data), size)
    .scales[dimension].ticks;
  const axisLabels = (...args) => ticks(...args).map((tick) => tick.label);

  const axes = {
    bar: axisLabels('bar', { labels, values }, 'y'),
    ranked: axisLabels('bar', { labels, values, horizontal: true }, 'x'),
    stacked: axisLabels('stacked', { labels, series }, 'y'),
    line: axisLabels('line', { labels, series }, 'y'),
  };

  for (const [kind, drawn] of Object.entries(axes)) {
    assert.ok(drawn.length > 1, `${kind} draws a readable axis, not a single mark`);
    for (const label of drawn) {
      assert.match(label, /^-?\d+$/, `${kind} prints a plain integer, got "${label}" of ${JSON.stringify(drawn)}`);
    }
  }

  // The ladder keeps the labels round as the counts grow, not just integral.
  assert.deepEqual(axisLabels('bar', { labels, values: [140, 22, 3] }, 'y'), ['0', '50', '100', '150']);

  // A negative reading widens the span DOWN instead of falling out of the
  // plot, and zero stays in view — a bar's length is read from the baseline.
  const negative = ticks('bar', { labels, values: [-5, 3, 10] }, 'y');
  const [lowest] = createChartScene(charts.chartDefinition('bar', { labels, values: [-5, 3, 10] }), size).scales.y.domain;

  assert.ok(lowest <= -5, `the axis reaches the lowest reading, got ${lowest}`);
  assert.ok(negative.some((tick) => tick.value === 0), 'zero stays on the axis');
  assert.deepEqual(negative.map((tick) => tick.label), ['-5', '0', '5', '10']);
});

// #800: a hover named the CHANNELS — "x" and "y", the library's own default —
// instead of the thing being read. Every builder formats its own line now, and
// the data argument carries the unit (`format`) or the whole line (`tooltip`),
// so a page whose chart data is nothing but JSON still reads correctly.
test('#800: a tooltip names the series and the label, in the data\'s own units', async () => {
  stubTokens({ '--omega-accent': '#3b5bdb' });

  const { createChartScene } = await import('@tanstack/charts');
  const size = { width: 400, height: 200 };
  const labels = ['Mon', 'Tue', 'Wed'];
  const values = [3, 7, 5];
  const series = [{ label: 'A', values }, { label: 'B', values: [1, 2, 3] }];
  // The line a hover prints: the definition's own format, over the point the
  // compiled scene hands the tooltip.
  const hover = (kind, data, index = 1) => {
    const definition = charts.chartDefinition(kind, data);
    return definition.tooltip.format(createChartScene(definition, size).points[index]);
  };

  assert.equal(hover('bar', { labels, values }), 'Tue: 7', 'a bar says its label, never "x"');
  assert.equal(hover('line', { labels, series }), 'A · Tue: 7', 'a line names the series the reading belongs to');
  assert.equal(hover('stacked', { labels, series }), 'A · Tue: 7', 'so does a segment of a stack');
  assert.equal(hover('doughnut', { labels, values }, 0), 'Mon: 3 (20.0%)', 'the doughnut keeps its share of the whole');

  // A count prints as itself; a fraction gets two places without anyone saying so.
  assert.equal(hover('bar', { labels, values: [3, 7.456, 5] }), 'Tue: 7.46');

  // The unit travels with the DATA, so an island carrying JSON alone prints
  // money as money — in the tooltip and on the axis it is read against.
  const money = { labels, values, format: { prefix: '$', decimals: 2 } };
  assert.equal(hover('bar', money), 'Tue: $7.00');
  assert.deepEqual(
    createChartScene(charts.chartDefinition('bar', money), size).scales.y.ticks.map((tick) => tick.label),
    ['$0.00', '$2.00', '$4.00', '$6.00', '$8.00'],
    'the axis says the same unit as the tooltip',
  );
  assert.equal(hover('line', { labels, series, format: { suffix: '%' } }), 'A · Tue: 7%');

  // A page with JS owns the line outright.
  assert.equal(
    hover('bar', { labels, values, tooltip: (point) => `${point.datum.value} signups on ${point.datum.label}` }),
    '7 signups on Tue',
    'an authored tooltip beats the default outright',
  );
});

test('charts.js names the library ONLY in lazy imports — a chartless page pays nothing', () => {
  const source = fs.readFileSync(path.join(PKG, 'core', 'js', 'libs', 'charts.js'), 'utf8');

  assert.ok(!/^import .*@tanstack\/charts/m.test(source), 'no static import — esbuild would fold it into the entry');
  assert.match(source, /import\('@tanstack\/charts'\)/, 'the split chunk is fetched when a page asks');
  assert.match(source, /import\('@tanstack\/charts\/polar'\)/, 'polar geometry is its own capability subpath');
});

// #74: the admin dashboard carried its own getChartColors and a STATIC import
// of the chart library, which folded it into the entry every admin visit paid
// for. It goes through the helper now — keeping status hues, because a plan
// slice means healthy/attention/trouble, not "category 3".
test('#74: the admin dashboard draws through the helper, and never names the library', () => {
  const source = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'admin', 'index.js'), 'utf8');

  assert.ok(!/from ['"]@tanstack\/charts/.test(source), 'the page never imports the library — delivery stays the helper\'s to change');
  assert.ok(!/\bmountChart\b/.test(source), 'and never mounts one');
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

test('#74: the admin chart hosts sit in height-bearing boxes (the helper is told the height)', () => {
  const layout = fs.readFileSync(path.join(PKG, 'core', '_layouts', 'blueprint', 'admin', 'dashboard', 'index.html'), 'utf8');
  const css = sass.compile(path.join(PKG, 'core', 'css', 'pages', 'admin', 'index.scss'), {
    logger: { warn: () => {}, debug: () => {} },
  }).css;

  for (const id of ['chart-signups', 'chart-plans']) {
    assert.match(layout, new RegExp(`admin-chart-box[^>]*>\\s*<div id="${id}" class="h-100"`), `${id} is a host div filling the sized box`);
  }
  assert.match(css, /\.admin-chart-box\s*\{[^}]*position: relative/s, 'the box is the host\' positioning parent');
  assert.match(css, /\.admin-chart-box\s*\{[^}]*height: \d+px/s, 'the box carries the height the helper measures off it');
});

test('the real bundler splits the library into its own chunk — the page entry stays free of it', async () => {
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

  // The library's own default palette — present in its bundle, nowhere else.
  const MARKER = 'var(--ts-chart-1, #2563eb)';
  const files = fs.readdirSync(path.join(outDir, 'assets', 'js', 'chunks')).map((name) => path.join(outDir, 'assets', 'js', 'chunks', name));
  // A manifest key holds EVERY layer's bundle for that page (#624), and each
  // one is an entry the browser loads — so the claim is about all of them.
  const entries = manifest.js.pages.index.map((url) => path.join(outDir, url.slice(1)));
  const carriers = [...files, ...entries].filter((file) => fs.readFileSync(file, 'utf8').includes(MARKER));

  assert.ok(entries.length >= 1, 'the charting page bundled');
  assert.equal(carriers.length, 1, `the library lands in exactly one file (found ${carriers.length})`);
  assert.ok(carriers[0].includes(`${path.sep}chunks${path.sep}`), 'and that file is a chunk, fetched only when a page asks');
  for (const entry of entries) {
    assert.ok(!fs.readFileSync(entry, 'utf8').includes(MARKER), `no page entry carries the library (${path.basename(entry)})`);
  }
});

// ─── The org-chart component ─────────────────────────────────────────────────

test('data/org-chart: both demo variants render through the real engine', async () => {
  const pages = await buildWith(miniData);

  assert.ok(pages.get('/test/components/data/org-chart'), 'the entry joins the library with zero authoring (spec §9)');

  // Each variant owns its own embedded-frame page now (#463).
  const four = pages.get('/test/components/data/org-chart/frames/root-over-four-nodes');
  const alone = pages.get('/test/components/data/org-chart/frames/root-alone');
  assert.ok(four && alone, 'both demo variants render live, one frame each');

  const page = four + alone;
  assert.equal((page.match(/class="omega-org-chart"/g) || []).length, 2, 'the component renders in both');
  assert.equal((page.match(/omega-org-chart__node/g) || []).length, 4, 'one node per entry');
  assert.equal((page.match(/omega-org-chart__children/g) || []).length, 1, 'the root-alone variant draws no bus — no children, no trunk');
  assert.ok(four.includes('omega-badge-tone omega-tone-2'), 'a node chip rides the shared categorical ramp');
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
