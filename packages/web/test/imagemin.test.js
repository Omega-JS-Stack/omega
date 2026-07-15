/**
 * The responsive image matrix (src/imagemin.js) — the UJM imagemin
 * successor, pinned against REAL encoded images:
 *   - 8 outputs per jpg/jpeg/png (320/640/1024/original × source-format +
 *     webp), quality 80, upscaling allowed so every variant name exists
 *   - gif/svg (and the minted favicon dir) ship verbatim, byte-identical
 *   - uppercase extensions lowercase safely on case-insensitive filesystems
 *   - content-addressed cache: byte-identical outputs on a warm rerun,
 *     stale entries prune when sources disappear
 *   - a file sharp can't decode warns and stays verbatim — never a failed build
 *   - devImageFallback: dev-server middleware rewrites missing variant URLs
 *     to the verbatim original (build-time markup works in dev)
 *
 * The no-imagemin path (buildSite without the option) is pinned by
 * static.test.js — its fake text-byte "pngs" would fail any decode.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before } = require('node:test');
const sharp = require('sharp');
const jetpack = require('fs-jetpack');
const { processImages, devImageFallback } = require('../src/imagemin.js');

let sourceDir; // pristine sources (simulates src/assets/images post-copy)
let imagesDir; // the working dist/assets/images tree processImages mutates
let cacheDir;
let firstRun; // result of the cold run
let firstHero320; // bytes of hero-320px.jpg from the cold run (cache determinism pin)

/** Reset imagesDir to a pristine copy of sourceDir. */
function restage() {
  jetpack.remove(imagesDir);
  jetpack.copy(sourceDir, imagesDir);
}

before(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-imagemin-'));
  sourceDir = path.join(base, 'sources');
  imagesDir = path.join(base, 'dist-images');
  cacheDir = path.join(base, 'cache');

  // Real images, varied shapes: downscale + upscale + alpha + uppercase ext
  await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .jpeg().toFile(path.join(jetpack.dir(sourceDir).path(), 'hero.jpg'));
  await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 120, b: 255, alpha: 0.5 } } })
    .png().toFile(path.join(jetpack.dir(path.join(sourceDir, 'sub')).path(), 'logo.png'));
  await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 10, g: 200, b: 10 } } })
    .jpeg().toFile(path.join(sourceDir, 'UPPER.JPG'));
  await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .gif().toFile(path.join(sourceDir, 'anim.gif'));
  await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 9, g: 9, b: 9 } } })
    .png().toFile(path.join(jetpack.dir(path.join(sourceDir, 'favicon')).path(), 'favicon-32x32.png'));
  jetpack.write(path.join(sourceDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

  restage();
  firstRun = await processImages({ imagesDir, cacheDir });
  firstHero320 = jetpack.read(path.join(imagesDir, 'hero-320px.jpg'), 'buffer');
});

test('imagemin: the 8-output matrix per responsive image, correct dimensions + formats', async () => {
  assert.deepStrictEqual(
    { images: firstRun.images, processed: firstRun.processed, fromCache: firstRun.fromCache, failed: firstRun.failed, outputs: firstRun.outputs },
    { images: 3, processed: 3, fromCache: 0, failed: 0, outputs: 24 },
  );

  // hero.jpg: full matrix, exact widths, webp really is webp
  const hero320 = await sharp(path.join(imagesDir, 'hero-320px.jpg')).metadata();
  assert.strictEqual(hero320.width, 320);
  assert.strictEqual(hero320.format, 'jpeg');
  const hero1024webp = await sharp(path.join(imagesDir, 'hero-1024px.webp')).metadata();
  assert.strictEqual(hero1024webp.width, 1024);
  assert.strictEqual(hero1024webp.format, 'webp');

  // The original NAME survives (URL contract) but is re-encoded at q80
  const heroOut = await sharp(path.join(imagesDir, 'hero.jpg')).metadata();
  assert.strictEqual(heroOut.width, 1600);
  assert.notDeepStrictEqual(
    jetpack.read(path.join(imagesDir, 'hero.jpg'), 'buffer'),
    jetpack.read(path.join(sourceDir, 'hero.jpg'), 'buffer'),
    'original re-encoded, not the verbatim copy'
  );
  assert.ok(jetpack.exists(path.join(imagesDir, 'hero.webp')), 'full-size webp twin');
});

