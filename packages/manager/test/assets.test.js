/**
 * Assets service tests — the REAL pipeline (sharp, png2icons, opentype.js)
 * against temp brand roots; nothing is faked because nothing leaves the
 * machine. Proves skip semantics, full generation from a brandmark, the
 * mtime idempotency that replaced omega-manager's --onboarding gate
 * (converged rerun = zero writes), staleness regeneration, the dry-run
 * zero-write guarantee, wordmark/combomark generation from a
 * programmatically-built font (missing-only — never overwritten), the
 * de-ITW'd no-packaged-font behavior, the svg-to-black conversion, and the
 * `--reset-assets` force refresh that clears the cache so a converged brand
 * rebuilds anyway (#214).
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

function runService(root, config, { options = {}, context = {} } = {}) {
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
    ...context,
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

test('assets: registered after directory with the six operations in dependency order', () => {
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('directory') + 1], 'assets');
  // templates before icons — icons prefers the composited icon.png it makes
  assert.deepEqual(OPERATIONS.assets.map((o) => o.name), ['logo-gen', 'process', 'templates', 'icons', 'social-icons', 'favicons']);
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

// ─── PSD templates (seed from the company + layer replacement + exports) ─────

const { readPsd, writePsdBuffer, initializeCanvas } = require('ag-psd');
const { createCanvas } = require('canvas');
const { TEMPLATE_CONFIG } = require('../src/services/assets/lib/assets-config.js');

initializeCanvas(createCanvas);

function filledCanvas(w, h, color) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return c;
}

/** A fixture PSD in the template layer convention (Main/Logo/Logo + optional text layers). */
function fixturePsd(width, height, { textLayers = [] } = {}) {
  return writePsdBuffer({
    width,
    height,
    children: [
      { name: 'Background', canvas: filledCanvas(width, height, '#ffffff'), left: 0, top: 0 },
      {
        name: 'Main',
        children: [
          {
            name: 'Logo',
            children: [
              { name: 'Logo', canvas: filledCanvas(200, 200, '#00ff00'), left: 100, top: 100 },
            ],
          },
          ...(textLayers.length > 0 ? [{
            name: 'Text',
            children: textLayers.map((name, i) => ({
              name,
              canvas: filledCanvas(300, 60, '#0000ff'),
              left: 50,
              top: 400 + i * 80,
              text: { text: 'PLACEHOLDER', style: { fontSize: 48 } },
            })),
          }] : []),
        ],
      },
    ],
  });
}

/** A company root with templates + the marker stamped into the brand. */
function stageCompany(brandRoot, templates) {
  const companyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-assets-company-'));
  fs.mkdirSync(path.join(companyRoot, 'config'));
  fs.writeFileSync(path.join(companyRoot, 'config', 'omega.json5'), '{ brands: { roots: ["./brands"] } }');
  fs.mkdirSync(path.join(companyRoot, 'assets', 'templates'), { recursive: true });
  for (const [name, buffer] of Object.entries(templates)) {
    fs.writeFileSync(path.join(companyRoot, 'assets', 'templates', `${name}.psd`), buffer);
  }
  fs.mkdirSync(path.join(brandRoot, '.omega'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, '.omega', 'company.json'), JSON.stringify({ root: companyRoot }));
  return companyRoot;
}

function readBrandPsd(root, name) {
  return readPsd(fs.readFileSync(path.join(root, 'assets', 'templates', `${name}.psd`)));
}

