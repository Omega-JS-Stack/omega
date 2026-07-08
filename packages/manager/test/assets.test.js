/**
 * Assets service tests — the REAL pipeline (sharp, png2icons, opentype.js)
 * against temp brand roots; nothing is faked because nothing leaves the
 * machine. Proves skip semantics, full generation from a brandmark, the
 * mtime idempotency that replaced omega-manager's --onboarding gate
 * (converged rerun = zero writes), staleness regeneration, the dry-run
 * zero-write guarantee, wordmark/combomark generation from a
 * programmatically-built font (missing-only — never overwritten), the
 * de-ITW'd no-packaged-font behavior, and the svg-to-black conversion.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const opentype = require('opentype.js');

const { SERVICE_ORDER, OPERATIONS, DEFAULTS } = require('../src/config.js');
const { convertSvgToBlack } = require('../src/services/assets/lib/svg-to-black.js');
const service = require('../src/services/assets/index.js');

const BRANDMARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" rx="16" fill="#e63946"/></svg>';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Stage a temp brand root; brandmark included unless disabled. */
function stageBrand({ brandmark = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-assets-test-'));
  fs.mkdirSync(path.join(root, 'assets', 'logo'), { recursive: true });
  if (brandmark) {
    fs.writeFileSync(path.join(root, 'assets', 'logo', 'brandmark.svg'), BRANDMARK_SVG);
  }
  return root;
}

function brandConfig({ assets = {}, font } = {}) {
  return {
    brand: { id: 'fixture-brand', name: 'AB', url: 'https://fixture-brand.test', ...(font ? { font } : {}) },
    assets: assets === false ? false : { ...structuredClone(DEFAULTS.assets), ...assets },
    targets: { web: {} },
  };
}

function runService(root, config, { options = {} } = {}) {
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: root,
    brandConfig: config,
    brand: { id: 'fixture-brand', config, targets: ['web'], apps: [] },
    brandState: {},
    apps: [],
    operations: OPERATIONS.assets,
    options,
    serviceData: {},
  });
}

/** Every file under .omega/assets/, relative, sorted. */
function derivedFiles(root) {
  const base = path.join(root, '.omega', 'assets');
  if (!fs.existsSync(base)) {
    return [];
  }
  const walk = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]);
  return walk(base).sort();
}

function mtimes(root, files) {
  return files.map((file) => fs.statSync(path.join(root, '.omega', 'assets', file)).mtimeMs);
}

/** Build a real minimal font (glyphs for A + B) and stage it in the brand. */
function stageFont(root) {
  const box = (width) => {
    const p = new opentype.Path();
    p.moveTo(0, 0);
    p.lineTo(0, 700);
    p.lineTo(width, 700);
    p.lineTo(width, 0);
    p.close();
    return p;
  };
  const glyphs = [
    new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 650, path: new opentype.Path() }),
    new opentype.Glyph({ name: 'A', unicode: 65, advanceWidth: 550, path: box(500) }),
    new opentype.Glyph({ name: 'B', unicode: 66, advanceWidth: 550, path: box(450) }),
  ];
  const font = new opentype.Font({
    familyName: 'TestFont', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs,
  });
  fs.mkdirSync(path.join(root, 'assets', 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'fonts', 'TestFont-Regular.otf'), Buffer.from(font.toArrayBuffer()));
}

// ─── Registry / defaults pins ────────────────────────────────────────────────

test('assets: registered after server with the five ported operations', () => {
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('server') + 1], 'assets');
  assert.deepEqual(OPERATIONS.assets.map((o) => o.name), ['logo-gen', 'process', 'icons', 'social-icons', 'favicons']);
});

test('assets: defaults are enabled-only', () => {
  assert.deepEqual(DEFAULTS.assets, { enabled: true });
});

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('assets: assets.enabled = false skips the service', async () => {
  const root = stageBrand();
  const result = await runService(root, brandConfig({ assets: { enabled: false } }));
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /assets\.enabled/);
});

test('assets: scalar assets: false skips the service', async () => {
  const root = stageBrand();
  const result = await runService(root, brandConfig({ assets: false }));
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /assets\.enabled/);
});

test('assets: no brandmark.svg skips the service with guidance', async () => {
  const root = stageBrand({ brandmark: false });
  const result = await runService(root, brandConfig());
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /brandmark\.svg/);
  assert.deepEqual(derivedFiles(root), []);
});

