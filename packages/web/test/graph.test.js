/**
 * The graph helper ([#169](https://github.com/Omega-JS-Stack/omega/issues/169)):
 * `core/js/libs/graph.js` — lazy mermaid, token themeVariables, the graph slot.
 *
 * `drawGraph` itself is not pinned here — mermaid renders against a real DOM,
 * which node has none of, exactly like the four chart builders
 * (`test/dataviz.test.js`). What is pinned is everything around it: the load
 * lane, the token reads, and the slot markup that write-on-change rendering
 * depends on.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { buildAssets } = require('../src/assets.js');
const { PKG } = require('./lib/build.js');

const graph = require('../core/js/libs/graph.js');

/** Install a token sheet as the document's computed :root styles. */
function stubTokens(tokens) {
  global.document = { documentElement: {} };
  global.getComputedStyle = () => ({ getPropertyValue: (name) => tokens[name] || '' });
}

// ─── The graph helper ────────────────────────────────────────────────────────

test('graphSlot: no library yet → the unavailable line, never a hole', () => {
  assert.equal(graph.graphReady(), false, 'nothing is loaded until a page asks');
  assert.match(graph.graphSlot('graph-flow'), /graph library unavailable/);
});

test('graphSlot: an unusable id is a programmer error and crashes', () => {
  assert.throws(() => graph.graphSlot('graph"><img src=x>'), /not a usable element id/);
  assert.throws(() => graph.graphSlot(''), /not a usable element id/);
});

test('loadGraph: pulls the real mermaid on demand, once', async () => {
  assert.equal(await graph.loadGraph(), true);
  assert.equal(graph.graphReady(), true, 'the sync gate render paths read flips');
  assert.equal(await graph.loadGraph(), true, 'idempotent — safe on every poll');
});

test('graphSlot: the box carries the height AND stamps its definition for write-on-change', () => {
  const markup = graph.graphSlot('graph-flow', 260, 'graph TD\n  a["A"] --> b');

  assert.match(markup, /<div id="graph-flow"/, 'the host the render injects into carries the id');
  assert.match(markup, /min-height: 260px/, 'the box reserves the space so the page does not jump');
  assert.ok(
    markup.includes('data-series="graph TD\n  a[&quot;A&quot;] --&gt; b"'),
    'definition-only changes reach swap() through the stamp, escaped for the attribute',
  );
  assert.match(graph.graphSlot('graph-flow'), /data-series=""/, 'no definition → an empty stamp, not "undefined"');
});

test('graphTheme: the diagram is drawn off the live sheet — ink, surfaces, line, accent', () => {
  stubTokens({
    '--omega-ink': '#1a1a19',
    '--omega-surface': '#ffffff',
    '--omega-surface-2': '#ececeb',
    '--omega-line': '#e8e8e6',
    '--omega-accent': '#3b5bdb',
    '--omega-font-ui': 'Inter, sans-serif',
  });

  const theme = graph.graphTheme();

  assert.equal(theme.background, '#ffffff', 'the diagram sits on the page surface');
  assert.equal(theme.mainBkg, '#ececeb', 'a node is the recessed well, never a second white');
  assert.equal(theme.textColor, '#1a1a19');
  assert.equal(theme.lineColor, '#e8e8e6', 'edges are hairlines, like every other divider');
  assert.equal(theme.primaryBorderColor, '#3b5bdb', 'the accent is what makes it the brand’s diagram');
  assert.equal(theme.fontFamily, 'Inter, sans-serif', 'and it speaks in the UI voice, not trebuchet');
});

