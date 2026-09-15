/**
 * site-global.test.js — toSiteGlobal() shaping of resolved configs.
 */

const test = require('node:test');
const assert = require('node:assert');
const { toSiteGlobal } = require('../src/site-global.js');

test('identity-maps content keys and strips machinery', () => {
  const resolved = {
    brand: { id: 'somiibo', name: 'Somiibo', url: 'https://somiibo.com' },
    theme: { id: 'classy', appearance: 'dark' },
    meta: { title: 'T', description: 'D' },
    analytics: { providers: { google: { id: 'G-1' } } },
    socials: { twitter: 'somiibo' },
    translation: { default: 'en', languages: ['en', 'es'] },
    customKey: { anything: true },
    targets: { web: { type: 'web' }, backend: { type: 'backend' } },
    enabled: true,
  };

  const site = toSiteGlobal(resolved);

  assert.strictEqual(site.brand.name, 'Somiibo');
  assert.strictEqual(site.theme.id, 'classy');
  assert.strictEqual(site.socials.twitter, 'somiibo');
  assert.strictEqual(site.customKey.anything, true); // any-key passthrough
  // Raw machinery never passes through — site.targets is the CURATED view (#85)
  assert.notStrictEqual(site.targets, resolved.targets);
  assert.deepStrictEqual(site.targets, { web: { enabled: true }, backend: { enabled: true } });
  assert.strictEqual(site.enabled, undefined);
});

test('derives url from brand.url with explicit url winning', () => {
  assert.strictEqual(toSiteGlobal({ brand: { url: 'https://a.com' } }).url, 'https://a.com');
  assert.strictEqual(toSiteGlobal({ url: 'https://explicit.com', brand: { url: 'https://a.com' } }).url, 'https://explicit.com');
  assert.strictEqual(toSiteGlobal({}).url, '');
  assert.strictEqual(toSiteGlobal({}).baseurl, '');
  assert.strictEqual(toSiteGlobal({ baseurl: '/sub' }).baseurl, '/sub');
});

test('does not mutate the input config', () => {
  const resolved = { brand: { url: 'https://a.com' }, targets: { web: { type: 'web' } } };
  const before = JSON.stringify(resolved);
  toSiteGlobal(resolved);
  assert.strictEqual(JSON.stringify(resolved), before);
});

// ── curated site.targets (#85) ────────────────────────────────────────────

test('exposes curated site.targets: presence + enabled, machinery absent', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme' },
    targets: {
      web: { type: 'web' },
      backend: { type: 'backend' },
      desktop: { type: 'desktop', platforms: { win: { signing: { strategy: 'local' } } }, app: { category: 'utilities' } },
    },
  });

  assert.deepStrictEqual(Object.keys(site.targets).sort(), ['backend', 'desktop', 'web']);
  assert.strictEqual(site.targets.web.enabled, true);
  assert.strictEqual(site.targets.desktop.enabled, true);
  // Raw machinery never leaks through the curated view
  assert.strictEqual(site.targets.desktop.platforms, undefined);
  assert.strictEqual(site.targets.desktop.app, undefined);
});

test('derives the desktop releases URL: the brand\'s ONE releases repo (#799)', () => {
  const site = toSiteGlobal({
    brand: { id: 'omega-playground' },
    repo: { org: 'Omega-JS-Stack' },
    targets: { desktop: { type: 'desktop', releases: {} } },
  });

  // `<brand.id>-releases`, the default @omega.js/config's releasesRepo owns: the
  // same address the desktop build bakes into app-update.yml.
  assert.strictEqual(
    site.targets.desktop.releasesUrl,
    'https://github.com/Omega-JS-Stack/omega-playground-releases/releases/latest',
  );
});

test('desktop releases URL: the address derives, with no override left to disagree with it (#883)', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme', name: 'Acme App' },
    repo: { org: 'Acme-Org' },
    // The retired owner/repo keys are inert: a config still carrying them (the
    // validator fails it) never moves the download surface.
    targets: { desktop: { type: 'desktop', releases: { owner: 'Acme-Binaries', repo: 'acme-bins' } } },
  });

  // The hub and every direct-download URL come from the same releasesRepo call
  // @omega.js/desktop bakes into the publish block, so they cannot disagree.
  assert.strictEqual(site.targets.desktop.releasesUrl, 'https://github.com/Acme-Org/acme-releases/releases/latest');
  assert.strictEqual(
    site.targets.desktop.downloads.mac.dmg,
    'https://github.com/Acme-Org/acme-releases/releases/latest/download/Acme-App-mac-dmg.dmg',
  );
});

test('desktop releases URL omitted without a github org', () => {
  const site = toSiteGlobal({ brand: { id: 'acme' }, targets: { desktop: { type: 'desktop', releases: {} } } });
  assert.strictEqual(site.targets.desktop.enabled, true);
  assert.strictEqual(site.targets.desktop.releasesUrl, undefined);
});

// ── per-format direct downloads (#620, #867) ─────────────────────────────

