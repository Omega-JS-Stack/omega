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
    targets: { web: {}, backend: {} },
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
  const resolved = { brand: { url: 'https://a.com' }, targets: { web: {} } };
  const before = JSON.stringify(resolved);
  toSiteGlobal(resolved);
  assert.strictEqual(JSON.stringify(resolved), before);
});

// ── curated site.targets (#85) ────────────────────────────────────────────

test('exposes curated site.targets: presence + enabled, machinery absent', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme' },
    targets: {
      web: {},
      backend: {},
      desktop: { platforms: { win: { signing: { strategy: 'local' } } }, app: { category: 'utilities' } },
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
    repo: { providers: { github: { org: 'Omega-JS-Stack' } } },
    targets: { desktop: { releases: {} } },
  });

  // `<brand.id>-releases`, the default @omega.js/config's releasesRepo owns: the
  // same address the desktop build bakes into app-update.yml.
  assert.strictEqual(
    site.targets.desktop.releasesUrl,
    'https://github.com/Omega-JS-Stack/omega-playground-releases/releases/latest',
  );
});

test('desktop releases URL: releases.repo wins over the `<brand.id>-releases` default; the APP repo never does', () => {
  const base = { brand: { id: 'acme' }, repo: { providers: { github: { org: 'Acme-Org', repo: 'acme-site' } } } };

  assert.strictEqual(
    toSiteGlobal({ ...base, targets: { desktop: { releases: { repo: 'acme-bins' } } } })
      .targets.desktop.releasesUrl,
    'https://github.com/Acme-Org/acme-bins/releases/latest',
  );
  // The app repo (acme-site) is private in the #620 layout, so it can never be
  // the fallback: an undeclared releases repo is `<brand.id>-releases`.
  assert.strictEqual(
    toSiteGlobal({ ...base, targets: { desktop: { releases: {} } } }).targets.desktop.releasesUrl,
    'https://github.com/Acme-Org/acme-releases/releases/latest',
  );
});

test('desktop releases URL: releases.owner moves the whole download surface (one derivation, #799)', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme', name: 'Acme App' },
    repo: { providers: { github: { org: 'Acme-Org' } } },
    targets: { desktop: { releases: { owner: 'Acme-Binaries' } } },
  });

  // The hub and every direct-download URL come from the same releasesRepo call
  // @omega.js/desktop bakes into the publish block, so they cannot disagree.
  assert.strictEqual(site.targets.desktop.releasesUrl, 'https://github.com/Acme-Binaries/acme-releases/releases/latest');
  assert.strictEqual(
    site.targets.desktop.downloads.mac.universal,
    'https://github.com/Acme-Binaries/acme-releases/releases/latest/download/Acme-App-mac-universal.dmg',
  );
});

test('desktop releases URL omitted without a github org', () => {
  const site = toSiteGlobal({ brand: { id: 'acme' }, targets: { desktop: { releases: {} } } });
  assert.strictEqual(site.targets.desktop.enabled, true);
  assert.strictEqual(site.targets.desktop.releasesUrl, undefined);
});

// ── per-artifact direct downloads (#620) ─────────────────────────────────

test('derives a direct-download URL per artifact, beside the releases hub', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme', name: 'Acme App' },
    repo: { providers: { github: { org: 'Acme-Org' } } },
    targets: { desktop: { releases: { repo: 'releases' } } },
  });

  // /releases/latest/download/<asset> resolves only because the asset name
  // carries no version — the whole point of #620.
  assert.deepStrictEqual(site.targets.desktop.downloads, {
    mac: { universal: 'https://github.com/Acme-Org/releases/releases/latest/download/Acme-App-mac-universal.dmg' },
    windows: { universal: 'https://github.com/Acme-Org/releases/releases/latest/download/Acme-App-windows-universal.exe' },
    linux: {
      debian: 'https://github.com/Acme-Org/releases/releases/latest/download/Acme-App-linux-debian.deb',
      appimage: 'https://github.com/Acme-Org/releases/releases/latest/download/Acme-App-linux-appimage.AppImage',
    },
  });
  assert.strictEqual(site.targets.desktop.releasesUrl, 'https://github.com/Acme-Org/releases/releases/latest',
    'the hub stays — the direct URLs sit BESIDE it');
});

test('the artifact names are the packager\'s own — app.productName wins over brand.name', () => {
  const { desktopArtifactNames } = require('../src/desktop-artifacts.js');
  const site = toSiteGlobal({
    brand: { id: 'acme', name: 'Acme App' },
    repo: { providers: { github: { org: 'Acme-Org' } } },
    targets: { desktop: { app: { productName: 'Acme Studio' }, releases: {} } },
  });

  // One rule, two readers: @omega.js/desktop's build-config writes THESE names
  // into electron-builder.yml.
  const names = desktopArtifactNames('Acme Studio');
  assert.ok(site.targets.desktop.downloads.mac.universal.endsWith(`/${names.mac.universal}`));
  assert.strictEqual(names.mac.universal, 'Acme-Studio-mac-universal.dmg');
});