test('templates: seeded from the company, logo layer re-rastered, PNG exported, icons consume the composite', async () => {
  const root = stageBrand();
  stageCompany(root, { 'app-macos-icon': fixturePsd(1024, 1024) });

  const result = await runService(root, brandConfig());
  assert.equal(result.status, 'success');
  assert.equal(result.output.templates.seeded, 1);
  assert.equal(result.output.templates.processed, 1);
  assert.equal(result.output.templates.missing.length, Object.keys(TEMPLATE_CONFIG).length - 1);

  // The seeded PSD is now brand collateral with the brandmark in its logo layer
  const psd = readBrandPsd(root, 'app-macos-icon');
  const logo = psd.children.find((l) => l.name === 'Main')
    .children.find((l) => l.name === 'Logo').children[0];
  const logoSize = Math.floor(0.575 * 1024);
  assert.equal(logo.canvas.width, logoSize);
  assert.equal(logo.canvas.height, logoSize);
  // Centered inside the configured bounds — not the fixture's 100,100
  assert.ok(logo.left > 79 && logo.top > 90, `logo at ${logo.left},${logo.top}`);
  // The re-raster carries the brandmark's red, not the fixture's green
  const px = logo.canvas.getContext('2d').getImageData(logoSize / 2, logoSize / 2, 1, 1).data;
  assert.ok(px[0] > 200 && px[1] < 100, `center pixel rgb(${px[0]},${px[1]},${px[2]})`);

  // The export composite exists at template dimensions
  const iconPng = path.join(root, '.omega', 'assets', 'app', 'macos', 'icon.png');
  assert.ok(fs.existsSync(iconPng));
  const sharp = require('sharp');
  const meta = await sharp(iconPng).metadata();
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1024);

  // The icons op ran AFTER templates and used the composited icon.png
  // (its .icns must be newer than the composite it derives from)
  const icns = path.join(root, '.omega', 'assets', 'app', 'macos', 'icon.icns');
  assert.ok(fs.statSync(icns).mtimeMs >= fs.statSync(iconPng).mtimeMs);
});

test('templates: text layers take brandConfig values and overflow shrinks the font', async () => {
  const root = stageBrand();
  stageCompany(root, {
    'social-og-image': fixturePsd(1200, 630, { textLayers: ['Brand Name', 'Brand Tagline'] }),
  });

  const config = brandConfig();
  config.brand.tagline = 'A very long fixture tagline that cannot possibly fit inside seventy percent of the canvas width without shrinking quite a lot first';

  const result = await runService(root, config);
  assert.equal(result.status, 'success');
  assert.equal(result.output.templates.processed, 1);

  const psd = readBrandPsd(root, 'social-og-image');
  const textFolder = psd.children.find((l) => l.name === 'Main').children.find((l) => l.name === 'Text');
  const nameLayer = textFolder.children.find((l) => l.name === 'Brand Name');
  const taglineLayer = textFolder.children.find((l) => l.name === 'Brand Tagline');

  assert.equal(nameLayer.text.text, 'AB');
  assert.equal(taglineLayer.text.text, config.brand.tagline);
  // 'AB' fits at 48pt; the long tagline had to shrink
  assert.equal(nameLayer.text.style.fontSize, 48);
  assert.ok(taglineLayer.text.style.fontSize < 48, `tagline still ${taglineLayer.text.style.fontSize}pt`);

  const meta = await require('sharp')(path.join(root, '.omega', 'assets', 'social', 'og-image.png')).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
});

test('templates: converged rerun is zero-work; a touched PSD reprocesses', async () => {
  const root = stageBrand();
  stageCompany(root, { 'app-macos-icon': fixturePsd(1024, 1024) });
  await runService(root, brandConfig());

  const psdPath = path.join(root, 'assets', 'templates', 'app-macos-icon.psd');
  const pngPath = path.join(root, '.omega', 'assets', 'app', 'macos', 'icon.png');
  const before = [fs.statSync(psdPath).mtimeMs, fs.statSync(pngPath).mtimeMs];

  const rerun = await runService(root, brandConfig());
  assert.equal(rerun.output.templates.processed, 0);
  assert.equal(rerun.output.templates.seeded, 0);
  assert.equal(rerun.output.templates.fresh, 1);
  assert.deepEqual([fs.statSync(psdPath).mtimeMs, fs.statSync(pngPath).mtimeMs], before);

  // A manual Photoshop edit (mtime bump) → the logo refresh + export rerun
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(psdPath, future, future);
  const touched = await runService(root, brandConfig());
  assert.equal(touched.output.templates.processed, 1);
  assert.ok(fs.statSync(pngPath).mtimeMs > before[1]);
});