// ─── Full real generation ────────────────────────────────────────────────────

test('assets: a brandmark generates the full derived set for real', async () => {
  const root = stageBrand();
  const result = await runService(root, brandConfig());

  assert.equal(result.status, 'success');

  const files = derivedFiles(root);
  // 20 logo files (2 SVGs + 9 color + 9 black PNGs), 2 app icons,
  // 4 social icons, 7 favicon files
  assert.equal(files.length, 33);
  for (const expected of [
    'logo/brandmark/color-x.svg', 'logo/brandmark/black-x.svg',
    'logo/brandmark/color-16.png', 'logo/brandmark/color-2048.png', 'logo/brandmark/black-1024.png',
    'app/macos/icon.icns', 'app/windows/icon.ico',
    'social/brandmark/color-x.svg', 'social/brandmark/color-2048.png',
    'favicon/favicon.ico', 'favicon/apple-touch-icon.png', 'favicon/site.webmanifest',
  ]) {
    assert.ok(files.includes(expected), `missing ${expected}`);
  }

  // No wordmark/combomark sources → no derived dirs for them
  assert.ok(!files.some((file) => file.startsWith('logo/wordmark/') || file.startsWith('logo/combomark/')));

  // The black variant is actually black — the source color is gone
  const blackSvg = fs.readFileSync(path.join(root, '.omega', 'assets', 'logo', 'brandmark', 'black-x.svg'), 'utf8');
  assert.ok(blackSvg.includes('fill="#000000"'));
  assert.ok(!blackSvg.includes('#e63946'));

  // The color variant is the source verbatim
  const colorSvg = fs.readFileSync(path.join(root, '.omega', 'assets', 'logo', 'brandmark', 'color-x.svg'), 'utf8');
  assert.equal(colorSvg, BRANDMARK_SVG);

  // Container formats carry their magic bytes
  const icns = fs.readFileSync(path.join(root, '.omega', 'assets', 'app', 'macos', 'icon.icns'));
  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
  const ico = fs.readFileSync(path.join(root, '.omega', 'assets', 'favicon', 'favicon.ico'));
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);

  // The webmanifest derives from config
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.omega', 'assets', 'favicon', 'site.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'AB');
  assert.equal(manifest.icons.length, 2);
});

// ─── Idempotency (the upgrade that replaced the --onboarding gate) ───────────

test('assets: a converged rerun regenerates nothing', async () => {
  const root = stageBrand();
  await runService(root, brandConfig());

  const files = derivedFiles(root);
  const before = mtimes(root, files);

  const result = await runService(root, brandConfig());

  assert.equal(result.status, 'success');
  assert.deepEqual(mtimes(root, files), before);
  assert.equal(result.output.process.synced, true);
  assert.equal(result.output.icons.synced, true);
  assert.equal(result.output.socialIcons.synced, true);
  assert.equal(result.output.favicons.synced, true);
});

test('assets: a touched brandmark regenerates its derived files', async () => {
  const root = stageBrand();
  await runService(root, brandConfig());

  const files = derivedFiles(root);
  const before = mtimes(root, files);

  // Source newer than every derived file → everything brandmark-derived is stale
  const future = new Date(Date.now() + 10000);
  fs.utimesSync(path.join(root, 'assets', 'logo', 'brandmark.svg'), future, future);

  const result = await runService(root, brandConfig());

  assert.equal(result.status, 'success');
  const after = mtimes(root, files);
  const changed = files.filter((_, index) => after[index] !== before[index]);
  // Everything except the config-derived webmanifest regenerates
  assert.equal(changed.length, files.length - 1);
  assert.ok(!changed.includes('favicon/site.webmanifest'));
});

