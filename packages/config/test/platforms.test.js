/**
 * platforms: the ONE shipping vocabulary and format table (#867). What each
 * target can ship, what each format needs to ship, and the versionless
 * artifact names desktop packages under (#620, inherited from the retired
 * desktop-artifacts.js).
 */
const assert = require('node:assert');
const { test } = require('node:test');

const {
  PLATFORMS, FORMATS, enabledFormats, formatKeys,
  desktopProductName, sanitizeProductName, desktopArtifactName, desktopArtifactNames,
} = require('../src/index.js');
const { ENV_SCHEMA } = require('../src/env-schema.js');
const { SHARED_SCHEMA, TARGET_SCHEMAS } = require('../src/schema.js');

// ─── the vocabulary ──────────────────────────────────────────────────────────

test('the vocabulary is the client\'s, per target: mac, never macos', () => {
  assert.deepStrictEqual(PLATFORMS.desktop, ['mac', 'windows', 'linux']);
  assert.deepStrictEqual(PLATFORMS.extension, ['chrome', 'firefox', 'edge']);
  // Every platform in the vocabulary carries a format table, and nothing else does
  assert.deepStrictEqual(Object.keys(FORMATS), ['desktop', 'extension']);
  for (const target of Object.keys(FORMATS)) {
    assert.deepStrictEqual(Object.keys(FORMATS[target]), PLATFORMS[target], target);
  }
});

test('every format says what it IS: a release asset with an extension, or a store', () => {
  assert.deepStrictEqual(Object.keys(FORMATS.desktop.mac), ['dmg']);
  assert.deepStrictEqual(Object.keys(FORMATS.desktop.windows), ['nsis']);
  assert.deepStrictEqual(Object.keys(FORMATS.desktop.linux), ['deb', 'appimage', 'snap']);
  assert.deepStrictEqual(Object.keys(FORMATS.extension.chrome), ['zip', 'store']);

  assert.equal(FORMATS.desktop.windows.nsis.kind, 'asset');
  assert.equal(FORMATS.desktop.windows.nsis.ext, 'exe');
  assert.equal(FORMATS.desktop.linux.appimage.ext, 'AppImage');
  // A store publishes; it is never a file on the releases repo
  assert.equal(FORMATS.desktop.linux.snap.kind, 'store');
  assert.equal(FORMATS.desktop.linux.snap.ext, undefined);
  assert.equal(FORMATS.extension.chrome.store.kind, 'store');
  assert.equal(FORMATS.extension.chrome.zip.kind, 'asset');
});

// ─── the keys a format cannot ship without ───────────────────────────────────

test('every env key a format requires EXISTS in the env schema', () => {
  const names = new Set(ENV_SCHEMA.filter((entry) => entry.name).map((entry) => entry.name));
  const missing = [];

  for (const [target, platforms] of Object.entries(FORMATS)) {
    for (const [platform, formats] of Object.entries(platforms)) {
      for (const [format, spec] of Object.entries(formats)) {
        for (const key of spec.requires) {
          if (!names.has(key)) missing.push(`${target}.${platform}.${format}: ${key}`);
        }
      }
    }
  }

  assert.deepStrictEqual(missing, [], 'a format cannot require a key the env schema does not declare');
});

test('every listing id a format needs is a DECLARED config path (#893), never an env key', () => {
  const paths = new Set([...SHARED_SCHEMA, ...Object.values(TARGET_SCHEMAS).flat()].map((rule) => rule.path));
  const missing = [];

  for (const platforms of Object.values(FORMATS)) {
    for (const formats of Object.values(platforms)) {
      for (const spec of Object.values(formats)) {
        for (const path of spec.listing) {
          if (!paths.has(path)) missing.push(path);
        }
      }
    }
  }

  assert.deepStrictEqual(missing, []);
  assert.deepStrictEqual(FORMATS.extension.chrome.store.listing, ['listings.chrome.id']);
  assert.deepStrictEqual(FORMATS.extension.edge.store.listing, ['listings.edge.id']);
  assert.deepStrictEqual(FORMATS.desktop.mac.dmg.listing, []);

  // `listing` is what a store needs BEFORE it can accept an upload, so firefox
  // declares none: AMO takes the manifest's gecko id and the first publish
  // writes the id back (#893). An empty list is what keeps the walk from ever
  // asking a human for a value nothing but a publish can produce.
  assert.deepStrictEqual(FORMATS.extension.firefox.store.listing, []);
});

