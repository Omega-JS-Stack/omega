/**
 * The manager's readers of the brand secrets folder resolve the devkit paths
 * ([#897](https://github.com/Omega-JS-Stack/omega/issues/897)).
 *
 * `SERVICE_ACCOUNT_REL` and `GOOGLE_OAUTH_REL` live in
 * @omega.js/devkit/service-account, and every manager module that touches
 * those two files imports them. These cases prove it where it is observable:
 * the migrations service reads the key from the path the constant names, and
 * the legacy OAuth conversion writes its output there. Devkit's own
 * service-account.test.js holds the rest of the class shut by reading every
 * package's source.
 *
 * Offline by construction: both brands are temp dirs and no client is ever
 * built (the key is deliberately unreadable, which is what proves it was the
 * file the service opened).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { SERVICE_ACCOUNT_REL, GOOGLE_OAUTH_REL } = require('@omega.js/devkit/service-account');
const { OPERATIONS } = require('../src/config.js');
const { convertLegacyOAuthSecret } = require('../src/lib/legacy-oauth.js');
const migrations = require('../src/services/migrations/index.js');

const brandConfig = {
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { backend: { type: 'backend' } },
  cloud: { shared: false },
};

function stageBrand() {
  return mkdtempSync(join(tmpdir(), 'omega-secrets-paths-'));
}

function runMigrations(brandRoot) {
  return migrations.run({
    brandId: 'fixture-brand',
    brandRoot,
    brandConfig,
    operations: OPERATIONS.migrations,
    options: { migration: 'notifications' },
    serviceData: {},
  });
}

test('secrets paths: the migrations service names the devkit key path when none is minted', async () => {
  const result = await runMigrations(stageBrand());

  assert.equal(result.status, 'skipped');
  assert.ok(result.reason.includes(SERVICE_ACCOUNT_REL), `the skip reason names ${SERVICE_ACCOUNT_REL}: ${result.reason}`);
});

test('secrets paths: the migrations service reads the key from the devkit path', async () => {
  const brandRoot = stageBrand();
  // Unreadable on purpose: the service gets past the exists() check and dies
  // naming the file it opened, which is the whole assertion.
  jetpack.write(join(brandRoot, SERVICE_ACCOUNT_REL), 'not json');

  await assert.rejects(runMigrations(brandRoot), (error) => {
    assert.ok(error.message.includes(join(brandRoot, SERVICE_ACCOUNT_REL)), error.message);
    return true;
  });
});

test('secrets paths: the legacy OAuth conversion writes the devkit oauth path', () => {
  const brandRoot = stageBrand();
  jetpack.write(join(brandRoot, '.omega', 'secrets', 'oauth.json'), {
    googleClientId: 'client-id',
    googleClientSecret: 'client-secret',
  });

  assert.deepEqual(convertLegacyOAuthSecret(brandRoot), { converted: true });
  assert.deepEqual(jetpack.read(join(brandRoot, GOOGLE_OAUTH_REL), 'json'), {
    clientId: 'client-id',
    clientSecret: 'client-secret',
  });
});