test('no product name, no direct URLs — a guessed filename is a dead button', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme' },
    repo: { providers: { github: { org: 'Acme-Org' } } },
    targets: { desktop: { releases: {} } },
  });

  assert.strictEqual(site.targets.desktop.downloads, undefined);
  assert.ok(site.targets.desktop.releasesUrl, 'the hub still answers');
});

test('the direct URLs survive the second toSiteGlobal pass', () => {
  const once = toSiteGlobal({
    brand: { id: 'acme', name: 'Acme App' },
    repo: { providers: { github: { org: 'Acme-Org' } } },
    targets: { desktop: { releases: { repo: 'releases' } } },
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
    repo: { providers: { github: { org: 'Acme-Org', repo: 'acme-site' } } },
    targets: { desktop: { app: { category: 'utilities' } } },
  });

  assert.deepStrictEqual(site.targets.desktop, { enabled: true });
  assert.strictEqual(site.download, undefined);
});

test('a present releases block opts in (enabled defaults true)', () => {
  const url = 'https://github.com/Acme-Org/acme-releases/releases/latest';
  const base = { brand: { id: 'acme' }, repo: { providers: { github: { org: 'Acme-Org', repo: 'acme-site' } } } };

  for (const releases of [{}, { enabled: true }, { repo: 'acme-releases' }]) {
    const site = toSiteGlobal({ ...base, targets: { desktop: { releases } } });
    assert.strictEqual(site.targets.desktop.releasesUrl, url);
  }
});

test('releases.enabled false always suppresses the derivation', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme' },
    repo: { providers: { github: { org: 'Acme-Org', repo: 'acme-site' } } },
    targets: { desktop: { releases: { enabled: false, repo: 'update-server' } } },
  });

  assert.deepStrictEqual(site.targets.desktop, { enabled: true }, 'no releasesUrl — the download page has nothing to point at');
});

test('double application is idempotent for a bare and a suppressed desktop target', () => {
  for (const desktop of [{}, { releases: { enabled: false, repo: 'update-server' } }]) {
    const once = toSiteGlobal({
      brand: { id: 'acme' },
      repo: { providers: { github: { org: 'Acme-Org', repo: 'acme-site' } } },
      targets: { desktop },
    });
    const twice = toSiteGlobal(once);

    assert.strictEqual(once.targets.desktop.releasesUrl, undefined);
    assert.deepStrictEqual(twice, once);
  }
});

test('exposes extension listings on site.targets.extension', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme' },
    targets: {
      extension: {
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
    repo: { providers: { github: { org: 'Omega-JS-Stack' } } },
    targets: {
      desktop: { releases: {} },
      extension: { listings: { chrome: { url: 'https://chromewebstore.google.com/detail/x', state: 'live' } } },
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
    download: { mac: { universal: 'https://acme.com/dl/mac' } },
    extension: { chrome: 'https://acme.com/ext' },
    targets: { desktop: { releases: {} } },
  });

  // The identity map still copies whatever the config carries — the validator
  // is what refuses the keys; nothing DERIVES into them any more.
  assert.strictEqual(site.targets.desktop.enabled, true);
});

test('double application is idempotent — the build pipeline applies toSiteGlobal twice', () => {
  const resolved = {
    brand: { id: 'acme' },
    repo: { providers: { github: { org: 'Acme-Org', repo: 'acme-site' } } },
    targets: {
      desktop: { releases: { repo: 'update-server' } },
      extension: { listings: { chrome: { url: 'https://store/x', state: 'live' } } },
    },
  };

  const once = toSiteGlobal(resolved);
  const twice = toSiteGlobal(once);

  // The releases.repo-derived URL must survive the second pass — the raw key is
  // gone by then and a re-derivation would silently fall back to repo.providers.github.repo.
  assert.strictEqual(once.targets.desktop.releasesUrl, 'https://github.com/Acme-Org/update-server/releases/latest');
  assert.deepStrictEqual(twice, once);
});

test('array-form (multi-instance) targets derive nothing — presence only', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme' },
    repo: { providers: { github: { org: 'Acme-Org' } } },
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
    targets: { extension: { listings: { chrome: {}, firefox: { url: 'https://addons.mozilla.org/x' } } } },
  });

  assert.strictEqual(site.targets.extension.listings.chrome, undefined);
  assert.strictEqual(site.targets.extension.listings.firefox.url, 'https://addons.mozilla.org/x');
});

test('a listing with no url still rides the curated view — its state is the page\'s answer', () => {
  const site = toSiteGlobal({ targets: { extension: { listings: { chrome: { state: 'pending' } } } } });

  assert.deepStrictEqual(site.targets.extension.listings, { chrome: { state: 'pending' } });
});
