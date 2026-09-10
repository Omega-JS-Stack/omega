/**
 * desktop-artifacts — the ONE versionless naming rule for a desktop release's
 * assets (#620), read by @omega.js/desktop's electron-builder config
 * generation and by the website's direct-download URLs alike.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { DESKTOP_ARTIFACTS, desktopProductName, sanitizeProductName, desktopArtifactName, desktopArtifactNames } = require('../src/index.js');

test('an artifact name carries the platform, the artifact and NO version', () => {
  assert.equal(desktopArtifactName('Acme App', 'mac', 'universal'), 'Acme-App-mac-universal.dmg');
  assert.equal(desktopArtifactName('Acme App', 'windows', 'universal'), 'Acme-App-windows-universal.exe');
  assert.equal(desktopArtifactName('Acme App', 'linux', 'debian'), 'Acme-App-linux-debian.deb');
  assert.equal(desktopArtifactName('Acme App', 'linux', 'appimage'), 'Acme-App-linux-appimage.AppImage');
});

test('an explicit ext builds an electron-builder TEMPLATE for the targets that share a fallback', () => {
  // mac's dmg and its auto-update zip both ride mac.artifactName.
  assert.equal(desktopArtifactName('Acme App', 'mac', 'universal', '${ext}'), 'Acme-App-mac-universal.${ext}');
});

test('the product name is sanitized for a filename, never blank-guessed', () => {
  assert.equal(sanitizeProductName('Deployment Playground'), 'Deployment-Playground');
  assert.equal(sanitizeProductName('  Acme  //  App '), 'Acme-App');
  assert.equal(sanitizeProductName(''), '');
  assert.equal(desktopArtifactName('', 'mac', 'universal'), '', 'nothing to name it after, no name');
  assert.equal(desktopArtifactName('Acme App', 'mac', 'nope'), '', 'an artifact nobody publishes has no name');
  assert.deepStrictEqual(desktopArtifactNames(''), {});
});

test('the product name is the packager\'s: app.productName, else brand.name', () => {
  assert.equal(desktopProductName({ app: { productName: 'Acme Studio' }, brand: { name: 'Acme' } }), 'Acme Studio');
  assert.equal(desktopProductName({ brand: { name: 'Acme' } }), 'Acme');
  assert.equal(desktopProductName({}), '');
  assert.equal(desktopProductName(undefined), '');
});

test('the catalog is the website\'s own vocabulary, in offer order', () => {
  // The keys ARE /download/<platform>/<artifact>, and the FIRST artifact is
  // what the bare /download/<platform> leads with.
  assert.deepStrictEqual(Object.keys(DESKTOP_ARTIFACTS), ['mac', 'windows', 'linux']);
  assert.deepStrictEqual(Object.keys(DESKTOP_ARTIFACTS.linux), ['debian', 'appimage']);
  assert.deepStrictEqual(Object.keys(desktopArtifactNames('Acme').linux), ['debian', 'appimage']);
});