test('every store says what it is called and where its listing is created (#867)', () => {
  // The walk opens that page Enter-gated and the publish prints it in the
  // manual step it leaves behind, so both read ONE home.
  for (const [target, platforms] of Object.entries(FORMATS)) {
    for (const [platform, formats] of Object.entries(platforms)) {
      for (const [format, spec] of Object.entries(formats)) {
        if (spec.kind !== 'store') continue;

        assert.ok(spec.label, `${target}.${platform}.${format} needs a label`);
        assert.match(spec.console, /^https:\/\//, `${target}.${platform}.${format} needs the page that creates the listing`);
      }
    }
  }
});

test('every platform and format in the table is DECLARED in the config schema', () => {
  // The table and the schema are two files, so a format added to one and not
  // the other is a config key that validates as undeclared or a declaration
  // nothing ships.
  const paths = new Set([...SHARED_SCHEMA, ...Object.values(TARGET_SCHEMAS).flat()].map((rule) => rule.path));
  const missing = [];

  for (const [target, platforms] of Object.entries(FORMATS)) {
    for (const [platform, formats] of Object.entries(platforms)) {
      if (!paths.has(`platforms.${platform}`)) missing.push(`${target}: platforms.${platform}`);
      for (const format of Object.keys(formats)) {
        if (!paths.has(`platforms.${platform}.formats.${format}`)) missing.push(`${target}: platforms.${platform}.formats.${format}`);
      }
    }
  }

  assert.deepStrictEqual(missing, []);
});

test('each store names its own developer keys, and snap names its login', () => {
  assert.deepStrictEqual(FORMATS.extension.chrome.store.requires, ['CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN']);
  assert.deepStrictEqual(FORMATS.extension.firefox.store.requires, ['FIREFOX_API_KEY', 'FIREFOX_API_SECRET']);
  assert.deepStrictEqual(FORMATS.extension.edge.store.requires, ['EDGE_CLIENT_ID', 'EDGE_API_KEY']);
  assert.deepStrictEqual(FORMATS.desktop.linux.snap.requires, ['SNAPCRAFT_STORE_CREDENTIALS']);
  // A zip needs nothing: it is built and attached, never authenticated
  assert.deepStrictEqual(FORMATS.extension.chrome.zip.requires, []);
});

test('the Windows signing keys come FROM the schema\'s own gates, never a second list', () => {
  const nsis = FORMATS.desktop.windows.nsis.requires;
  assert.ok(nsis.includes('WIN_EV_TOKEN_PATH'));
  assert.ok(nsis.includes('AZURE_TENANT_ID'));
  // Every one of them is a key the schema gates on platforms.windows.signing.*
  for (const key of nsis) {
    const entry = ENV_SCHEMA.find((candidate) => candidate.name === key);
    assert.match(entry.requiredWhen, /^platforms\.windows\.signing\./, key);
  }
  // SIGNTOOL_PATH is the runner's own path, gated by nothing, so it is never a ship key
  assert.ok(!nsis.includes('SIGNTOOL_PATH'));
});

test('formatKeys with a config keeps only the keys that config actually owes', () => {
  const selfHosted = { platforms: { windows: { signing: { strategy: 'self-hosted' } } } };
  const cloud = { platforms: { windows: { signing: { strategy: 'cloud', cloud: { provider: 'azure' } } } } };

  assert.deepStrictEqual(
    formatKeys('desktop', 'windows', 'nsis', selfHosted).requires,
    ['WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD'],
  );
  assert.deepStrictEqual(
    formatKeys('desktop', 'windows', 'nsis', cloud).requires,
    ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TRUSTED_SIGNING_ENDPOINT'],
  );
  // No config = the whole declared set, and the listing paths ride along
  assert.equal(formatKeys('desktop', 'windows', 'nsis').requires.length, FORMATS.desktop.windows.nsis.requires.length);
  assert.deepStrictEqual(formatKeys('extension', 'edge', 'store').listing, ['listings.edge.id']);
  // An unconditional key is never filtered away: the store keys carry no gate
  assert.deepStrictEqual(formatKeys('extension', 'firefox', 'store', {}).requires, ['FIREFOX_API_KEY', 'FIREFOX_API_SECRET']);
  assert.deepStrictEqual(formatKeys('desktop', 'linux', 'nope'), { requires: [], listing: [] });
});

// ─── the declaration ─────────────────────────────────────────────────────────

test('no declaration at all ships everything: every platform, every format', () => {
  assert.deepStrictEqual(enabledFormats({}, 'desktop'), [
    { platform: 'mac', format: 'dmg', options: {} },
    { platform: 'windows', format: 'nsis', options: {} },
    { platform: 'linux', format: 'deb', options: {} },
    { platform: 'linux', format: 'appimage', options: {} },
    { platform: 'linux', format: 'snap', options: {} },
  ]);
  assert.equal(enabledFormats({}, 'extension').length, 6);
});

test('presence is the switch: `false` drops a platform or a format, nothing else does', () => {
  const config = {
    platforms: {
      mac: false,
      windows: {},
      linux: { formats: { snap: false } },
    },
  };

  assert.deepStrictEqual(enabledFormats(config, 'desktop'), [
    { platform: 'windows', format: 'nsis', options: {} },
    { platform: 'linux', format: 'deb', options: {} },
    { platform: 'linux', format: 'appimage', options: {} },
  ]);
});

test('a format\'s own settings ride inside it, and declaring one drops nothing', () => {
  const config = { platforms: { mac: false, windows: false, linux: { formats: { snap: { channels: ['beta'] } } } } };

  assert.deepStrictEqual(enabledFormats(config, 'desktop'), [
    { platform: 'linux', format: 'deb', options: {} },
    { platform: 'linux', format: 'appimage', options: {} },
    { platform: 'linux', format: 'snap', options: { channels: ['beta'] } },
  ]);
  assert.deepStrictEqual(
    enabledFormats({ platforms: { chrome: { formats: { store: { channel: 'unlisted' } } }, firefox: false, edge: false } }, 'extension'),
    [
      { platform: 'chrome', format: 'zip', options: {} },
      { platform: 'chrome', format: 'store', options: { channel: 'unlisted' } },
    ],
  );
});

test('a platform or format nobody declared is not invented, and an unknown target ships nothing', () => {
  assert.deepStrictEqual(enabledFormats({ platforms: { ios: {} } }, 'desktop').map((entry) => entry.platform),
    ['mac', 'windows', 'linux', 'linux', 'linux']);
  assert.deepStrictEqual(enabledFormats({ platforms: { linux: { formats: { msi: {} } } } }, 'desktop')
    .filter((entry) => entry.platform === 'linux').map((entry) => entry.format), ['deb', 'appimage', 'snap']);
  assert.deepStrictEqual(enabledFormats({}, 'web'), []);
});

// ─── the artifact names (#620, inherited) ────────────────────────────────────

test('an artifact name carries the platform, the FORMAT and no version', () => {
  assert.equal(desktopArtifactName('Acme App', 'mac', 'dmg'), 'Acme-App-mac-dmg.dmg');
  assert.equal(desktopArtifactName('Acme App', 'windows', 'nsis'), 'Acme-App-windows-nsis.exe');
  assert.equal(desktopArtifactName('Acme App', 'linux', 'deb'), 'Acme-App-linux-deb.deb');
  assert.equal(desktopArtifactName('Acme App', 'linux', 'appimage'), 'Acme-App-linux-appimage.AppImage');
  // A store format is never a file, so it has no name to spell
  assert.equal(desktopArtifactName('Acme App', 'linux', 'snap'), '');
});

test('an explicit ext builds an electron-builder TEMPLATE', () => {
  assert.equal(desktopArtifactName('Acme App', 'mac', 'dmg', '${ext}'), 'Acme-App-mac-dmg.${ext}');
});

test('the product name is sanitized for a filename, never blank-guessed', () => {
  assert.equal(sanitizeProductName('Deployment Playground'), 'Deployment-Playground');
  assert.equal(sanitizeProductName('  Acme  //  App '), 'Acme-App');
  assert.equal(sanitizeProductName(''), '');
  assert.equal(desktopArtifactName('', 'mac', 'dmg'), '', 'nothing to name it after, no name');
  assert.equal(desktopArtifactName('Acme App', 'mac', 'nope'), '', 'a format nobody publishes has no name');
  assert.deepStrictEqual(desktopArtifactNames(''), {});
});

test('the product name is the packager\'s: app.productName, else brand.name', () => {
  assert.equal(desktopProductName({ app: { productName: 'Acme Studio' }, brand: { name: 'Acme' } }), 'Acme Studio');
  assert.equal(desktopProductName({ brand: { name: 'Acme' } }), 'Acme');
  assert.equal(desktopProductName({}), '');
  assert.equal(desktopProductName(undefined), '');
});

test('the named artifacts are the ASSET formats only, because the site links files', () => {
  const names = desktopArtifactNames('Acme');
  assert.deepStrictEqual(Object.keys(names), ['mac', 'windows', 'linux']);
  assert.deepStrictEqual(Object.keys(names.linux), ['deb', 'appimage'], 'the snap is the Snap Store\'s, never a release asset');
  assert.deepStrictEqual(Object.keys(names.mac), ['dmg']);
});
