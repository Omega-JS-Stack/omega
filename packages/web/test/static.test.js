/**
 * The 2026-07-13 live-site gaps, pinned:
 *  1. nav/footer bind their section data — and json-in-_includes parses as
 *     JSON5 (the packaged section files use unquoted keys/comments; strict
 *     JSON.parse silently emptied every one, admin sidebar included)
 *  2. <title> falls back to the brand name when nothing configures
 *     meta.title (the live playground shape: config has no `meta` at all)
 *  3. static-asset channel: the minted brand identity (.omega/assets
 *     favicons/brandmark/social) + consumer src/assets/images ship
 *     verbatim; the consumer layer copies last and wins collisions
 *
 * One classy build over the contract fixture WITHOUT site.meta — the exact
 * shape that rendered empty <title> + empty nav on playground.omegajs.dev.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before } = require('node:test');
const { buildSite } = require('../src/build.js');
const { resolveStaticDirs, copyStaticAssets } = require('../src/static-assets.js');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');
const SITE = path.join(__dirname, 'fixtures', 'contract-site');
const OUT = path.join(PKG, '.omega', 'static-gaps');
const siteData = JSON.parse(fs.readFileSync(path.join(SITE, 'site-data.json'), 'utf8'));

let brandRoot; // fake brand tree with a minted .omega/assets set

/**
 * Write a file (and its directories) under the fake brand root.
 * @param {string[]} segments
 * @param {string} content
 */
