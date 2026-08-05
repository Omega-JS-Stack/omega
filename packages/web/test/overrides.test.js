/**
 * The layered override map (#94) — `omega customize --list` and the
 * single-file `omega customize <path>`.
 *
 * The map is the build's own resolution read back out (src/overrides.js runs
 * the SAME resolveThemeLayers chains the engine and the asset pipeline do), so
 * these tests assert against the REAL packaged theme/core content rather than a
 * fixture layer stack — a map that disagreed with the shipped layers would be
 * the bug. The consumer side is a temp tree (the commands-clean pattern): the
 * verbs read process.cwd() through consumerPaths.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const customize = require('../src/commands/customize.js');
const { buildAssets } = require('../src/assets.js');
const { buildOverrideMap, materializeOverride } = require('../src/overrides.js');

const BASE_FOOTER = '_includes/frontend/sections/footer.html';
const PKG = path.resolve(__dirname, '..');
const REPO = path.resolve(PKG, '..', '..');

/** A consumer tree with a valid config; `extra` seeds files under the root. */
function consumer(t, { theme = 'classy', extra = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-overrides-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const files = {
    'config/omega.json5': JSON.stringify({
      brand: { id: 'fixture', name: 'Fixture' },
      url: 'https://fixture.example.com',
      theme: { id: theme },
      targets: { web: {} },
    }),
    'package.json': '{}',
    'src/pages/.keep': '',
    ...extra,
  };
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

/** The map for a consumer tree. */
function mapFor(root, theme = 'classy') {
  return buildOverrideMap({ consumerDir: path.join(root, 'src'), siteData: { theme: { id: theme } } });
}

/** Run the real command with cwd on the consumer, capturing its lines. */
async function runIn(t, root, options = {}) {
  const previous = process.cwd();
  const lines = [];
  const written = process.stdout.write.bind(process.stdout);
  process.chdir(root);
  process.stdout.write = (chunk, ...rest) => { lines.push(String(chunk)); return written(chunk, ...rest); };
  t.after(() => { process.chdir(previous); process.stdout.write = written; });

  try {
    await customize({ _: ['customize'], ...options });
  } finally {
    process.stdout.write = written;
    process.chdir(previous);
  }
  return lines.join('');
}

// ─── The map builder ─────────────────────────────────────────────────────────

/**
 * Compile a consumer's css the way the build does (assets.js layer roots),
 * returning every emitted stylesheet's text. `only: 'css'` skips esbuild.
 */
async function compileCss(t, root) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-overrides-css-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));

  const classy = path.join(PKG, 'themes', 'classy');
  const base = path.join(PKG, 'themes', 'base');
  await buildAssets({
    layers: [path.join(root, 'src', 'assets'), classy, base, path.join(PKG, 'core')],
    themeRoots: [classy, base],
    sectionRoots: [path.join(root, 'src'), classy, base],
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    outDir: out,
    clientEntry: path.join(REPO, 'packages', 'client', 'src', 'index.js'),
    only: 'css',
  });

  const cssDir = path.join(out, 'assets', 'css');
  return fs.readdirSync(cssDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8'))
    .join('\n');
}

test('the map covers every shadowable lane — sections, includes, css, pages', (t) => {
  const entries = mapFor(consumer(t));
  const kinds = new Set(entries.map((entry) => entry.kind));

  assert.deepEqual([...kinds].sort(), ['css', 'include', 'page', 'section'], 'all four lanes are listed');
  assert.ok(entries.some((entry) => entry.path === BASE_FOOTER), 'the theme footer include is shadowable');
  assert.ok(entries.some((entry) => entry.kind === 'section' && /^_sections\/.*\/section\.html$/.test(entry.path)), 'section markup is listed by its entry path');
  assert.ok(entries.every((entry) => entry.kind !== 'css' || entry.path.startsWith('assets/css/')), 'css paths carry the consumer asset-layer prefix');
});

test('every non-page path is the path that shadows it — relative to the consumer src', (t) => {
  const root = consumer(t);
  const entries = mapFor(root).filter((entry) => entry.kind !== 'page');

  for (const entry of entries) {
    assert.equal(entry.target, path.join(root, 'src', entry.path), `${entry.path} lands where the map says`);
    assert.ok(fs.existsSync(entry.source), `${entry.path} names a real source file`);
  }
});