test('derives a download URL per FORMAT, beside the releases hub', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme', name: 'Acme App' },
    repo: { org: 'Acme-Org' },
    targets: { desktop: { type: 'desktop', releases: {} } },
  });

  // /releases/latest/download/<asset> resolves only because the asset name
  // carries no version — the whole point of #620.
  assert.deepStrictEqual(site.targets.desktop.downloads, {
    mac: { dmg: 'https://github.com/Acme-Org/acme-releases/releases/latest/download/Acme-App-mac-dmg.dmg' },
    windows: { nsis: 'https://github.com/Acme-Org/acme-releases/releases/latest/download/Acme-App-windows-nsis.exe' },
    linux: {
      deb: 'https://github.com/Acme-Org/acme-releases/releases/latest/download/Acme-App-linux-deb.deb',
      appimage: 'https://github.com/Acme-Org/acme-releases/releases/latest/download/Acme-App-linux-appimage.AppImage',
      // A store format links the store, because the store holds the file
      snap: 'https://snapcraft.io/acme-app',
    },
  });
  assert.strictEqual(site.targets.desktop.releasesUrl, 'https://github.com/Acme-Org/acme-releases/releases/latest',
    'the hub stays — the direct URLs sit BESIDE it');
});

test('the artifact names are the packager\'s own — app.productName wins over brand.name', () => {
  const { desktopArtifactNames } = require('../src/platforms.js');
  const site = toSiteGlobal({
    brand: { id: 'acme', name: 'Acme App' },
    repo: { org: 'Acme-Org' },
    targets: { desktop: { type: 'desktop', app: { productName: 'Acme Studio' }, releases: {} } },
  });

  // One rule, two readers: @omega.js/desktop's build-config writes THESE names
  // into electron-builder.yml.
  const names = desktopArtifactNames('Acme Studio');
  assert.ok(site.targets.desktop.downloads.mac.dmg.endsWith(`/${names.mac.dmg}`));
  assert.strictEqual(names.mac.dmg, 'Acme-Studio-mac-dmg.dmg');
});

test('no product name, no direct URLs — a guessed filename is a dead button', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme' },
    repo: { org: 'Acme-Org' },
    targets: { desktop: { type: 'desktop', releases: {} } },
  });

  assert.strictEqual(site.targets.desktop.downloads, undefined);
  assert.ok(site.targets.desktop.releasesUrl, 'the hub still answers');
});

test('the direct URLs survive the second toSiteGlobal pass', () => {
  const once = toSiteGlobal({
    brand: { id: 'acme', name: 'Acme App' },
    repo: { org: 'Acme-Org' },
    targets: { desktop: { type: 'desktop', releases: {} } },
  });
  const twice = toSiteGlobal(once);

  // Pass two sees the curated view: no app block, no brand-derived product
  // name to re-derive from. The curated URLs are the authority.
  assert.deepStrictEqual(twice, once);
});

// ── the releases opt-in gate (#124) ───────────────────────────────────────

test('a bare desktop target derives nothing — no releases config, no links', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme' },
    repo: { org: 'Acme-Org' },
    targets: { desktop: { type: 'desktop', app: { category: 'utilities' } } },
  });

  assert.deepStrictEqual(site.targets.desktop, { enabled: true });
  assert.strictEqual(site.download, undefined);
});

test('a present releases block opts in (enabled defaults true)', () => {
  const url = 'https://github.com/Acme-Org/acme-releases/releases/latest';
  const base = { brand: { id: 'acme' }, repo: { org: 'Acme-Org' } };

  for (const releases of [{}, { enabled: true }, { repo: 'acme-releases' }]) {
    const site = toSiteGlobal({ ...base, targets: { desktop: { type: 'desktop', releases } } });
    assert.strictEqual(site.targets.desktop.releasesUrl, url);
  }
});

test('releases.enabled false always suppresses the derivation', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme' },
    repo: { org: 'Acme-Org' },
    targets: { desktop: { type: 'desktop', releases: { enabled: false, repo: 'update-server' } } },
  });

  assert.deepStrictEqual(site.targets.desktop, { enabled: true }, 'no releasesUrl — the download page has nothing to point at');
});

test('double application is idempotent for a bare and a suppressed desktop target', () => {
  for (const desktop of [{}, { releases: { enabled: false, repo: 'update-server' } }]) {
    const once = toSiteGlobal({
      brand: { id: 'acme' },
      repo: { org: 'Acme-Org' },
      targets: { desktop },
    });
    const twice = toSiteGlobal(once);

    assert.strictEqual(once.targets.desktop.releasesUrl, undefined);
    assert.deepStrictEqual(twice, once);
  }
});

