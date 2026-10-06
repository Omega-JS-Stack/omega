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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'dataviz',
  tests: [
    // ─── Chart helper ────────────────────────────────────────────────────────────

    {
      name: 'chartSlot: no library yet → the figures-are-in-the-table line, never a hole',
      run: (ctx) => {
        ctx.expect(charts.chartsReady(), 'nothing is loaded until a page asks').toBe(false);
        ctx.expect(charts.chartSlot('chart-signups')).toMatch(/chart library unavailable/);
      },
    },

    {
      name: 'chartSlot: an unusable id is a programmer error and crashes',
      run: (ctx) => {
        ctx.expect(() => charts.chartSlot('chart"><img src=x>')).toThrow(/not a usable element id/);
        ctx.expect(() => charts.chartSlot('')).toThrow(/not a usable element id/);
      },
    },

    {
      name: 'loadCharts: pulls the real @tanstack/charts on demand, once',
      run: async (ctx) => {
        ctx.expect(await charts.loadCharts()).toBe(true);
        ctx.expect(charts.chartsReady(), 'the sync gate render paths read flips').toBe(true);
        ctx.expect(await charts.loadCharts(), 'idempotent — safe on every poll').toBe(true);
      },
    },

    {
      name: 'chartSlot: the box carries the height AND stamps its series for write-on-change',
      run: (ctx) => {
        const markup = charts.chartSlot('chart-signups', 180, [3, 1, '4']);

        ctx.expect(markup, 'an SVG chart has no canvas — the host is a div').toMatch(/<div id="chart-signups" style="height: 100%;"><\/div>/);
        ctx.expect(markup, 'the host is told the height the box carries').toMatch(/height: 180px/);
        ctx.expect(markup, 'data-only changes reach swap() through the stamp').toMatch(/data-series="3,1,4"/);
        ctx.expect(charts.chartSlot('chart-signups'), 'no series → an empty stamp, not "undefined"').toMatch(/data-series=""/);
      },
    },

    {
      name: 'chartColors: the categorical palette IS the tone ramp — same color, same thing',
      run: (ctx) => {
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

        ctx.expect(colors.text).toBe('#6d6d6c');
        ctx.expect(colors.grid).toBe('#e8e8e6');
        ctx.expect(colors.accent).toBe('#3b5bdb');
        ctx.expect(colors.palette).toEqual(['#3b5bdb', '#0f8fa9', '#7a45b5', '#b0416a', '#a06a08', '#6a7f2b']);
      },
    },

    {
      name: 'chartColors: a sheet-less page still draws — bootstrap/hardcoded fallbacks',
      run: (ctx) => {
        stubTokens({ '--bs-body-color': '#212529' });

        const colors = charts.chartColors();

        ctx.expect(colors.text, 'bootstrap variable is the first fallback').toBe('#212529');
        ctx.expect(colors.accent, 'the token sheet placeholder is the last').toBe('#2563eb');
        ctx.expect(colors.palette.length).toBe(6);
      },
    },

    {
      name: 'resolveColor: a color scale range is real colors, so var() tokens resolve first',
      run: (ctx) => {
        stubTokens({ '--omega-accent': '#3b5bdb', '--omega-ok': '#12925c' });

        ctx.expect(charts.resolveColor('var(--omega-ok)')).toBe('#12925c');
        ctx.expect(charts.resolveColor('#ff0000'), 'a literal passes through').toBe('#ff0000');
        ctx.expect(charts.resolveColor('var(--nope)'), 'an unset token falls back to the accent').toBe('#3b5bdb');
      },
    },

    // #772: a TanStack definition is renderer-neutral — `createChartScene` turns
    // one into real scales, points and geometry with no DOM at all — so the four
    // builders are pinned right here instead of only in a real browser.
    {
      name: '#772: all four builders compile a scene with the geometry their data implies',
      run: async (ctx) => {
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
        ctx.expect(bar.points.length, 'one bar per label').toBe(labels.length);
        ctx.expect(bar.chart.width > 0 && bar.chart.height > 0, 'the plot has area after the guides are measured').toBeTruthy();
        ctx.expect(bar.scales.x.domain, 'the categorical axis IS the labels, in order').toEqual(labels);

        // horizontal transposes it: the labels run down the y axis.
        const ranked = scene('bar', { labels, values, horizontal: true });
        ctx.expect(ranked.points.length, 'one row per label').toBe(labels.length);
        ctx.expect(ranked.scales.y.domain, 'ranked rows put the categories on y').toEqual(labels);

        // Stacked: one point per label per series, painted off the ramp in order.
        const stacked = scene('stacked', { labels, series });
        ctx.expect(stacked.points.length, 'labels × series').toBe(labels.length * series.length);
        ctx.expect(stacked.colors.range, 'series ride the categorical ramp, in order').toEqual(['#3b5bdb', '#0f8fa9']);

        // The doughnut: one arc per value, and status tokens resolved to real hues.
        const doughnut = scene('doughnut', {
          labels,
          values,
          colors: ['var(--omega-ok)', 'var(--omega-warn)', 'var(--omega-danger)'],
        });
        ctx.expect(doughnut.points.length, 'one arc per value').toBe(values.length);
        ctx.expect(doughnut.colors.range, 'STATUS beats the categorical ramp').toEqual(['#12925c', '#a06a08', '#b0416a']);

        // The line: one point per value, and `points: true` paints a marker on each
        // one, so a single reading is visible where a bare polyline shows nothing.
        const line = scene('line', { labels, series: [{ label: 'A', values }] });
        ctx.expect(line.points.length, 'one point per value').toBe(values.length);
        ctx.expect(markers(line), 'every reading is painted, not just joined').toBe(values.length);

        for (const [kind, drawn] of Object.entries({ bar, ranked, stacked, doughnut, line })) {
          ctx.expect(drawn.theme.grid, `${kind} draws its gridlines in the token sheet's line color`).toBe('#e8e8e6');
        }

        // A polled page repaints on every feed answer, so an animated chart would
        // spend most of its life growing back out of the axis. Off, said out loud.
        for (const kind of ['bar', 'stacked', 'doughnut', 'line']) {
          const definition = charts.chartDefinition(kind, { labels, values, series });
          ctx.expect(definition.svgAnimation, `${kind} draws in the first painted frame`).toBe(false);
        }
      },
    },

    // A chart here counts THINGS, and the library's default tick policy is a
    // responsive COUNT of ticks — on a small domain that lands on 0.5, and half a
    // signup is not a reading. The rendered LABEL is what the reader sees, and the
    // library's own formatter prints "0.0"/"1.0" once the domain is that small, so
    // the labels are the claim. Every shape carrying a value axis is pinned.
    {
      name: '#772: a count axis is labelled in whole numbers, never half a signup',
      run: async (ctx) => {
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
          ctx.expect(drawn.length > 1, `${kind} draws a readable axis, not a single mark`).toBeTruthy();
          for (const label of drawn) {
            ctx.expect(label, `${kind} prints a plain integer, got "${label}" of ${JSON.stringify(drawn)}`).toMatch(/^-?\d+$/);
          }
        }

        // The ladder keeps the labels round as the counts grow, not just integral.
        ctx.expect(axisLabels('bar', { labels, values: [140, 22, 3] }, 'y')).toEqual(['0', '50', '100', '150']);

        // A negative reading widens the span DOWN instead of falling out of the
        // plot, and zero stays in view — a bar's length is read from the baseline.
        const negative = ticks('bar', { labels, values: [-5, 3, 10] }, 'y');
        const [lowest] = createChartScene(charts.chartDefinition('bar', { labels, values: [-5, 3, 10] }), size).scales.y.domain;

        ctx.expect(lowest <= -5, `the axis reaches the lowest reading, got ${lowest}`).toBeTruthy();
        ctx.expect(negative.some((tick) => tick.value === 0), 'zero stays on the axis').toBeTruthy();
        ctx.expect(negative.map((tick) => tick.label)).toEqual(['-5', '0', '5', '10']);
      },
    },

    // #800: a hover named the CHANNELS — "x" and "y", the library's own default —
    // instead of the thing being read. Every builder formats its own line now, and
    // the data argument carries the unit (`format`) or the whole line (`tooltip`),
    // so a page whose chart data is nothing but JSON still reads correctly.
    {
      name: '#800: a tooltip names the series and the label, in the data\'s own units',
      run: async (ctx) => {
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

        ctx.expect(hover('bar', { labels, values }), 'a bar says its label, never "x"').toBe('Tue: 7');
        ctx.expect(hover('line', { labels, series }), 'a line names the series the reading belongs to').toBe('A · Tue: 7');
        ctx.expect(hover('stacked', { labels, series }), 'so does a segment of a stack').toBe('A · Tue: 7');
        ctx.expect(hover('doughnut', { labels, values }, 0), 'the doughnut keeps its share of the whole').toBe('Mon: 3 (20.0%)');

        // A count prints as itself; a fraction gets two places without anyone saying so.
        ctx.expect(hover('bar', { labels, values: [3, 7.456, 5] })).toBe('Tue: 7.46');

        // The unit travels with the DATA, so an island carrying JSON alone prints
        // money as money — in the tooltip and on the axis it is read against.
        const money = { labels, values, format: { prefix: '$', decimals: 2 } };
        ctx.expect(hover('bar', money)).toBe('Tue: $7.00');
        ctx.expect(createChartScene(charts.chartDefinition('bar', money), size).scales.y.ticks.map((tick) => tick.label), 'the axis says the same unit as the tooltip').toEqual(['$0.00', '$2.00', '$4.00', '$6.00', '$8.00']);
        ctx.expect(hover('line', { labels, series, format: { suffix: '%' } })).toBe('A · Tue: 7%');

        // A page with JS owns the line outright.
        ctx.expect(hover('bar', { labels, values, tooltip: (point) => `${point.datum.value} signups on ${point.datum.label}` }), 'an authored tooltip beats the default outright').toBe('7 signups on Tue');
      },
    },

    {
      name: 'charts.js names the library ONLY in lazy imports — a chartless page pays nothing',
      run: (ctx) => {
        const source = fs.readFileSync(path.join(PKG, 'core', 'js', 'libs', 'charts.js'), 'utf8');

        ctx.expect(!/^import .*@tanstack\/charts/m.test(source), 'no static import — esbuild would fold it into the entry').toBeTruthy();
        ctx.expect(source, 'the split chunk is fetched when a page asks').toMatch(/import\('@tanstack\/charts'\)/);
        ctx.expect(source, 'polar geometry is its own capability subpath').toMatch(/import\('@tanstack\/charts\/polar'\)/);
      },
    },

    // #74: the admin dashboard carried its own getChartColors and a STATIC import
    // of the chart library, which folded it into the entry every admin visit paid
    // for. It goes through the helper now — keeping status hues, because a plan
    // slice means healthy/attention/trouble, not "category 3".
    {
      name: '#74: the admin dashboard draws through the helper, and never names the library',
      run: (ctx) => {
        const source = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'admin', 'index.js'), 'utf8');

        ctx.expect(!/from ['"]@tanstack\/charts/.test(source), 'the page never imports the library — delivery stays the helper\'s to change').toBeTruthy();
        ctx.expect(!/\bmountChart\b/.test(source), 'and never mounts one').toBeTruthy();
        ctx.expect(!/getChartColors/.test(source), 'no second copy of the token reads').toBeTruthy();
        ctx.expect(source, 'the lazy load goes through the helper').toMatch(/import \{[^}]*loadCharts[^}]*\} from '__main_assets__\/js\/libs\/charts\.js'/);
        ctx.expect(source, 'and it is awaited before a builder is called').toMatch(/await loadCharts\(\)/);

        // Status hues, passed as tokens so the helper's resolveColor reads the live
        // sheet — the categorical ramp would trade the meaning for "different".
        for (const token of ['--omega-accent', '--omega-ok', '--omega-warn', '--omega-danger']) {
          ctx.expect(source.includes(`'var(${token})'`), `the plan doughnut keeps its ${token} slice`).toBeTruthy();
        }
        ctx.expect(!/colors\.palette/.test(source), 'nothing reaches for the categorical ramp').toBeTruthy();
      },
    },

    {
      name: '#74: the admin chart hosts sit in height-bearing boxes (the helper is told the height)',
      run: (ctx) => {
        const layout = fs.readFileSync(path.join(PKG, 'core', '_layouts', 'blueprint', 'admin', 'dashboard', 'index.html'), 'utf8');
        const css = sass.compile(path.join(PKG, 'core', 'css', 'pages', 'admin', 'index.scss'), {
          logger: { warn: () => {}, debug: () => {} },
        }).css;

        for (const id of ['chart-signups', 'chart-plans']) {
          ctx.expect(layout, `${id} is a host div filling the sized box`).toMatch(new RegExp(`admin-chart-box[^>]*>\\s*<div id="${id}" class="h-100"`));
        }
        ctx.expect(css, 'the box is the host\' positioning parent').toMatch(/\.admin-chart-box\s*\{[^}]*position: relative/s);
        ctx.expect(css, 'the box carries the height the helper measures off it').toMatch(/\.admin-chart-box\s*\{[^}]*height: \d+px/s);
      },
    },

    {
      name: 'the real bundler splits the library into its own chunk — the page entry stays free of it',
      run: async (ctx) => {
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
        // Only the bundles: a chunk's source map sits beside it and quotes the source
        const files = fs.readdirSync(path.join(outDir, 'assets', 'js', 'chunks'))
          .filter((name) => name.endsWith('.js'))
          .map((name) => path.join(outDir, 'assets', 'js', 'chunks', name));
        // A manifest key holds EVERY layer's bundle for that page (#624), and each
        // one is an entry the browser loads — so the claim is about all of them.
        const entries = manifest.js.pages.index.map((url) => path.join(outDir, url.slice(1)));
        const carriers = [...files, ...entries].filter((file) => fs.readFileSync(file, 'utf8').includes(MARKER));

        ctx.expect(entries.length >= 1, 'the charting page bundled').toBeTruthy();
        ctx.expect(carriers.length, `the library lands in exactly one file (found ${carriers.length})`).toBe(1);
        ctx.expect(carriers[0].includes(`${path.sep}chunks${path.sep}`), 'and that file is a chunk, fetched only when a page asks').toBeTruthy();
        for (const entry of entries) {
          ctx.expect(!fs.readFileSync(entry, 'utf8').includes(MARKER), `no page entry carries the library (${path.basename(entry)})`).toBeTruthy();
        }
      },
    },

    // ─── The org-chart component ─────────────────────────────────────────────────

    {
      name: 'data/org-chart: both demo variants render through the real engine',
      run: async (ctx) => {
        const pages = await buildWith(miniData);

        ctx.expect(pages.get('/test/components/data/org-chart'), 'the entry joins the library with zero authoring (spec §9)').toBeTruthy();

        // Each variant owns its own embedded-frame page now (#463).
        const four = pages.get('/test/components/data/org-chart/frames/root-over-four-nodes');
        const alone = pages.get('/test/components/data/org-chart/frames/root-alone');
        ctx.expect(four && alone, 'both demo variants render live, one frame each').toBeTruthy();

        const page = four + alone;
        ctx.expect((page.match(/class="omega-org-chart"/g) || []).length, 'the component renders in both').toBe(2);
        ctx.expect((page.match(/omega-org-chart__node/g) || []).length, 'one node per entry').toBe(4);
        ctx.expect((page.match(/omega-org-chart__children/g) || []).length, 'the root-alone variant draws no bus — no children, no trunk').toBe(1);
        ctx.expect(four.includes('omega-badge-tone omega-tone-2'), 'a node chip rides the shared categorical ramp').toBeTruthy();
      },
    },

    {
      name: 'data/org-chart: connectors are animated GRADIENTS, tilt narrow, and stop for reduced motion',
      run: (ctx) => {
        const warnings = [];
        const result = sass.compile(path.join(ORG_CHART, 'component.scss'), {
          logger: { warn: (message) => warnings.push(message), debug: () => {} },
        });

        ctx.expect(warnings, 'new css never warns — the #16 bar').toEqual([]);

        // Borders cannot animate a dash — every line is a repeating gradient.
        ctx.expect(result.css, 'the trunk/stub run down').toMatch(/repeating-linear-gradient\(180deg/);
        ctx.expect(result.css, 'the bus runs across').toMatch(/repeating-linear-gradient\(90deg/);
        ctx.expect(!/border-style:\s*dashed/.test(result.css), 'no dashed borders — they cannot move').toBeTruthy();
        ctx.expect(result.css).toMatch(/@keyframes omega-org-flow-down/);
        ctx.expect(result.css).toMatch(/@keyframes omega-org-flow-right/);
        ctx.expect(result.css, 'the line color comes from the token sheet').toMatch(/var\(--omega-line\)/);

        // The narrow tilt: the same tree on its side, spine down the left.
        ctx.expect(result.css, 'the tilt rides bootstrap\'s md cutover').toMatch(/max-width: 767\.98px/);

        // The carve-out names the trimmed first/last segments too — a media query
        // lends no specificity of its own.
        const reduced = result.css.slice(result.css.indexOf('prefers-reduced-motion'));
        ctx.expect(reduced).toMatch(/prefers-reduced-motion: reduce/);
        ctx.expect(reduced, 'the trimmed segments are named or they keep animating').toMatch(/:first-child::after/);
        ctx.expect(reduced).toMatch(/:last-child::after/);
      },
    },

    // ─── Tone tokens + the interactive card affordance ───────────────────────────

    {
      name: 'tone sheet: six categorical slots, each pointing at its chart token',
      run: (ctx) => {
        const warnings = [];
        const result = sass.compile(path.join(PKG, 'core', 'css', 'core', '_tones.scss'), {
          logger: { warn: (message) => warnings.push(message), debug: () => {} },
        });

        ctx.expect(warnings, 'new core css never warns — the #16 bar').toEqual([]);

        for (const slot of [1, 2, 3, 4, 5, 6]) {
          ctx.expect(result.css, `slot ${slot} rides its chart token`).toMatch(new RegExp(`\\.omega-tone-${slot}\\s*\\{\\s*--omega-tone: var\\(--omega-chart-${slot}\\)`));
        }
        ctx.expect(!/\.omega-tone-7/.test(result.css), 'six slots, not a ramp that wraps silently').toBeTruthy();
        ctx.expect(result.css, 'the chip tints its own tone').toMatch(/\.omega-badge-tone\s*\{[^}]*color-mix\(in srgb, var\(--omega-tone/s);
        ctx.expect(result.css, 'a tone label is an identifier, never a word').toMatch(/text-transform: none/);
      },
    },

    {
      name: 'main.scss loads the tones AFTER the theme so they outrank theme chip rules',
      run: (ctx) => {
        const main = fs.readFileSync(path.join(PKG, 'core', 'css', 'main.scss'), 'utf8');

        ctx.expect(main.includes("@use 'core/_tones'"), 'the tone sheet is wired').toBeTruthy();
        ctx.expect(main.indexOf("@use 'omega:theme'") < main.indexOf("@use 'core/_tones'"), 'core utilities land after the theme').toBeTruthy();
      },
    },

    {
      name: '.omega-interactive: warm + lift + ring + press, all from tokens, off for reduced motion',
      run: (ctx) => {
        const result = sass.compile(path.join(PKG, 'core', 'css', 'motion', '_index.scss'), {
          logger: { warn: () => {}, debug: () => {} },
        });

        ctx.expect(result.css).toMatch(/\.omega-interactive\s*\{[^}]*cursor: pointer/s);
        ctx.expect(result.css, 'the surface warms under the pointer').toMatch(/\.omega-interactive:hover[^{]*\{[^}]*var\(--omega-surface-2\)/s);
        ctx.expect(result.css, 'the keyboard gets the same affordance').toMatch(/\.omega-interactive:focus-visible\s*\{[^}]*outline: 2px solid var\(--omega-accent-ring\)/s);
        ctx.expect(result.css, 'pressing has somewhere to land').toMatch(/\.omega-interactive:active\s*\{[^}]*var\(--omega-accent-subtle\)/s);
        ctx.expect(result.css, 'a card lifts; a row (no modifier) only warms').toMatch(/\.omega-interactive--lift:hover[^{]*\{[^}]*translateY\(-2px\)/s);

        const reduced = result.css.slice(result.css.indexOf('prefers-reduced-motion: reduce'));
        ctx.expect(reduced, 'the transition is dropped for reduced motion').toMatch(/\.omega-interactive/);
      },
    },
  ],
});