function mint(segments, content) {
  const file = path.join(brandRoot, ...segments);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

before(async () => {
  brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-static-'));

  // The manager assets service mint contract
  mint(['.omega', 'assets', 'favicon', 'favicon.ico'], 'minted-ico');
  mint(['.omega', 'assets', 'favicon', 'favicon-32x32.png'], 'minted-32');
  mint(['.omega', 'assets', 'favicon', 'site.webmanifest'], '{"name":"Contract"}');
  mint(['.omega', 'assets', 'logo', 'brandmark', 'color-x.svg'], '<svg/>');
  mint(['.omega', 'assets', 'logo', 'brandmark', 'color-512.png'], 'minted-brandmark');
  mint(['.omega', 'assets', 'social', 'brandmark', 'color-1024.png'], 'minted-social');

  // Consumer images layer — favicon.ico collides with the mint and must win
  mint(['consumer-images', 'favicon', 'favicon.ico'], 'consumer-ico');
  mint(['consumer-images', 'hero.png'], 'consumer-hero');

  await buildSite({
    consumerDir: SITE,
    siteData: {
      ...siteData,
      meta: undefined, // the live playground shape: no meta key anywhere
      theme: { id: 'classy' },
      brand: {
        ...siteData.brand,
        images: { social: 'https://contract.test/assets/images/brand/social.png' },
      },
    },
    outDir: OUT,
    clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
    skipPurge: true,
    staticDirs: resolveStaticDirs({
      brandRoot,
      imagesDir: path.join(brandRoot, 'consumer-images'),
    }),
  });
});

test('resolveStaticDirs: core images first, mint bridge next, consumer images last, missing sources dropped', () => {
  const dirs = resolveStaticDirs({ brandRoot, imagesDir: path.join(brandRoot, 'consumer-images') });
  assert.deepStrictEqual(dirs.map((entry) => entry.dest), [
    'assets/images/core', // framework-shipped pictures (exit-popup faces)
    'assets/images/favicon',
    'assets/images/brand/brandmark.svg',
    'assets/images/brand/brandmark.png',
    'assets/images/brand/social.png',
    'assets/images', // consumer layer LAST — it wins collisions
  ]);

  // No brand root (standalone consumer without a mint) → core + consumer layer
  const bare = resolveStaticDirs({ brandRoot: null, imagesDir: path.join(brandRoot, 'consumer-images') });
  assert.deepStrictEqual(bare.map((entry) => entry.dest), ['assets/images/core', 'assets/images']);

  // No brand assets at all → the framework's own images still ship
  assert.deepStrictEqual(
    resolveStaticDirs({ brandRoot: path.join(brandRoot, 'nope'), imagesDir: path.join(brandRoot, 'nope2') })
      .map((entry) => entry.dest),
    ['assets/images/core'],
  );
});

test('static channel ships the minted set and the consumer layer wins collisions', () => {
  assert.strictEqual(fs.readFileSync(path.join(OUT, 'assets', 'images', 'favicon', 'favicon-32x32.png'), 'utf8'), 'minted-32');
  assert.strictEqual(fs.readFileSync(path.join(OUT, 'assets', 'images', 'brand', 'brandmark.png'), 'utf8'), 'minted-brandmark');
  assert.strictEqual(fs.readFileSync(path.join(OUT, 'assets', 'images', 'brand', 'brandmark.svg'), 'utf8'), '<svg/>');
  assert.strictEqual(fs.readFileSync(path.join(OUT, 'assets', 'images', 'brand', 'social.png'), 'utf8'), 'minted-social');
  assert.ok(fs.existsSync(path.join(OUT, 'assets', 'images', 'favicon', 'site.webmanifest')), 'webmanifest shipped');

  // Consumer overrides + additions
  assert.strictEqual(fs.readFileSync(path.join(OUT, 'assets', 'images', 'favicon', 'favicon.ico'), 'utf8'), 'consumer-ico', 'consumer file wins the collision');
  assert.strictEqual(fs.readFileSync(path.join(OUT, 'assets', 'images', 'hero.png'), 'utf8'), 'consumer-hero');
});

test('the shipped favicon.ico mirrors to the site root (#161: the browser probes /favicon.ico)', () => {
  const root = path.join(OUT, 'favicon.ico');
  assert.ok(fs.existsSync(root), 'root favicon.ico shipped');
  assert.strictEqual(fs.readFileSync(root, 'utf8'), 'consumer-ico', 'the root copy is the collision winner');

  // No favicon set shipped → nothing lands at the root
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-static-bare-'));
  copyStaticAssets({ staticDirs: [], outDir: bare });
  assert.ok(!fs.existsSync(path.join(bare, 'favicon.ico')), 'no set, no root favicon');
});

test('nav + footer render their section data (JSON5 json-in-_includes)', () => {
  const html = fs.readFileSync(path.join(OUT, 'about.html'), 'utf8');

  // nav.json: links + actions
  assert.ok(html.includes('href="/pricing"'), 'nav links render');
  assert.ok(html.includes('Sign up'), 'nav actions render');

  // footer.json: link groups
  assert.ok(html.includes('About us'), 'footer link groups render');
});

test('admin sidebar renders its section data too (was silently empty under JSON.parse)', () => {
  const html = fs.readFileSync(path.join(OUT, 'admin.html'), 'utf8');
  assert.ok(html.includes('Dashboard'), 'admin sidebar labels render');
  assert.ok(html.includes('href="/admin/verts"'), 'verts card is reachable from the sidebar');
});

test('<title> falls back to the brand name — no page ever renders an empty title', () => {
  let sawBrandFallback = false;

  for (const entry of fs.readdirSync(OUT, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const file = path.join(entry.parentPath, entry.name);
    const match = fs.readFileSync(file, 'utf8').match(/<title>([^<]*)<\/title>/);
    if (!match) continue; // pages without a head (bare fragments) are fine
    assert.notStrictEqual(match[1].trim(), '', `${path.relative(OUT, file)}: empty <title>`);
    if (match[1].trim() === 'Contract') sawBrandFallback = true;
  }

  assert.ok(sawBrandFallback, 'at least one page used the brand-name fallback');
});

test('head wires the minted set: webmanifest link + og:image brand fallback', () => {
  const html = fs.readFileSync(path.join(OUT, 'about.html'), 'utf8');
  assert.ok(html.includes('/assets/images/favicon/site.webmanifest'), 'manifest link points at the minted webmanifest');
  assert.ok(!html.includes('/manifest.json'), 'the old never-emitted /manifest.json link is gone');
  assert.ok(!html.includes('browserconfig.xml') && !html.includes('safari-pinned-tab'), 'legacy favicon tags dropped (mint never produces them)');
  assert.ok(html.includes('property="og:image" content="https://contract.test/assets/images/brand/social.png"'), 'og:image falls back to brand.images.social');
});
