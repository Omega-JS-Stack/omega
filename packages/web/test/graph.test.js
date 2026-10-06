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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildAssets } = require('../src/assets.js');
const { PKG } = require('./lib/build.js');

const graph = require('../core/js/libs/graph.js');

/** Install a token sheet as the document's computed :root styles. */
function stubTokens(tokens) {
  global.document = { documentElement: {} };
  global.getComputedStyle = () => ({ getPropertyValue: (name) => tokens[name] || '' });
}

module.exports = defineCases({
  type: 'group',
  description: 'graph',
  tests: [
    // ─── The graph helper ────────────────────────────────────────────────────────

    {
      name: 'graphSlot: no library yet → the unavailable line, never a hole',
      run: (ctx) => {
        ctx.expect(graph.graphReady(), 'nothing is loaded until a page asks').toBe(false);
        ctx.expect(graph.graphSlot('graph-flow')).toMatch(/graph library unavailable/);
      },
    },

    {
      name: 'graphSlot: an unusable id is a programmer error and crashes',
      run: (ctx) => {
        ctx.expect(() => graph.graphSlot('graph"><img src=x>')).toThrow(/not a usable element id/);
        ctx.expect(() => graph.graphSlot('')).toThrow(/not a usable element id/);
      },
    },

    {
      name: 'loadGraph: pulls the real mermaid on demand, once',
      run: async (ctx) => {
        ctx.expect(await graph.loadGraph()).toBe(true);
        ctx.expect(graph.graphReady(), 'the sync gate render paths read flips').toBe(true);
        ctx.expect(await graph.loadGraph(), 'idempotent — safe on every poll').toBe(true);
      },
    },

    {
      name: 'graphSlot: the box carries the height AND stamps its definition for write-on-change',
      run: (ctx) => {
        const markup = graph.graphSlot('graph-flow', 260, 'graph TD\n  a["A"] --> b');

        ctx.expect(markup, 'the host the render injects into carries the id').toMatch(/<div id="graph-flow"/);
        ctx.expect(markup, 'the box reserves the space so the page does not jump').toMatch(/min-height: 260px/);
        ctx.expect(markup.includes('data-series="graph TD\n  a[&quot;A&quot;] --&gt; b"'), 'definition-only changes reach swap() through the stamp, escaped for the attribute').toBeTruthy();
        ctx.expect(graph.graphSlot('graph-flow'), 'no definition → an empty stamp, not "undefined"').toMatch(/data-series=""/);
      },
    },

    {
      name: 'graphTheme: the diagram is drawn off the live sheet — ink, surfaces, line, accent',
      run: (ctx) => {
        stubTokens({
          '--omega-ink': '#1a1a19',
          '--omega-surface': '#ffffff',
          '--omega-surface-2': '#ececeb',
          '--omega-line': '#e8e8e6',
          '--omega-accent': '#3b5bdb',
          '--omega-font-ui': 'Inter, sans-serif',
        });

        const theme = graph.graphTheme();

        ctx.expect(theme.background, 'the diagram sits on the page surface').toBe('#ffffff');
        ctx.expect(theme.mainBkg, 'a node is the recessed well, never a second white').toBe('#ececeb');
        ctx.expect(theme.textColor).toBe('#1a1a19');
        ctx.expect(theme.lineColor, 'edges are hairlines, like every other divider').toBe('#e8e8e6');
        ctx.expect(theme.primaryBorderColor, 'the accent is what makes it the brand’s diagram').toBe('#3b5bdb');
        ctx.expect(theme.fontFamily, 'and it speaks in the UI voice, not trebuchet').toBe('Inter, sans-serif');
      },
    },

    {
      name: 'graphTheme: the categorical slots ARE the chart ramp — same color, same thing',
      run: (ctx) => {
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
        ctx.expect([0, 1, 2, 3, 4, 5].map((i) => theme[`cScale${i}`])).toEqual(ramp);
        ctx.expect([1, 2, 3, 4, 5, 6].map((i) => theme[`pie${i}`])).toEqual(ramp);
        ctx.expect(theme.cScale6, 'six slots, not a ramp that wraps silently').toBe(undefined);
      },
    },

    {
      name: 'graphTheme: a sheet-less page still draws — bootstrap/hardcoded fallbacks',
      run: (ctx) => {
        stubTokens({ '--bs-body-color': '#212529', '--bs-border-color': '#dee2e6' });

        const theme = graph.graphTheme();

        ctx.expect(theme.textColor, 'bootstrap variable is the first fallback').toBe('#212529');
        ctx.expect(theme.lineColor).toBe('#dee2e6');
        ctx.expect(theme.primaryBorderColor, 'the token sheet placeholder is the last').toBe('#2563eb');
        ctx.expect(theme.background).toBe('#ffffff');
      },
    },

    {
      name: 'graph.js names mermaid ONLY in the lazy import — a graphless page pays nothing',
      run: (ctx) => {
        const source = fs.readFileSync(path.join(PKG, 'core', 'js', 'libs', 'graph.js'), 'utf8');

        ctx.expect(!/^import .*mermaid/m.test(source), 'no static import — esbuild would fold it into the entry').toBeTruthy();
        ctx.expect(source, 'the split chunk is fetched when a page asks').toMatch(/await import\('mermaid'\)/);
        ctx.expect(source, 'the loaded instance short-circuits — one import per page life').toMatch(/if \(mermaid\)/);
        ctx.expect(source, 'concurrent callers share the one in-flight import').toMatch(/if \(!pending\)/);
      },
    },

    {
      name: 'drawGraph initializes mermaid strict, base, and never auto-running',
      run: (ctx) => {
        // Diagram labels are content; `strict` is what keeps them text instead of
        // HTML. Source-pinned because render itself needs a DOM node has none of.
        const source = fs.readFileSync(path.join(PKG, 'core', 'js', 'libs', 'graph.js'), 'utf8');

        ctx.expect(source, 'labels render as text, never HTML').toMatch(/securityLevel: 'strict'/);
        ctx.expect(source, 'base is the one theme themeVariables fully drive').toMatch(/theme: 'base'/);
        ctx.expect(source, 'the page draws when asked, never on load').toMatch(/startOnLoad: false/);
        ctx.expect(source, 'a bad definition throws without leaving an error box on document.body').toMatch(/suppressErrorRendering: true/);
      },
    },

    {
      name: 'the real bundler splits mermaid into its own chunk — the page entry stays free of it',
      run: async (ctx) => {
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
        // Only the bundles: a chunk's source map sits beside it and quotes the source
        const files = fs.readdirSync(path.join(outDir, 'assets', 'js', 'chunks'))
          .filter((name) => name.endsWith('.js'))
          .map((name) => path.join(outDir, 'assets', 'js', 'chunks', name));
        const entry = path.join(outDir, manifest.js.pages.index[0].slice(1));
        const carriers = [...files, entry].filter((file) => fs.readFileSync(file, 'utf8').includes(MARKER));

        ctx.expect(carriers.length, `mermaid lands in exactly one file (found ${carriers.length})`).toBe(1);
        ctx.expect(carriers[0].includes(`${path.sep}chunks${path.sep}`), 'and that file is a chunk, fetched only when a page asks').toBeTruthy();
        ctx.expect(!fs.readFileSync(entry, 'utf8').includes(MARKER), 'the page entry never carries the library').toBeTruthy();
      },
    },
  ],
});