test('#886: the curated facts key off the entry TYPE, not the name', () => {
  // A brand may name its desktop target anything; the type is what says which
  // facts it carries, so the renamed target still derives its downloads.
  const config = {
    brand: { id: 'acme', name: 'Acme' },
    repo: { org: 'Acme-Org' },
    targets: {
      web: { type: 'web' },
      app: { type: 'desktop', releases: {} },
      addon: { type: 'extension', listings: { chrome: { url: 'https://store/x' } } },
    },
  };

  const site = toSiteGlobal(config);

  assert.strictEqual(site.targets.app.releasesUrl, 'https://github.com/Acme-Org/acme-releases/releases/latest');
  assert.ok(site.targets.app.downloads.mac.dmg.endsWith('.dmg'));
  assert.deepStrictEqual(site.targets.addon.listings, { chrome: { url: 'https://store/x' } });
  assert.deepStrictEqual(site.targets.web, { enabled: true });
  assert.strictEqual(site.targets.desktop, undefined, 'nothing is keyed by the type word');

  // ...and the second pass over the curated view keeps them (idempotence)
  assert.deepStrictEqual(toSiteGlobal(site), site);
});

test('exposes extension listings on site.targets.extension', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme' },
    targets: {
      extension: { type: 'extension',
        listings: {
          chrome: { url: 'https://chromewebstore.google.com/detail/x', state: 'live' },
          firefox: { url: 'https://addons.mozilla.org/x' },
        },
      },
    },
  });

  assert.strictEqual(site.targets.extension.listings.chrome.url, 'https://chromewebstore.google.com/detail/x');
  assert.strictEqual(site.targets.extension.listings.chrome.state, 'live');
  assert.strictEqual(site.targets.extension.listings.firefox.url, 'https://addons.mozilla.org/x');
});

// ── the curated view is the ONE home (#610): no derived page maps ──

test('#610: the site data carries NO download or extension page map — site.targets is the only home', () => {
  const site = toSiteGlobal({
    brand: { id: 'omega-playground' },
    repo: { org: 'Omega-JS-Stack' },
    targets: {
      desktop: { type: 'desktop', releases: {} },
      extension: { type: 'extension', listings: { chrome: { url: 'https://chromewebstore.google.com/detail/x', state: 'live' } } },
    },
  });

  // Two homes for one fact is what #610 closed: the /download page, the
  // /extension page and the shortlink generator all read site.targets now.
  assert.strictEqual(site.download, undefined, 'no derived download map');
  assert.strictEqual(site.extension, undefined, 'no derived extension map');
  assert.strictEqual(
    site.targets.desktop.releasesUrl,
    'https://github.com/Omega-JS-Stack/omega-playground-releases/releases/latest',
    'the desktop releases URL is the ONE download fact',
  );
  assert.deepStrictEqual(
    site.targets.extension.listings,
    { chrome: { url: 'https://chromewebstore.google.com/detail/x', state: 'live' } },
    'the store listings are the ONE extension fact',
  );
});

test('#610: a config still carrying the legacy keys keeps nothing — they are not site data', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme' },
    download: { mac: { dmg: 'https://acme.com/dl/mac' } },
    extension: { chrome: 'https://acme.com/ext' },
    targets: { desktop: { type: 'desktop', releases: {} } },
  });

  // The identity map still copies whatever the config carries — the validator
  // is what refuses the keys; nothing DERIVES into them any more.
  assert.strictEqual(site.targets.desktop.enabled, true);
});

test('double application is idempotent — the build pipeline applies toSiteGlobal twice', () => {
  const resolved = {
    brand: { id: 'acme' },
    repo: { org: 'Acme-Org' },
    targets: {
      desktop: { type: 'desktop', releases: {} },
      extension: { type: 'extension', listings: { chrome: { url: 'https://store/x', state: 'live' } } },
    },
  };

  const once = toSiteGlobal(resolved);
  const twice = toSiteGlobal(once);

  // The derived URL must survive the second pass: the raw releases block is
  // gone by then, so a re-derivation off the curated view would drop the links.
  assert.strictEqual(once.targets.desktop.releasesUrl, 'https://github.com/Acme-Org/acme-releases/releases/latest');
  assert.deepStrictEqual(twice, once);
});

test('array-form (multi-instance) targets derive nothing — presence only', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme' },
    repo: { org: 'Acme-Org' },
    targets: {
      desktop: [{ id: 'main', releases: { repo: 'update-server' } }],
      extension: [{ id: 'main', listings: { chrome: { url: 'https://store/x' } } }],
    },
  });

  // Which instance's facts belong on the site is ambiguous — never guess a URL.
  assert.deepStrictEqual(site.targets.desktop, { enabled: true });
  assert.deepStrictEqual(site.targets.extension, { enabled: true });
});

test('empty listing entries stay absent from the curated view', () => {
  const site = toSiteGlobal({
    targets: { extension: { type: 'extension', listings: { chrome: {}, firefox: { url: 'https://addons.mozilla.org/x' } } } },
  });

  assert.strictEqual(site.targets.extension.listings.chrome, undefined);
  assert.strictEqual(site.targets.extension.listings.firefox.url, 'https://addons.mozilla.org/x');
});

test('a listing with no url still rides the curated view — its state is the page\'s answer', () => {
  const site = toSiteGlobal({ targets: { extension: { type: 'extension', listings: { chrome: { state: 'pending' } } } } });

  assert.deepStrictEqual(site.targets.extension.listings, { chrome: { state: 'pending' } });
});
