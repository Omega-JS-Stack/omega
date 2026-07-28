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

// The entry bundle plus every chunk it transitively imports.
function readGraph(outDir, manifestUrl) {
  const seen = new Map();
  const visit = (file) => {
    if (seen.has(file)) return;
    const content = fs.readFileSync(file, 'utf8');
    seen.set(file, content);
    for (const m of content.matchAll(/["']([^"']*chunks\/[\w.-]+-[A-Z0-9]+\.js)["']/g)) {
      visit(path.resolve(path.dirname(file), m[1]));
    }
  };
  visit(path.join(outDir, manifestUrl.slice(1)));
  return [...seen.values()].join('\n');
}

const CHART_PAGE = `
import { Chart, DoughnutController, ArcElement } from 'chart.js';
export default function () {
  Chart.register(DoughnutController, ArcElement);
  return 'consumer chart page';
}
`;

test('a consumer page imports a framework dependency bare, and SHARES its chunk with core', async () => {
  const { build, outDir, cleanup } = await buildConsumer({ 'js/pages/charts/index.js': CHART_PAGE });
  try {
    const manifest = await build;
    assert.ok(manifest.js.pages['charts/index'], 'the consumer page bundled');

    // chart.js exists in exactly ONE output file — the shared chunk — and both
    // the consumer page and core's admin page reach it.
    const files = walkJs(path.join(outDir, 'assets', 'js'));
    const withChart = files.filter((f) => fs.readFileSync(f, 'utf8').includes('Chart.js v'));
    assert.strictEqual(withChart.length, 1, `chart.js in exactly one file (found ${withChart.length})`);
    assert.ok(withChart[0].includes(`${path.sep}chunks${path.sep}`), 'chart.js lives in a shared chunk');

    assert.ok(readGraph(outDir, manifest.js.pages['charts/index']).includes('Chart.js v'), 'consumer page graph reaches chart.js');
    assert.ok(readGraph(outDir, manifest.js.pages['admin/index']).includes('Chart.js v'), 'core admin page graph reaches the SAME chart.js');
  } finally {
    cleanup();
  }
});

test("the framework's copy wins over a consumer-declared duplicate", async () => {
  const { build, outDir, cleanup } = await buildConsumer({
    'js/pages/charts/index.js': CHART_PAGE,
    'node_modules/chart.js/package.json': JSON.stringify({ name: 'chart.js', version: '0.0.0', main: 'index.js' }),
    'node_modules/chart.js/index.js': 'export const Chart = { register() {} }; export const DoughnutController = 1; export const ArcElement = 2; export const CONSUMER_COPY = true;',
  });
  try {
    const manifest = await build;
    const graph = readGraph(outDir, manifest.js.pages['charts/index']);
    assert.ok(graph.includes('Chart.js v'), "the framework's chart.js bundled");
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