test('imagemin: small sources UPSCALE so every variant name exists (the no-404 contract)', async () => {
  // logo.png is 200px wide — 640/1024 variants must still exist, enlarged
  const logo640 = await sharp(path.join(imagesDir, 'sub', 'logo-640px.png')).metadata();
  assert.strictEqual(logo640.width, 640);
  assert.strictEqual(logo640.hasAlpha, true, 'alpha survives the png pipeline');
  assert.ok(jetpack.exists(path.join(imagesDir, 'sub', 'logo-1024px.webp')));
});

test('imagemin: uppercase extensions ship lowercased — safe on case-insensitive filesystems', async () => {
  const files = jetpack.list(imagesDir).filter((name) => name.startsWith('UPPER'));
  assert.ok(!files.includes('UPPER.JPG'), 'uppercase original gone');
  assert.ok(files.includes('UPPER.jpg'), 'lowercased re-encoded original present');
  assert.ok(files.includes('UPPER-320px.webp'), 'variants lowercased too');
  const meta = await sharp(path.join(imagesDir, 'UPPER.jpg')).metadata();
  assert.strictEqual(meta.width, 400);
});

test('imagemin: gif/svg and the minted favicon dir ship verbatim, byte-identical', () => {
  for (const rel of ['anim.gif', 'icon.svg', path.join('favicon', 'favicon-32x32.png')]) {
    assert.deepStrictEqual(
      jetpack.read(path.join(imagesDir, rel), 'buffer'),
      jetpack.read(path.join(sourceDir, rel), 'buffer'),
      `${rel} untouched`
    );
  }
  assert.ok(!jetpack.exists(path.join(imagesDir, 'anim-320px.gif')), 'no gif variants');
  assert.ok(!jetpack.exists(path.join(imagesDir, 'favicon', 'favicon-32x32-320px.png')), 'favicon dir exempt');
});

test('imagemin: warm rerun serves everything from cache, byte-identical outputs', async () => {
  restage();
  const rerun = await processImages({ imagesDir, cacheDir });

  assert.strictEqual(rerun.processed, 0);
  assert.strictEqual(rerun.fromCache, 3);
  assert.strictEqual(rerun.pruned, 0);
  assert.deepStrictEqual(
    jetpack.read(path.join(imagesDir, 'hero-320px.jpg'), 'buffer'),
    firstHero320,
    'cache round-trip is byte-identical'
  );
});

test('imagemin: deleted sources prune their cache entries', async () => {
  jetpack.remove(path.join(sourceDir, 'hero.jpg'));
  restage();
  const rerun = await processImages({ imagesDir, cacheDir });

  assert.strictEqual(rerun.fromCache, 2);
  assert.strictEqual(rerun.pruned, 1, 'hero entry pruned');
  assert.strictEqual((jetpack.list(cacheDir) || []).length, 2, 'exactly the live entries remain');
});

test('imagemin: an undecodable image warns and ships verbatim — the build never fails', async () => {
  const corruptDir = path.join(path.dirname(imagesDir), 'corrupt-images');
  jetpack.write(path.join(corruptDir, 'broken.png'), 'this is not a png');
  const result = await processImages({ imagesDir: corruptDir, cacheDir: path.join(path.dirname(cacheDir), 'corrupt-cache') });

  assert.strictEqual(result.failed, 1);
  assert.match(result.warnings[0], /^broken\.png: /);
  assert.strictEqual(jetpack.read(path.join(corruptDir, 'broken.png')), 'this is not a png', 'verbatim copy kept');
  assert.ok(!jetpack.exists(path.join(corruptDir, 'broken-320px.png')), 'no half-made variants');
});