test('assets: a changed brand name rewrites only the webmanifest', async () => {
  const root = stageBrand();
  await runService(root, brandConfig());

  const files = derivedFiles(root);
  const before = mtimes(root, files);

  const renamed = brandConfig();
  renamed.brand.name = 'Renamed Brand';
  const result = await runService(root, renamed);

  assert.equal(result.status, 'success');
  const after = mtimes(root, files);
  const changed = files.filter((_, index) => after[index] !== before[index]);
  assert.deepEqual(changed, ['favicon/site.webmanifest']);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.omega', 'assets', 'favicon', 'site.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Renamed Brand');
  assert.equal(result.output.favicons.generated, 1);
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

test('assets: dry run on a fresh brand writes nothing and reports the plan', async () => {
  const root = stageBrand();
  const result = await runService(root, brandConfig(), { options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.deepEqual(derivedFiles(root), []);
  assert.equal(result.output.process.planned, 20);
  assert.equal(result.output.icons.planned, 2);
  assert.equal(result.output.socialIcons.planned, 4);
  assert.equal(result.output.favicons.planned, 7);
});

// ─── logo-gen ────────────────────────────────────────────────────────────────

test('assets: no brand.font → wordmark/combomark noted, everything else proceeds', async () => {
  const root = stageBrand();
  const result = await runService(root, brandConfig());

  assert.equal(result.status, 'success');
  assert.deepEqual(result.output.logos, { skipped: 'no brand.font' });
  assert.ok(!fs.existsSync(path.join(root, 'assets', 'logo', 'wordmark.svg')));
});

test('assets: brand.font + a real font file generates wordmark and combomark', async () => {
  const root = stageBrand();
  stageFont(root);

  const result = await runService(root, brandConfig({ font: 'TestFont-Regular' }));

  assert.equal(result.status, 'success');
  assert.deepEqual(result.output.logos.generated, ['wordmark', 'combomark']);

  const wordmark = fs.readFileSync(path.join(root, 'assets', 'logo', 'wordmark.svg'), 'utf8');
  assert.match(wordmark, /<path d="M/); // text as path outlines
  const combomark = fs.readFileSync(path.join(root, 'assets', 'logo', 'combomark.svg'), 'utf8');
  assert.ok(combomark.includes('<rect')); // the embedded brandmark content
  assert.match(combomark, /<path d="M/);

  // …and process derived their variant sets too
  const files = derivedFiles(root);
  assert.ok(files.includes('logo/wordmark/color-x.svg'));
  assert.ok(files.includes('logo/combomark/black-2048.png'));
});

test('assets: existing wordmark/combomark are never regenerated (missing-only)', async () => {
  const root = stageBrand();
  stageFont(root);
  await runService(root, brandConfig({ font: 'TestFont-Regular' }));

  const wordmarkPath = path.join(root, 'assets', 'logo', 'wordmark.svg');
  const before = fs.statSync(wordmarkPath).mtimeMs;

  // Even a newer brandmark must not clobber a (possibly hand-tuned) wordmark
  const future = new Date(Date.now() + 10000);
  fs.utimesSync(path.join(root, 'assets', 'logo', 'brandmark.svg'), future, future);

  const result = await runService(root, brandConfig({ font: 'TestFont-Regular' }));

  assert.equal(result.status, 'success');
  assert.equal(result.output.logos.synced, true);
  assert.equal(fs.statSync(wordmarkPath).mtimeMs, before);
});

test('assets: a configured font that cannot be found is an error', async () => {
  const root = stageBrand();
  const result = await runService(root, brandConfig({ font: 'Missing-Font' }));

  assert.equal(result.status, 'error');
  assert.match(result.error, /font "Missing-Font" not found/);
});

test('assets: dry run reports the planned wordmark/combomark without a font file', async () => {
  // The plan is reported before font resolution — dry run needs no font
  const root = stageBrand();
  const result = await runService(root, brandConfig({ font: 'Missing-Font' }), { options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.deepEqual(result.output.logos.planned, ['wordmark', 'combomark']);
  assert.ok(!fs.existsSync(path.join(root, 'assets', 'logo', 'wordmark.svg')));
});

// ─── svg-to-black ────────────────────────────────────────────────────────────

test('svg-to-black: fills, strokes, style values, and defs all go black', () => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg">',
    '<defs><linearGradient id="g"><stop stop-color="#ff0000"/></linearGradient></defs>',
    '<rect fill="url(#g)" stroke="#00ff00"/>',
    '<circle style="fill:rgb(1,2,3);stroke:blue"/>',
    '<path fill="none" stroke="none"/>',
    '</svg>',
  ].join('');

  const black = convertSvgToBlack(svg);

  assert.ok(!black.includes('<defs>'));
  assert.ok(black.includes('fill="#000000" stroke="#000000"'));
  assert.ok(black.includes('style="fill:#000000;stroke:#000000"'));
  // none is a deliberate absence, not a color
  assert.ok(black.includes('fill="none" stroke="none"'));
  assert.ok(!black.includes('ff0000') && !black.includes('00ff00'));
});
