/**
 * The 2026-07-13 live-site gaps, pinned:
 *  1. nav/footer bind their section data — and json-in-_includes parses as
 *     JSON5 (the packaged section files use unquoted keys/comments; strict
 *     JSON.parse silently emptied every one, admin sidebar included)
 *  2. <title> falls back to the brand name when nothing configures
 *     meta.title (the live playground shape: config has no `meta` at all)
 *  3. static-asset channel: the minted brand identity (.omega/assets
 *     favicons/brandmark/social) + the consumer's whole src/assets tree ship
 *     verbatim; the consumer layer copies last and wins collisions
 *
 * One classy build over the contract fixture WITHOUT site.meta — the exact
 * shape that rendered empty <title> + empty nav on playground.omegajs.dev.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
// The lane NAMES the environment
// ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)): the engine reads
// that ONE input instead of a loose `options.environment`, and a fixture build
// with no verb above it is a development build, which is what it always was.
const { setEnvironment } = require('@omega.js/config/environment');
const { MINT_BRIDGE } = require('@omega.js/config');
const { buildSite } = require('../src/build.js');
const { resolveStaticDirs, copyStaticAssets, assertMintedAssets } = require('../src/static-assets.js');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');
const SITE = path.join(__dirname, 'fixtures', 'contract-site');
const OUT = path.join(PKG, '.omega', 'static-gaps');
const siteData = JSON.parse(fs.readFileSync(path.join(SITE, 'site-data.json'), 'utf8'));
const MINT_MESSAGE = 'No minted logo set for a brand that has logo sources. Run: npx omega manage --service=assets, then deploy again.';

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

/**
 * A fresh brand root holding the given brand-root relative files.
 * @param {string[]} files
 * @returns {string} The brand root.
 */
function brandTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-static-brand-'));
  for (const relative of files) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), 'fixture');
  }
  return root;
}

/**
 * One classy build of the contract fixture, no site.meta, into `outDir`.
 * @param {string} outDir
 * @param {object[]} staticDirs
 */
async function buildFixture(outDir, staticDirs) {
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
    outDir,
    clientEntry: path.join(ROOT, 'packages', 'client', 'src', 'index.js'),
    skipPurge: true,
    staticDirs,
  });
}

