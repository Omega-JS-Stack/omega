/**
 * ship-plan tests ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)):
 * the one derivation every publish lane and the manage walk read. What a
 * brand's declaration ships, what each format still owes, and the ONE wording
 * a missing ship credential or a missing listing id is reported in.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { shipPlan, missingShipKeys, shipKeyRefusal, listingManualStep } = require('../src/ship-plan.js');

test('ship-plan: an undeclared extension ships every format, each carrying its own requirements', () => {
  const plan = shipPlan({}, 'extension');

  assert.deepEqual(
    plan.map((entry) => `${entry.platform}/${entry.format}`),
    ['chrome/zip', 'chrome/store', 'firefox/zip', 'firefox/store', 'edge/zip', 'edge/store'],
  );

  const chromeStore = plan.find((entry) => entry.platform === 'chrome' && entry.format === 'store');
  assert.equal(chromeStore.kind, 'store');
  assert.deepEqual(chromeStore.requires, ['CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN']);
  assert.deepEqual(chromeStore.listing, ['listings.chrome.id']);
  assert.equal(chromeStore.path, 'platforms.chrome.formats.store');
  assert.equal(chromeStore.label, 'Chrome Web Store');
  assert.match(chromeStore.console, /^https:\/\//);

  // The firefox listing is never asked for: AMO takes the manifest's gecko id,
  // and the publish that creates the listing writes it back (#893)
  assert.deepEqual(plan.find((entry) => entry.platform === 'firefox' && entry.format === 'store').listing, []);
});

test('ship-plan: a dropped format leaves the plan, and a declared one keeps its options', () => {
  const plan = shipPlan({ platforms: { edge: false, chrome: { formats: { store: false } }, firefox: { formats: { store: { channel: 'unlisted' } } } } }, 'extension');

  assert.deepEqual(
    plan.map((entry) => `${entry.platform}/${entry.format}`),
    ['chrome/zip', 'firefox/zip', 'firefox/store'],
  );
  assert.deepEqual(plan.find((entry) => entry.format === 'store').options, { channel: 'unlisted' });
});

test('ship-plan: the desktop snap owes its store credential only where the brand DECLARES it', () => {
  // Undeclared: the snap is on by default, but nothing in the config makes
  // `SNAPCRAFT_STORE_CREDENTIALS` mandatory (the schema gates it on the
  // declaration), so a desktop brand that never mentions the snap owes nothing
  const bare = shipPlan({}, 'desktop').find((entry) => entry.format === 'snap');
  assert.deepEqual(bare.requires, []);

  const declared = shipPlan({ platforms: { linux: { formats: { snap: { channels: ['edge'] } } } } }, 'desktop')
    .find((entry) => entry.format === 'snap');
  assert.deepEqual(declared.requires, ['SNAPCRAFT_STORE_CREDENTIALS']);
  assert.equal(declared.kind, 'store');
});

test('ship-plan: the windows signing set narrows to the CONFIGURED strategy', () => {
  const selfHosted = shipPlan({ platforms: { windows: { signing: { strategy: 'self-hosted' } } } }, 'desktop')
    .find((entry) => entry.format === 'nsis');
  assert.deepEqual(selfHosted.requires, ['WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD']);

  const cloud = shipPlan({ platforms: { windows: { signing: { strategy: 'cloud', cloud: { provider: 'azure' } } } } }, 'desktop')
    .find((entry) => entry.format === 'nsis');
  assert.deepEqual(cloud.requires, ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TRUSTED_SIGNING_ENDPOINT']);

  // No strategy declared = no signing set owed at all
  assert.deepEqual(shipPlan({}, 'desktop').find((entry) => entry.format === 'nsis').requires, []);
});

test('ship-plan: missingShipKeys names every empty key with the declaration that requires it', () => {
  const plan = shipPlan({}, 'extension');
  const missing = missingShipKeys(plan, { CHROME_CLIENT_ID: 'id', CHROME_CLIENT_SECRET: 'secret', CHROME_REFRESH_TOKEN: 'token', FIREFOX_API_KEY: 'key', FIREFOX_API_SECRET: 'secret' });

  assert.deepEqual(missing, [
    { key: 'EDGE_CLIENT_ID', path: 'platforms.edge.formats.store', label: 'Microsoft Edge Add-ons' },
    { key: 'EDGE_API_KEY', path: 'platforms.edge.formats.store', label: 'Microsoft Edge Add-ons' },
  ]);

  // An empty string is absent, the same rule the .env cascade applies
  assert.equal(missingShipKeys(plan, { CHROME_CLIENT_ID: '' }).some((entry) => entry.key === 'CHROME_CLIENT_ID'), true);
});

test('ship-plan: the refusal names each key, its declaration, and the ONE walk that collects it', () => {
  const message = shipKeyRefusal([{ key: 'EDGE_API_KEY', path: 'platforms.edge.formats.store', label: 'Microsoft Edge Add-ons' }]);

  assert.match(message, /1 ship credential/);
  assert.match(message, /EDGE_API_KEY \(required by platforms\.edge\.formats\.store\)/);
  assert.match(message, /omega manage --service publishing/);
});

test('ship-plan: the manual step says create, upload, paste the config path, re-run', () => {
  const line = listingManualStep({
    label: 'Chrome Web Store',
    console: 'https://chrome.google.com/webstore/devconsole',
    path: 'targets.extension.listings.chrome.id',
    asset: 'extension-chrome.zip',
  });

  assert.match(line, /Chrome Web Store/);
  assert.match(line, /https:\/\/chrome\.google\.com\/webstore\/devconsole/);
  assert.match(line, /extension-chrome\.zip/);
  assert.match(line, /targets\.extension\.listings\.chrome\.id/);
  assert.match(line, /re-run/);

  // The walk has no asset to point at, so it prints the same line without one
  assert.doesNotMatch(listingManualStep({ label: 'Chrome Web Store', console: 'https://x.test', path: 'targets.extension.listings.chrome.id' }), /upload/);
});