test('imagemin: a missing images dir is a clean no-op (sites without static images)', async () => {
  const result = await processImages({ imagesDir: path.join(os.tmpdir(), 'omega-imagemin-nope'), cacheDir });
  assert.deepStrictEqual({ images: result.images, outputs: result.outputs }, { images: 0, outputs: 0 });
});

// ─── buildSite wiring: the imagemin phase over a real build ──────────────────

test('buildSite: imagemin phase processes the shipped images and reports back', async () => {
  const { buildSite } = require('../src/build.js');
  const { resolveStaticDirs } = require('../src/static-assets.js');
  const PKG = path.resolve(__dirname, '..');
  const SITE = path.join(__dirname, 'fixtures', 'contract-site');
  const siteData = JSON.parse(fs.readFileSync(path.join(SITE, 'site-data.json'), 'utf8'));

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-imagemin-build-'));
  const consumerImages = path.join(base, 'consumer-images');
  await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 60, g: 60, b: 200 } } })
    .jpeg().toFile(path.join(jetpack.dir(consumerImages).path(), 'photo.jpg'));

  const outDir = path.join(PKG, '.omega', 'imagemin-build');
  const result = await buildSite({
    consumerDir: SITE,
    siteData,
    outDir,
    clientEntry: path.join(PKG, '..', 'client', 'src', 'index.js'),
    skipPurge: true,
    staticDirs: resolveStaticDirs({ brandRoot: null, imagesDir: consumerImages }),
    imagemin: { cacheDir: path.join(base, 'cache') },
  });

  assert.strictEqual(result.imagemin.processed, 1);
  assert.ok(result.timings.imagemin >= 0, 'imagemin phase timed like every other phase');
  const meta = await sharp(path.join(outDir, 'assets', 'images', 'photo-640px.webp')).metadata();
  assert.strictEqual(meta.width, 640);
  assert.strictEqual(meta.format, 'webp');
});

// ─── devImageFallback: dev serves originals for missing variant URLs ─────────

/** Run the middleware over a url and return the (possibly rewritten) req.url. */
function rewrite(middleware, url) {
  const req = { url };
  let nextCalled = false;
  middleware(req, {}, () => { nextCalled = true; });
  assert.ok(nextCalled, `${url}: middleware always falls through to next()`);
  return req.url;
}

test('devImageFallback: missing variants rewrite to the verbatim original; real files untouched', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-devfallback-'));
  jetpack.write(path.join(outDir, 'assets', 'images', 'hero.jpg'), 'jpg-bytes');
  jetpack.write(path.join(outDir, 'assets', 'images', 'real.webp'), 'webp-bytes');
  const middleware = devImageFallback(outDir);

  // Size suffix strips; .webp variants walk back to the source extension
  assert.strictEqual(rewrite(middleware, '/assets/images/hero-640px.jpg'), '/assets/images/hero.jpg');
  assert.strictEqual(rewrite(middleware, '/assets/images/hero-320px.webp'), '/assets/images/hero.jpg');
  assert.strictEqual(rewrite(middleware, '/assets/images/hero.webp?cb=123'), '/assets/images/hero.jpg');

  // Files that exist (or aren't images) pass through untouched
  assert.strictEqual(rewrite(middleware, '/assets/images/real.webp'), '/assets/images/real.webp');
  assert.strictEqual(rewrite(middleware, '/assets/js/main.js'), '/assets/js/main.js');
  assert.strictEqual(rewrite(middleware, '/assets/images/missing-640px.png'), '/assets/images/missing-640px.png');

  // Traversal attempts never resolve outside the out dir
  assert.strictEqual(
    rewrite(middleware, '/assets/images/../../../../etc/passwd-640px.png'),
    '/assets/images/../../../../etc/passwd-640px.png'
  );
});
