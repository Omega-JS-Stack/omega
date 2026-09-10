/**
 * Framework-provided dependencies (#2): a CONSUMER page module imports any
 * library `@omega.js/web` declares by BARE specifier and it resolves from the
 * framework's own installation — one copy, shared with the core bundles that
 * use it. The consumer layer lives in a temp dir OUTSIDE this monorepo, so
 * plain node resolution from the importing file finds nothing: only the resolve
 * hook can satisfy the import, which is exactly a real consumer's situation.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { buildAssets } = require('../src/assets.js');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');

/**
 * Write a consumer site layer in a temp dir and build it over the real
 * theme + core layers.
 * @param {Record<string, string>} files - path (relative to the layer root) → contents
 * @returns {Promise<{ manifest: object, outDir: string, cleanup: function }>}
 */
async function buildConsumer(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-consumer-'));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  const themeRoots = [path.join(PKG, 'themes', 'classy')];
  const outDir = path.join(dir, '_site');
  const build = buildAssets({
    layers: [dir, ...themeRoots, path.join(PKG, 'core')],
    themeRoots,
    sectionRoots: themeRoots,
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    outDir,
    clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
    only: 'js',
  });
  return { build, outDir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function walkJs(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => path.join(e.parentPath, e.name));
}

// The entry bundle plus every chunk it transitively imports — static AND
// dynamic. Chunk-to-chunk hops are same-directory (`./chunk-X.js`), so the
// walk cannot key on the `chunks/` segment an entry's references carry.
function readGraph(outDir, manifestUrls) {
  const seen = new Map();
  const visit = (file) => {
    if (seen.has(file)) return;
    const content = fs.readFileSync(file, 'utf8');
    seen.set(file, content);
    for (const m of content.matchAll(/["']([^"']*[\w.-]+-[A-Z0-9]{8}\.js)["']/g)) {
      const next = path.resolve(path.dirname(file), m[1]);
      if (fs.existsSync(next)) visit(next);
    }
  };
  // A manifest key holds every layer's bundle for that page (#624) — the graph
  // is the union of theirs.
  for (const url of manifestUrls) visit(path.join(outDir, url.slice(1)));
  return [...seen.values()].join('\n');
}

const CHART_PAGE = `
import { defineChart, barY } from '@tanstack/charts';
export default function () {
  return defineChart({ marks: [barY([], { x: 'label', y: 'value' })] });
}
`;

// The library's own default palette — present in its bundle, nowhere else.
const CHART_MARKER = 'var(--ts-chart-1, #2563eb)';

test('a consumer page imports a framework dependency bare, and SHARES its chunk with core', async () => {
  const { build, outDir, cleanup } = await buildConsumer({ 'js/pages/charts/index.js': CHART_PAGE });
  try {
    const manifest = await build;
    assert.ok(manifest.js.pages['charts/index'], 'the consumer page bundled');

    // @tanstack/charts exists in exactly ONE output file — the shared chunk —
    // and both the consumer page and core's admin page reach it.
    const files = walkJs(path.join(outDir, 'assets', 'js'));
    const withChart = files.filter((f) => fs.readFileSync(f, 'utf8').includes(CHART_MARKER));
    assert.strictEqual(withChart.length, 1, `@tanstack/charts in exactly one file (found ${withChart.length})`);
    assert.ok(withChart[0].includes(`${path.sep}chunks${path.sep}`), '@tanstack/charts lives in a shared chunk');

    assert.ok(readGraph(outDir, manifest.js.pages['charts/index']).includes(CHART_MARKER), 'consumer page graph reaches @tanstack/charts');
    assert.ok(readGraph(outDir, manifest.js.pages['admin/index']).includes(CHART_MARKER), 'core admin page graph reaches the SAME @tanstack/charts');
  } finally {
    cleanup();
  }
});

test("the framework's copy wins over a consumer-declared duplicate", async () => {
  const { build, outDir, cleanup } = await buildConsumer({
    'js/pages/charts/index.js': CHART_PAGE,
    'node_modules/@tanstack/charts/package.json': JSON.stringify({ name: '@tanstack/charts', version: '0.0.0', type: 'module', main: 'index.js' }),
    'node_modules/@tanstack/charts/index.js': 'export const defineChart = (d) => d; export const barY = () => 1; export const CONSUMER_COPY = true;',
  });
  try {
    const manifest = await build;
    const graph = readGraph(outDir, manifest.js.pages['charts/index']);
    assert.ok(graph.includes(CHART_MARKER), "the framework's @tanstack/charts bundled");
    assert.ok(!graph.includes('CONSUMER_COPY'), "the consumer's own copy was NOT used");
  } finally {
    cleanup();
  }
});

test('a name the framework does not declare still fails with the normal resolution error', async () => {
  const { build, cleanup } = await buildConsumer({
    'js/pages/nope/index.js': "import 'totally-not-a-framework-dep';\nexport default function () {}\n",
  });
  try {
    await assert.rejects(build, /Could not resolve "totally-not-a-framework-dep"/);
  } finally {
    cleanup();
  }
});
