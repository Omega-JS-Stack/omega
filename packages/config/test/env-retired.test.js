/**
 * Unit tests for @omega.js/config's env-retired module: the .env half of the
 * retired-key register ([#893](https://github.com/Omega-JS-Stack/omega/issues/893)).
 *
 * Six public identifiers moved from `.env` into config/omega.json5. There is
 * no dual-read anywhere in OMEGA, so a stale `.env` line is a value nothing
 * reads: the layer that carries one fails loudly, naming the config path it
 * moved to, rather than letting a brand publish with an id nobody consults.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { RETIRED_ENV_KEYS, findRetiredEnvKeys, assertNoRetiredEnvKeys, loadEnvChain } = require('../src/index.js');

test('every retired key names its replacement and why', () => {
  const names = Object.keys(RETIRED_ENV_KEYS);

  assert.deepStrictEqual(names.sort(), [
    'CHARGEBEE_SITE',
    'CHROME_EXTENSION_ID',
    'EDGE_PRODUCT_ID',
    'FIREFOX_EXTENSION_ID',
    'OAUTH2_GOOGLE_CLIENT_ID',
    'OAUTH2_GOOGLE_CLIENT_SECRET',
    'OMEGA_TEST_FIREBASE_ADMIN_KEY',
    'OMEGA_TEST_USER_UID',
    'PAYPAL_CLIENT_ID',
    'RECAPTCHA_SITE_KEY',
  ]);

  for (const [name, row] of Object.entries(RETIRED_ENV_KEYS)) {
    assert.match(name, /^[A-Z][A-Z0-9_]*$/, `${name}: env names are SCREAMING_SNAKE_CASE`);
    assert.equal(typeof row.why, 'string', `${name}: says why it moved`);
    assert.ok(row.why.length > 0, `${name}: the reason is not empty`);

    // `null` is the third shape (#819): a key retired outright, with no config
    // path and no new env name, because a MECHANISM replaced it. Every other
    // row still owes the name of the place its value went.
    if (row.replacement === null) continue;

    assert.equal(typeof row.replacement, 'string', `${name}: names its config path`);
    assert.ok(row.replacement.length > 0, `${name}: the replacement path is not empty`);
    if (row.home === 'env') assert.match(row.replacement, /^[A-Z][A-Z0-9_]*$/, `${name}: an env-side rename names an env key`);
  }
});

test('an env-side rename names the new ENV key, not a config path (#845)', () => {
  // #788 renamed the oauth2 feature to connections: the pair did not move into
  // config, it changed name inside .env, so the row says `home: 'env'` and the
  // refusal tells a brand to rename the line rather than delete it.
  for (const name of ['OAUTH2_GOOGLE_CLIENT_ID', 'OAUTH2_GOOGLE_CLIENT_SECRET']) {
    const row = RETIRED_ENV_KEYS[name];

    assert.equal(row.home, 'env', `${name}: its replacement lives in .env`);
    assert.equal(row.replacement, name.replace(/^OAUTH2_/, 'CONNECTIONS_'), `${name}: the prefix is the whole rename`);
  }

  assert.throws(
    () => assertNoRetiredEnvKeys({ OAUTH2_GOOGLE_CLIENT_SECRET: 'x' }, '/brands/acme/targets/backend/.env'),
    (error) => {
      assert.ok(error.message.includes('/brands/acme/targets/backend/.env'), 'names the layer that carries it');
      assert.ok(error.message.includes('OAUTH2_GOOGLE_CLIENT_SECRET renamed to CONNECTIONS_GOOGLE_CLIENT_SECRET'), 'spells the rename');
      assert.ok(error.message.includes('rename the .env line'), 'says what to do with the old line');
      assert.ok(!error.message.includes('config/omega.json5'), 'the value never moved into config');
      return true;
    },
  );
});

test('a key retired OUTRIGHT is a deletion with nowhere to move the value (#819)', () => {
  // The test-lane pair is gone for good: web, desktop and extension each sign
  // in as a persona the backend emulator seeds (#904), so the refusal must not
  // send a brand looking for a config path or a renamed key that never existed.
  assert.throws(
    () => assertNoRetiredEnvKeys({ OMEGA_TEST_USER_UID: 'desktop-test-user' }, '/brands/acme/.env'),
    (error) => {
      assert.ok(error.message.includes('/brands/acme/.env'), 'names the layer that carries it');
      assert.ok(error.message.includes('OMEGA_TEST_USER_UID is retired outright'), 'says the key is gone, not moved');
      assert.ok(error.message.includes('delete the .env line'), 'says what to do with the old line');
      assert.ok(error.message.includes('#904'), 'names the mechanism that replaced it');
      assert.ok(!error.message.includes('config/omega.json5'), 'the value never moved into config');
      assert.ok(!error.message.includes('renamed to'), 'and it never became another env key');
      return true;
    },
  );
});

test('findRetiredEnvKeys reports only the keys a layer actually carries', () => {
  const found = findRetiredEnvKeys({ GH_TOKEN: 'x', EDGE_PRODUCT_ID: '111', CHARGEBEE_SITE: 'acme' });

  assert.deepStrictEqual(found.map((row) => row.key), ['EDGE_PRODUCT_ID', 'CHARGEBEE_SITE']);
  assert.equal(found[0].replacement, 'targets.<name>.listings.edge.id');

  assert.deepStrictEqual(findRetiredEnvKeys({ GH_TOKEN: 'x' }), [], 'a clean layer reports nothing');
  assert.deepStrictEqual(findRetiredEnvKeys({}), []);
});

test('a declared-but-empty line is still a retired line (the move is what is owed)', () => {
  // `KEY=` means "documented here, valued elsewhere" for a LIVE key. For a
  // retired one it documents a key nothing reads, so it is deleted like any other.
  assert.deepStrictEqual(findRetiredEnvKeys({ RECAPTCHA_SITE_KEY: '' }).map((row) => row.key), ['RECAPTCHA_SITE_KEY']);
});

test('assertNoRetiredEnvKeys spells the move out and names the file', () => {
  assert.throws(
    () => assertNoRetiredEnvKeys({ CHROME_EXTENSION_ID: 'abc' }, '/brands/acme/.env'),
    (error) => {
      assert.ok(error.message.includes('/brands/acme/.env'), 'names the layer that carries it');
      assert.ok(error.message.includes('CHROME_EXTENSION_ID moved to targets.<name>.listings.chrome.id'), 'spells the move');
      assert.ok(error.message.includes('config/omega.json5'), 'names the file the value belongs in');
      assert.ok(error.message.includes('delete the .env line'), 'says what to do with the old line');
      return true;
    },
  );

  assert.doesNotThrow(() => assertNoRetiredEnvKeys({ GH_TOKEN: 'x' }, '/brands/acme/.env'));
});

test('a .env LAYER carrying a retired key fails the load (#893)', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-env-retired-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const envPath = path.join(root, '.env');
  fs.writeFileSync(envPath, 'GH_TOKEN="brand-gh"\nEDGE_PRODUCT_ID="11111111-2222-3333-4444-555555555555"\n');

  assert.throws(() => loadEnvChain([envPath]), /EDGE_PRODUCT_ID moved to targets\.<name>\.listings\.edge\.id/);
  assert.equal(process.env.EDGE_PRODUCT_ID, undefined, 'nothing from a refused layer reaches the process');
});