test('templates: dry-run plans the seed + process and writes nothing', async () => {
  const root = stageBrand();
  stageCompany(root, { 'app-macos-icon': fixturePsd(1024, 1024) });

  const result = await runService(root, brandConfig(), { options: { dryRun: true } });
  assert.equal(result.status, 'success');
  assert.deepEqual(result.output.templates.planned, ['app-macos-icon (seed + process)']);
  assert.ok(!fs.existsSync(path.join(root, 'assets', 'templates')));
  assert.deepEqual(derivedFiles(root), []);
});

test('templates: no PSDs anywhere is a quiet note, never a warn', async () => {
  const root = stageBrand(); // no company marker, no brand templates
  const result = await runService(root, brandConfig());

  assert.equal(result.status, 'success');
  assert.equal(result.output.templates.missing.length, Object.keys(TEMPLATE_CONFIG).length);
  assert.equal(result.output.templates.processed, 0);
});

// ─── AI brandmark generation (MrLogo product ladder) ────────────────────────

const http = require('node:http');
const { openTtyPrompt } = require('./lib/interactive.js');

// Tests must never see real MrLogo credentials from the shell environment
const MRLOGO_ENV_VARS = ['MRLOGO_SERVICE_ACCOUNT', 'MRLOGO_API_KEY', 'MRLOGO_API_URL', 'LOGO_API_ID_TOKEN'];
for (const key of MRLOGO_ENV_VARS) {
  delete process.env[key];
}

const GENERATED_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#1d3557"/></svg>';