test('owning layers are the build\'s own chain: framework core, theme layers, consumer', (t) => {
  const entries = mapFor(consumer(t));
  const footer = entries.find((entry) => entry.path === BASE_FOOTER);
  const layers = new Set(entries.map((entry) => entry.layer));

  assert.equal(footer.layer, 'theme:base', 'the footer comes from the base layer');
  assert.equal(footer.shadowed, false, 'a bare consumer shadows nothing');
  assert.ok(layers.has('framework'), 'the core layer owns files too');
  assert.ok([...layers].every((layer) => layer === 'framework' || layer === 'consumer' || layer.startsWith('theme:')), 'no other layer label exists');
});

test('the active theme decides the winner — newsflash beats classy where it owns the file', (t) => {
  const root = consumer(t, { theme: 'newsflash' });
  const entries = mapFor(root, 'newsflash');
  const winners = new Map(entries.map((entry) => [entry.path, entry]));

  const themed = entries.filter((entry) => entry.layer === 'theme:newsflash');
  assert.ok(themed.length, 'the active theme owns files in the map');
  for (const entry of themed) {
    assert.ok(entry.source.includes(path.join('themes', 'newsflash')), `${entry.path} resolves to the active theme's copy`);
  }
  assert.equal(winners.get(BASE_FOOTER).layer, 'theme:base', 'what newsflash does not own still flows from the base layer');
});

test('a consumer file shadows its layer — the map says so and points at the file it hides', (t) => {
  const root = consumer(t, { extra: { [`src/${BASE_FOOTER}`]: '<footer>mine</footer>' } });
  const footer = mapFor(root).find((entry) => entry.path === BASE_FOOTER);

  assert.equal(footer.layer, 'consumer', 'the consumer copy wins');
  assert.equal(footer.shadowed, true, 'and is reported as a shadow');
  assert.deepEqual(footer.shadows, ['theme:base'], 'naming the layer underneath it');
  assert.ok(footer.source.includes(path.join('themes', 'base')), 'source stays the framework file — what a materialize would copy');
});

// ─── omega customize --list ──────────────────────────────────────────────────

test('--list prints every lane with its owning layer and the consumer\'s shadows', async (t) => {
  const root = consumer(t, { extra: { [`src/${BASE_FOOTER}`]: '<footer>mine</footer>' } });

  const output = await runIn(t, root, { list: true });

  assert.match(output, /Sections & components/, 'the section lane is printed');
  assert.match(output, /Includes/, 'the include lane is printed');
  assert.match(output, /Stylesheets/, 'the css lane is printed');
  assert.match(output, /Pages \(omega customize <url>\)/, 'the page lane is printed');
  assert.match(output, new RegExp(`${BASE_FOOTER}\\s+shadowed by you`), 'an owned path reads as shadowed, with its file');
  assert.match(output, /assets\/css\/main\.scss\s+from (framework|theme:classy)/, 'an un-owned path names the layer it comes from');
});

// ─── omega customize <path> ──────────────────────────────────────────────────