test('graphTheme: the categorical slots ARE the chart ramp — same color, same thing', () => {
  stubTokens({
    '--omega-chart-1': '#3b5bdb',
    '--omega-chart-2': '#0f8fa9',
    '--omega-chart-3': '#7a45b5',
    '--omega-chart-4': '#b0416a',
    '--omega-chart-5': '#a06a08',
    '--omega-chart-6': '#6a7f2b',
  });

  const theme = graph.graphTheme();
  const ramp = ['#3b5bdb', '#0f8fa9', '#7a45b5', '#b0416a', '#a06a08', '#6a7f2b'];

  // Two names for one ramp: cScale is the class/state/journey slot, pie the
  // pie slot — mermaid takes per-item colors under both.
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => theme[`cScale${i}`]), ramp);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((i) => theme[`pie${i}`]), ramp);
  assert.equal(theme.cScale6, undefined, 'six slots, not a ramp that wraps silently');
});

test('graphTheme: a sheet-less page still draws — bootstrap/hardcoded fallbacks', () => {
  stubTokens({ '--bs-body-color': '#212529', '--bs-border-color': '#dee2e6' });

  const theme = graph.graphTheme();

  assert.equal(theme.textColor, '#212529', 'bootstrap variable is the first fallback');
  assert.equal(theme.lineColor, '#dee2e6');
  assert.equal(theme.primaryBorderColor, '#2563eb', 'the token sheet placeholder is the last');
  assert.equal(theme.background, '#ffffff');
});

test('graph.js names mermaid ONLY in the lazy import — a graphless page pays nothing', () => {
  const source = fs.readFileSync(path.join(PKG, 'core', 'js', 'libs', 'graph.js'), 'utf8');

  assert.ok(!/^import .*mermaid/m.test(source), 'no static import — esbuild would fold it into the entry');
  assert.match(source, /await import\('mermaid'\)/, 'the split chunk is fetched when a page asks');
  assert.match(source, /if \(mermaid\)/, 'the loaded instance short-circuits — one import per page life');
  assert.match(source, /if \(!pending\)/, 'concurrent callers share the one in-flight import');
});

test('drawGraph initializes mermaid strict, base, and never auto-running', () => {
  // Diagram labels are content; `strict` is what keeps them text instead of
  // HTML. Source-pinned because render itself needs a DOM node has none of.
  const source = fs.readFileSync(path.join(PKG, 'core', 'js', 'libs', 'graph.js'), 'utf8');

  assert.match(source, /securityLevel: 'strict'/, 'labels render as text, never HTML');
  assert.match(source, /theme: 'base'/, 'base is the one theme themeVariables fully drive');
  assert.match(source, /startOnLoad: false/, 'the page draws when asked, never on load');
  assert.match(source, /suppressErrorRendering: true/, 'a bad definition throws without leaving an error box on document.body');
});

test('the real bundler splits mermaid into its own chunk — the page entry stays free of it', async () => {
  // A one-page consumer layer that does what a diagramming page does: import
  // the framework helper, never the library.
  const layer = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-graph-'));
  fs.mkdirSync(path.join(layer, 'js', 'pages'), { recursive: true });
  fs.writeFileSync(
    path.join(layer, 'js', 'pages', 'index.js'),
    "import { loadGraph, drawGraph } from '__main_assets__/js/libs/graph.js';\nexport default async () => { await loadGraph(); await drawGraph('graph-x', 'graph TD\\n a --> b'); };\n",
  );

  const outDir = path.join(PKG, '.omega', 'graph-test-assets');
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

  // Mermaid's own words — present in the library, nowhere else.
  const MARKER = 'Syntax error in text';
  const files = fs.readdirSync(path.join(outDir, 'assets', 'js', 'chunks')).map((name) => path.join(outDir, 'assets', 'js', 'chunks', name));
  const entry = path.join(outDir, manifest.js.pages.index.slice(1));
  const carriers = [...files, entry].filter((file) => fs.readFileSync(file, 'utf8').includes(MARKER));

  assert.equal(carriers.length, 1, `mermaid lands in exactly one file (found ${carriers.length})`);
  assert.ok(carriers[0].includes(`${path.sep}chunks${path.sep}`), 'and that file is a chunk, fetched only when a page asks');
  assert.ok(!fs.readFileSync(entry, 'utf8').includes(MARKER), 'the page entry never carries the library');
});