/** A local logo API: POST /logos → mono SVG URL; GET /mono.svg → the SVG. */
function startLogoApi() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: body ? JSON.parse(body) : null });
      if (req.method === 'POST' && req.url === '/logos') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ iteration: { files: { monoSvg: { url: `http://127.0.0.1:${server.address().port}/mono.svg` } } } }));
      } else if (req.url === '/mono.svg') {
        res.end(GENERATED_SVG);
      } else {
        res.statusCode = 404;
        res.end('not found');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}/logos` }));
  });
}

test('brandmark: interactive generation via the logo API roots the whole derived set', async () => {
  const api = await startLogoApi();
  const root = stageBrand({ brandmark: false });
  const config = brandConfig();
  config.brand.description = 'A fixture brand';

  process.env.MRLOGO_API_URL = api.url;
  process.env.LOGO_API_ID_TOKEN = 'test-token-123';
  const tty = openTtyPrompt();
  try {
    const running = runService(root, config);
    await tty.answer('Logo prompt', 'geometric fox\r');
    const result = await running;

    assert.equal(result.status, 'success');

    // The generated SVG landed as committed brand collateral
    assert.equal(fs.readFileSync(path.join(root, 'assets', 'logo', 'brandmark.svg'), 'utf8'), GENERATED_SVG);

    // The request carried the token + the brand identity + the typed direction
    const post = api.requests.find((r) => r.method === 'POST');
    assert.equal(post.authorization, 'Bearer test-token-123');
    assert.equal(post.body.brandName, 'AB');
    assert.equal(post.body.mode, 'brandmark');
    assert.equal(post.body.description, 'A fixture brand. geometric fox');
    assert.deepEqual(post.body.colors, ['#000000']);

    // And the rest of the service derived from it in the same run
    const colorSvg = fs.readFileSync(path.join(root, '.omega', 'assets', 'logo', 'brandmark', 'color-x.svg'), 'utf8');
    assert.equal(colorSvg, GENERATED_SVG);
  } finally {
    tty.close();
    delete process.env.MRLOGO_API_URL;
    delete process.env.LOGO_API_ID_TOKEN;
    api.server.close();
  }
});

test('brandmark: no credentials skips with the ladder guidance — no API call', async () => {
  const api = await startLogoApi();
  const root = stageBrand({ brandmark: false });

  // No MRLOGO_SERVICE_ACCOUNT / MRLOGO_API_KEY / LOGO_API_ID_TOKEN → nothing to mint with
  process.env.MRLOGO_API_URL = api.url;
  const tty = openTtyPrompt();
  try {
    const result = await runService(root, brandConfig());

    assert.equal(result.status, 'skipped');
    assert.match(result.reason, /brandmark\.svg/);
    assert.match(result.reason, /MRLOGO_SERVICE_ACCOUNT/);
    assert.equal(api.requests.length, 0);
    assert.ok(!fs.existsSync(path.join(root, 'assets', 'logo', 'brandmark.svg')));
  } finally {
    tty.close();
    delete process.env.MRLOGO_API_URL;
    api.server.close();
  }
});

test('brandmark: dry runs never generate; non-interactive runs GENERATE when credentialed', async () => {
  const api = await startLogoApi();
  process.env.MRLOGO_API_URL = api.url;
  process.env.LOGO_API_ID_TOKEN = 'test-token-123';
  try {
    // Dry run: interactive TTY, credential present — still no attempt
    const tty = openTtyPrompt();
    try {
      const dry = await runService(stageBrand({ brandmark: false }), brandConfig(), { options: { dryRun: true } });
      assert.equal(dry.status, 'skipped');
      assert.equal(api.requests.length, 0);
    } finally {
      tty.close();
    }

    // Headless with a credential: setting it IS the consent — the brandmark
    // mints and the whole leg runs to success. This is the pipeline story.
    const headless = await runService(stageBrand({ brandmark: false }), brandConfig());
    assert.equal(headless.status, 'success');
    const mint = api.requests.find((request) => request.url === '/logos');
    assert.ok(mint, 'the logo API was called');
    assert.equal(mint.body.brandName, 'AB');
  } finally {
    delete process.env.MRLOGO_API_URL;
    delete process.env.LOGO_API_ID_TOKEN;
    api.server.close();
  }
});

test('brandmark: MRLOGO_API_KEY rides the same Bearer transport (BEM resolves non-JWTs by api.privateKey)', async () => {
  const api = await startLogoApi();
  const root = stageBrand({ brandmark: false });

  process.env.MRLOGO_API_URL = api.url;
  process.env.MRLOGO_API_KEY = 'k'.repeat(43);
  try {
    const result = await runService(root, brandConfig());

    assert.equal(result.status, 'success');
    const post = api.requests.find((r) => r.method === 'POST');
    assert.equal(post.authorization, `Bearer ${'k'.repeat(43)}`);
    assert.equal(fs.readFileSync(path.join(root, 'assets', 'logo', 'brandmark.svg'), 'utf8'), GENERATED_SVG);
  } finally {
    delete process.env.MRLOGO_API_URL;
    delete process.env.MRLOGO_API_KEY;
    api.server.close();
  }
});

// ─── Force refresh (#214) ────────────────────────────────────────────────────

const { resolveResetKinds, resetAssetsCache } = require('../src/services/assets/lib/reset.js');

test('reset: the flag resolves to kinds: bare = both, a value = that kind, unknown throws', () => {
  assert.deepEqual(resolveResetKinds(undefined), []);
  assert.deepEqual(resolveResetKinds(true), ['logos', 'templates']);
  assert.deepEqual(resolveResetKinds('templates'), ['templates']);
  assert.deepEqual(resolveResetKinds('templates,logos'), ['logos', 'templates']);
  assert.throws(() => resolveResetKinds('logo'), /Unknown --reset-assets kind\(s\): logo/);
});

test('reset: clearing one kind leaves the other kind and the brand sources alone', async () => {
  const root = stageBrand();
  stageCompany(root, { 'app-macos-icon': fixturePsd(1024, 1024) });
  await runService(root, brandConfig());
  const outDir = path.join(root, '.omega', 'assets');

  const logos = resetAssetsCache({ outDir, kinds: ['logos'] });

  assert.ok(logos.removed.includes('logo/brandmark'));
  assert.ok(logos.removed.includes('social/brandmark'));
  assert.ok(logos.removed.includes('favicon'));
  assert.ok(logos.removed.includes(path.join('app', 'macos', 'icon.icns')));
  // The templates kind's export survives; only it is left
  assert.deepEqual(derivedFiles(root), ['app/macos/icon.png']);

  const templates = resetAssetsCache({ outDir, kinds: ['templates'] });

  assert.ok(templates.removed.includes(path.join('app', 'macos', 'icon.png')));
  assert.deepEqual(derivedFiles(root), []);

  // Only .omega/assets/ is cache: the brand's committed sources are never touched
  assert.ok(fs.existsSync(path.join(root, 'assets', 'logo', 'brandmark.svg')));
  assert.ok(fs.existsSync(path.join(root, 'assets', 'templates', 'app-macos-icon.psd')));
});

test('assets: --reset-assets regenerates the derived set a converged rerun skips', async () => {
  const root = stageBrand();
  await runService(root, brandConfig());

  const files = derivedFiles(root);
  const before = mtimes(root, files);

  // Timestamps alone: the rerun has nothing to do
  const converged = await runService(root, brandConfig());
  assert.equal(converged.output.process.synced, true);
  assert.deepEqual(mtimes(root, files), before);

  // Forced: the cache is cleared, so the same walk rebuilds every file
  const forced = await runService(root, brandConfig(), { options: { resetAssets: true } });

  assert.equal(forced.status, 'success');
  assert.deepEqual(derivedFiles(root), files);
  assert.equal(forced.output.process.generated, 20);
  assert.equal(forced.output.icons.generated, 2);
  assert.equal(forced.output.socialIcons.generated, 4);
  assert.equal(forced.output.favicons.generated, 7);
  const after = mtimes(root, files);
  assert.equal(files.filter((_, index) => after[index] === before[index]).length, 0);
});

test('assets: --reset-assets=templates re-exports the PSD and leaves the logo variants fresh', async () => {
  const root = stageBrand();
  stageCompany(root, { 'app-macos-icon': fixturePsd(1024, 1024) });
  await runService(root, brandConfig());

  const logoSvg = path.join(root, '.omega', 'assets', 'logo', 'brandmark', 'color-x.svg');
  const iconPng = path.join(root, '.omega', 'assets', 'app', 'macos', 'icon.png');
  const before = { logo: fs.statSync(logoSvg).mtimeMs, icon: fs.statSync(iconPng).mtimeMs };

  const result = await runService(root, brandConfig(), { options: { resetAssets: 'templates' } });

  assert.equal(result.status, 'success');
  assert.equal(result.output.templates.processed, 1);
  // The PSD is brand collateral, not cache: it is re-processed, never re-seeded
  assert.equal(result.output.templates.seeded, 0);
  assert.equal(result.output.process.synced, true);
  assert.equal(fs.statSync(logoSvg).mtimeMs, before.logo);
  assert.ok(fs.statSync(iconPng).mtimeMs > before.icon);
});

test('assets: a dry run reports the reset and deletes nothing', async () => {
  const root = stageBrand();
  await runService(root, brandConfig());

  const files = derivedFiles(root);
  const before = mtimes(root, files);

  const result = await runService(root, brandConfig(), { options: { resetAssets: true, dryRun: true } });

  assert.equal(result.status, 'success');
  assert.deepEqual(derivedFiles(root), files);
  assert.deepEqual(mtimes(root, files), before);
});

test('brandmark: operator SA ensures the brand\'s own product user and generates with ITS api key', async () => {
  const api = await startLogoApi();
  const root = stageBrand({ brandmark: false });
  const config = brandConfig();
  config.brand.contact = { email: 'support@fixture-brand.test' };

  // Injected seams stand in for MRLOGO_SERVICE_ACCOUNT (the trio pattern):
  // the user already exists on MrLogo, its doc carries the private key
  const lookups = [];
  const reads = [];
  const context = {
    mrlogoAuthAdmin: {
      getUserByEmail: async (email) => { lookups.push(email); return { uid: 'mrlogo-uid-1' }; },
    },
    mrlogoDb: {
      getDoc: async (docPath) => { reads.push(docPath); return { api: { privateKey: 'pk-fixture-brand-key' } }; },
    },
  };

  process.env.MRLOGO_API_URL = api.url;
  try {
    const result = await runService(root, config, { context });

    assert.equal(result.status, 'success');
    assert.deepEqual(lookups, ['support@fixture-brand.test']);
    assert.deepEqual(reads, ['users/mrlogo-uid-1']);
    const post = api.requests.find((r) => r.method === 'POST');
    assert.equal(post.authorization, 'Bearer pk-fixture-brand-key');
  } finally {
    delete process.env.MRLOGO_API_URL;
    api.server.close();
  }
});