test('a single include materializes at its shadow path, with a provenance header', async (t) => {
  const root = consumer(t);

  const output = await runIn(t, root, { _: ['customize', BASE_FOOTER] });
  const written = fs.readFileSync(path.join(root, 'src', BASE_FOOTER), 'utf8');
  const source = fs.readFileSync(mapFor(root).find((entry) => entry.path === BASE_FOOTER).source, 'utf8');

  assert.match(output, /Materialized src\/_includes\/frontend\/sections\/footer\.html — a copy of the theme:base layer's file/);
  assert.match(written, /^\{% comment %\}\n {2}Materialized by `omega customize _includes\/frontend\/sections\/footer\.html` — a copy of the theme:base layer's file\./, 'the header names the source layer in Liquid comment form (never rendered)');
  assert.ok(written.endsWith(source), 'the file itself is a verbatim copy');
});

test('a stylesheet materializes into the consumer asset layer with a scss comment header', async (t) => {
  const root = consumer(t);
  const entry = mapFor(root).find((e) => e.kind === 'css' && e.path === 'assets/css/main.scss');

  await runIn(t, root, { _: ['customize', entry.path] });
  const written = fs.readFileSync(path.join(root, 'src', 'assets', 'css', 'main.scss'), 'utf8');

  assert.match(written, /^\/\/ Materialized by `omega customize assets\/css\/main\.scss`/, 'scss carries // comments, not liquid');
  assert.ok(written.endsWith(fs.readFileSync(entry.source, 'utf8')), 'verbatim below the header');
});

// ─── The css contract: a listed sheet is one the compile chain HONORS ────────

test('every css entry the map offers actually wins when materialized — proved by a real compile', async (t) => {
  const root = consumer(t);
  const entries = mapFor(root).filter((entry) => entry.kind === 'css');
  const page = entries.find((entry) => entry.path.startsWith('assets/css/pages/'));

  assert.ok(entries.length, 'the lane is not empty');
  assert.ok(page, 'page sheets are offered');

  for (const entry of [entries.find((e) => e.path === 'assets/css/main.scss'), page]) {
    await runIn(t, root, { _: ['customize', entry.path] });
    fs.appendFileSync(path.join(root, 'src', entry.path), `\n.shadow-proof-${entry.path.replace(/\W/g, '-')} { color: red; }\n`);
  }

  const css = await compileCss(t, root);
  for (const entry of [entries.find((e) => e.path === 'assets/css/main.scss'), page]) {
    assert.ok(css.includes(`.shadow-proof-${entry.path.replace(/\W/g, '-')}`), `${entry.path}: the consumer's copy reached the compiled output`);
  }
});

test('unreachable partials are NOT listed — a consumer copy of one never loads', async (t) => {
  const root = consumer(t);
  const entries = mapFor(root).filter((entry) => entry.kind === 'css');

  // The reason the lane is narrow: bare relative @use/@import inside a theme
  // sheet resolves against the IMPORTING file before any loadPath, so a
  // consumer copy of a partial is dead weight. Offering it would be a lie.
  assert.ok(entries.every((entry) => !entry.path.split('/').some((segment) => segment.startsWith('_'))), 'no partials in the map');
  assert.ok(entries.every((entry) => entry.path === 'assets/css/main.scss' || entry.path.startsWith('assets/css/pages/')), 'only the two lanes sass layers by');
  assert.equal(materializeOverride({ path: 'assets/css/base/_utilities.scss', consumerDir: path.join(root, 'src') }).status, 'unknown', 'and the verb refuses to write one');

  const utilities = path.join(root, 'src', 'assets', 'css', 'base', '_utilities.scss');
  fs.mkdirSync(path.dirname(utilities), { recursive: true });
  fs.writeFileSync(utilities, '.hand-rolled-partial-shadow { color: red; }\n');

  assert.ok(!(await compileCss(t, root)).includes('.hand-rolled-partial-shadow'), 'a hand-placed partial shadow is dead — exactly what the map refuses to promise');
});

test('a section asset file says what section resolution actually does', async (t) => {
  const root = consumer(t);
  const scss = mapFor(root).find((entry) => entry.kind === 'section' && entry.path.endsWith('section.scss'));

  const output = await runIn(t, root, { _: ['customize', scss.path] });
  const written = fs.readFileSync(path.join(root, 'src', scss.path), 'utf8');

  assert.match(written, /Sections resolve per ENTRY/, 'the header warns that markup and assets travel together');
  assert.match(output, /shadow the entry's section\.html too, or declare `inherit`/i, 'and so does the command');
});

test('materializing twice never overwrites — the second run says it exists and stops', async (t) => {
  const root = consumer(t);
  const target = path.join(root, 'src', BASE_FOOTER);

  await runIn(t, root, { _: ['customize', BASE_FOOTER] });
  fs.writeFileSync(target, '<footer>my edits</footer>');
  const output = await runIn(t, root, { _: ['customize', BASE_FOOTER] });

  assert.equal(fs.readFileSync(target, 'utf8'), '<footer>my edits</footer>', 'the consumer\'s work survives');
  assert.match(output, /Nothing to do — you already shadow _includes\/frontend\/sections\/footer\.html/);
});

test('materializeOverride reports an unknown path instead of writing one', (t) => {
  const root = consumer(t);
  const result = materializeOverride({ path: '_includes/nope/not-a-file.html', consumerDir: path.join(root, 'src') });

  assert.equal(result.status, 'unknown');
  assert.equal(fs.existsSync(path.join(root, 'src', '_includes', 'nope')), false, 'nothing is created for a miss');
});

test('a page URL still routes to the page lane — the file lane never swallows it', async (t) => {
  const root = consumer(t);

  const output = await runIn(t, root, { _: ['customize', '/pricing'] });

  assert.match(output, /(Materialized|Copied) src\/pages\//, 'the URL materialized a page, not a shadow file');
});