module.exports = defineCases({
  type: 'group',
  description: 'static',
  setup: async () => {
    brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-static-'));

    // The manager assets service mint contract
    mint(['.omega', 'assets', 'favicon', 'favicon.ico'], 'minted-ico');
    mint(['.omega', 'assets', 'favicon', 'favicon-32x32.png'], 'minted-32');
    mint(['.omega', 'assets', 'favicon', 'site.webmanifest'], '{"name":"Contract"}');
    mint(['.omega', 'assets', 'logo', 'brandmark', 'color-x.svg'], '<svg/>');
    mint(['.omega', 'assets', 'logo', 'brandmark', 'color-512.png'], 'minted-brandmark');
    mint(['.omega', 'assets', 'social', 'brandmark', 'color-1024.png'], 'minted-social');

    // Consumer asset layer — favicon.ico collides with the mint and must win
    mint(['consumer-assets', 'images', 'favicon', 'favicon.ico'], 'consumer-ico');
    mint(['consumer-assets', 'images', 'hero.png'], 'consumer-hero');
    // Non-image media (#295): the live break was alarm mp3s 404ing
    mint(['consumer-assets', 'audio', 'alarm.mp3'], 'consumer-alarm');
    mint(['consumer-assets', 'downloads', 'guide.pdf'], 'consumer-guide');
    // Hidden entries — Finder/editor noise sitting in src/assets is not content
    mint(['consumer-assets', '.DS_Store'], 'finder-noise');
    // The PIPELINE's lanes — the asset phase owns dist/assets/{js,css,fonts}
    // (hashed bundles, and fonts pruned to referenced faces), so these must
    // never ride the static copy
    mint(['consumer-assets', 'js', 'main.js'], 'raw-source-must-not-ship');
    mint(['consumer-assets', 'css', 'main.scss'], 'raw-source-must-not-ship');
    mint(['consumer-assets', 'fonts', 'unreferenced.woff2'], 'pruned-face-must-not-return');

    setEnvironment('development');
    await buildFixture(OUT, resolveStaticDirs({
      brandRoot,
      assetsDir: path.join(brandRoot, 'consumer-assets'),
    }));
  },
  tests: [
    {
      name: 'resolveStaticDirs: core images first, mint bridge next, consumer layer last, missing sources dropped',
      run: (ctx) => {
        const dirs = resolveStaticDirs({ brandRoot, assetsDir: path.join(brandRoot, 'consumer-assets') });
        ctx.expect(dirs.map((entry) => entry.dest)).toEqual([
          'assets/images/core', // framework-shipped pictures (exit-popup faces)
          'assets/images/favicon',
          'assets/images/brand/brandmark.svg',
          'assets/images/brand/brandmark.png',
          'assets/images/brand/social.png',
          'assets/images', // consumer layer LAST — it wins collisions
          'assets/audio', // …and the rest of src/assets rides with it (#295)
          'assets/downloads',
        ]);

        // No brand root (standalone consumer without a mint) → core + consumer layer
        const bare = resolveStaticDirs({ brandRoot: null, assetsDir: path.join(brandRoot, 'consumer-assets') });
        ctx.expect(bare.map((entry) => entry.dest)).toEqual(['assets/images/core', 'assets/images', 'assets/audio', 'assets/downloads']);

        // No brand assets at all → the framework's own images still ship
        ctx.expect(resolveStaticDirs({ brandRoot: path.join(brandRoot, 'nope'), assetsDir: path.join(brandRoot, 'nope2') })
            .map((entry) => entry.dest)).toEqual(['assets/images/core']);
      },
    },

    {
      name: 'static channel ships the minted set and the consumer layer wins collisions',
      run: (ctx) => {
        ctx.expect(fs.readFileSync(path.join(OUT, 'assets', 'images', 'favicon', 'favicon-32x32.png'), 'utf8')).toBe('minted-32');
        ctx.expect(fs.readFileSync(path.join(OUT, 'assets', 'images', 'brand', 'brandmark.png'), 'utf8')).toBe('minted-brandmark');
        ctx.expect(fs.readFileSync(path.join(OUT, 'assets', 'images', 'brand', 'brandmark.svg'), 'utf8')).toBe('<svg/>');
        ctx.expect(fs.readFileSync(path.join(OUT, 'assets', 'images', 'brand', 'social.png'), 'utf8')).toBe('minted-social');
        ctx.expect(fs.existsSync(path.join(OUT, 'assets', 'images', 'favicon', 'site.webmanifest')), 'webmanifest shipped').toBeTruthy();

        // Consumer overrides + additions
        ctx.expect(fs.readFileSync(path.join(OUT, 'assets', 'images', 'favicon', 'favicon.ico'), 'utf8'), 'consumer file wins the collision').toBe('consumer-ico');
        ctx.expect(fs.readFileSync(path.join(OUT, 'assets', 'images', 'hero.png'), 'utf8')).toBe('consumer-hero');
      },
    },

    {
      name: '#295: the whole src/assets tree ships, but never the pipeline-owned lanes',
      run: (ctx) => {
        ctx.expect(fs.readFileSync(path.join(OUT, 'assets', 'audio', 'alarm.mp3'), 'utf8'), 'audio ships (was silently dropped: 404 on the live site)').toBe('consumer-alarm');
        ctx.expect(fs.readFileSync(path.join(OUT, 'assets', 'downloads', 'guide.pdf'), 'utf8')).toBe('consumer-guide');

        // js/, css/ and fonts/ belong to the asset phase — its hashed bundles already
        // sit in dist/assets, and a verbatim source copy would land beside them and
        // put the pruned font faces back
        ctx.expect(!fs.existsSync(path.join(OUT, 'assets', 'js', 'main.js')), 'js sources never ride the static lane').toBeTruthy();
        ctx.expect(!fs.existsSync(path.join(OUT, 'assets', 'css', 'main.scss')), 'css sources never ride the static lane').toBeTruthy();
        ctx.expect(!fs.existsSync(path.join(OUT, 'assets', 'fonts', 'unreferenced.woff2')), 'fonts never ride the static lane (the assets phase prunes unreferenced faces)').toBeTruthy();

        // …and neither does hidden noise: the widened lane lists every child of
        // src/assets, and .DS_Store shipped to dist with it
        ctx.expect(!fs.existsSync(path.join(OUT, 'assets', '.DS_Store')), 'dotfiles never ship').toBeTruthy();
      },
    },

    {
      name: 'the shipped favicon.ico mirrors to the site root (#161: the browser probes /favicon.ico)',
      run: (ctx) => {
        const root = path.join(OUT, 'favicon.ico');
        ctx.expect(fs.existsSync(root), 'root favicon.ico shipped').toBeTruthy();
        ctx.expect(fs.readFileSync(root, 'utf8'), 'the root copy is the collision winner').toBe('consumer-ico');

        // No favicon set shipped → nothing lands at the root
        const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-static-bare-'));
        copyStaticAssets({ staticDirs: [], outDir: bare });
        ctx.expect(!fs.existsSync(path.join(bare, 'favicon.ico')), 'no set, no root favicon').toBeTruthy();
      },
    },

    {
      name: 'nav + footer render their section data (JSON5 json-in-_includes)',
      run: (ctx) => {
        const html = fs.readFileSync(path.join(OUT, 'about.html'), 'utf8');

        // nav.json: links + actions
        ctx.expect(html.includes('href="/pricing"'), 'nav links render').toBeTruthy();
        ctx.expect(html.includes('Sign up'), 'nav actions render').toBeTruthy();

        // footer.json: link groups
        ctx.expect(html.includes('About us'), 'footer link groups render').toBeTruthy();
      },
    },

    {
      name: 'admin sidebar renders its section data too (was silently empty under JSON.parse)',
      run: (ctx) => {
        const html = fs.readFileSync(path.join(OUT, 'admin.html'), 'utf8');
        ctx.expect(html.includes('Dashboard'), 'admin sidebar labels render').toBeTruthy();
        ctx.expect(html.includes('href="/admin/verts"'), 'verts card is reachable from the sidebar').toBeTruthy();
      },
    },

    {
      name: '<title> falls back to the brand name — no page ever renders an empty title',
      run: (ctx) => {
        let sawBrandFallback = false;

        for (const entry of fs.readdirSync(OUT, { recursive: true, withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
          const file = path.join(entry.parentPath, entry.name);
          const match = fs.readFileSync(file, 'utf8').match(/<title>([^<]*)<\/title>/);
          if (!match) continue; // pages without a head (bare fragments) are fine
          ctx.expect(match[1].trim(), `${path.relative(OUT, file)}: empty <title>`).not.toBe('');
          if (match[1].trim() === 'Contract') sawBrandFallback = true;
        }

        ctx.expect(sawBrandFallback, 'at least one page used the brand-name fallback').toBeTruthy();
      },
    },

    {
      name: 'head wires the minted set: webmanifest link + og:image brand fallback',
      run: (ctx) => {
        const html = fs.readFileSync(path.join(OUT, 'about.html'), 'utf8');
        ctx.expect(html.includes('/assets/images/favicon/site.webmanifest'), 'manifest link points at the minted webmanifest').toBeTruthy();
        ctx.expect(!html.includes('/manifest.json'), 'the old never-emitted /manifest.json link is gone').toBeTruthy();
        ctx.expect(!html.includes('browserconfig.xml') && !html.includes('safari-pinned-tab'), 'legacy favicon tags dropped (mint never produces them)').toBeTruthy();
        ctx.expect(html.includes('property="og:image" content="https://contract.test/assets/images/brand/social.png"'), 'og:image falls back to brand.images.social').toBeTruthy();
      },
    },

    // ─── The minted set reaches every build ───

    {
      name: 'the static phase bridges the shared MINT_BRIDGE list to the same four site paths',
      run: (ctx) => {
        const sitePaths = [
          'assets/images/favicon',
          'assets/images/brand/brandmark.svg',
          'assets/images/brand/brandmark.png',
          'assets/images/brand/social.png',
        ];
        ctx.expect(MINT_BRIDGE.map((entry) => entry.dest), 'the one list lives in @omega.js/config').toEqual(sitePaths);

        const dirs = resolveStaticDirs({ brandRoot, assetsDir: path.join(brandRoot, 'consumer-assets') });
        ctx.expect(dirs.filter((entry) => sitePaths.includes(entry.dest))).toEqual([
          { src: path.join(brandRoot, '.omega', 'assets', 'favicon'), dest: 'assets/images/favicon' },
          { src: path.join(brandRoot, '.omega', 'assets', 'logo', 'brandmark', 'color-x.svg'), dest: 'assets/images/brand/brandmark.svg' },
          { src: path.join(brandRoot, '.omega', 'assets', 'logo', 'brandmark', 'color-512.png'), dest: 'assets/images/brand/brandmark.png' },
          { src: path.join(brandRoot, '.omega', 'assets', 'social', 'brandmark', 'color-1024.png'), dest: 'assets/images/brand/social.png' },
        ]);
        for (const sitePath of sitePaths) {
          ctx.expect(fs.existsSync(path.join(OUT, sitePath)), `${sitePath} shipped`).toBeTruthy();
        }
      },
    },

    {
      name: 'a CI build of a brand with logo sources and no minted favicon set throws the one line',
      run: (ctx) => {
        const noMint = brandTree(['assets/logo/brandmark.svg']);
        const logoOnly = brandTree(['assets/logo/brandmark.svg', '.omega/assets/logo/brandmark/color-512.png']);
        // A favicon folder without site.webmanifest is not the set the page head needs
        const noManifest = brandTree(['assets/logo/brandmark.svg', '.omega/assets/favicon/favicon.ico']);

        for (const [root, env] of [
          [noMint, { GITHUB_ACTIONS: 'true' }],
          [noMint, { CI: 'true' }],
          [logoOnly, { GITHUB_ACTIONS: 'true' }],
          [noManifest, { GITHUB_ACTIONS: 'true' }],
        ]) {
          ctx.expect(() => assertMintedAssets({ brandRoot: root, env })).toThrow((error) => {
            ctx.expect(error.message.includes(MINT_MESSAGE), `the message names the fix: ${error.message}`).toBeTruthy();
            ctx.expect(!error.message.includes('\n'), 'one line').toBeTruthy();
            return true;
          });
        }
      },
    },

    {
      name: 'a CI build with no logo sources, and a local build with no mint, are both clean',
      run: (ctx) => {
        const env = { GITHUB_ACTIONS: 'true' };
        ctx.expect(() => assertMintedAssets({ brandRoot: brandTree(['assets/fonts/brand.ttf']), env }), 'no logo sources').not.toThrow();
        ctx.expect(() => assertMintedAssets({ brandRoot: brandTree(['assets/logo/wordmark.svg']), env }), 'a wordmark is not the mint source').not.toThrow();
        ctx.expect(() => assertMintedAssets({ brandRoot: brandTree(['assets/logo/brandmark.svg']), env: {} }), 'a local build').not.toThrow();
        const minted = brandTree(['assets/logo/brandmark.svg', '.omega/assets/favicon/favicon.ico', '.omega/assets/favicon/site.webmanifest']);
        ctx.expect(() => assertMintedAssets({ brandRoot: minted, env }), 'a CI build that has its minted set').not.toThrow();
      },
    },

    {
      name: 'the head carries the favicon and manifest links with a minted set, and neither without one',
      run: async (ctx) => {
        const minted = fs.readFileSync(path.join(OUT, 'about.html'), 'utf8');
        ctx.expect(minted, 'favicon links').toMatch(/<link rel="icon"[^>]*href="[^"]*\/assets\/images\/favicon\//);
        ctx.expect(minted, 'manifest link').toMatch(/<link rel="manifest"[^>]*href="[^"]*\/assets\/images\/favicon\/site\.webmanifest/);

        const bare = brandTree([]);
        const outDir = path.join(PKG, '.omega', 'static-no-mint');
        await buildFixture(outDir, resolveStaticDirs({ brandRoot: bare, assetsDir: path.join(bare, 'assets') }));

        const none = fs.readFileSync(path.join(outDir, 'about.html'), 'utf8');
        ctx.expect(none, 'no favicon links').not.toMatch(/rel="(?:shortcut )?icon"|rel="apple-touch-icon"/);
        ctx.expect(none, 'no manifest link').not.toMatch(/rel="manifest"/);
      },
    },
  ],
});
