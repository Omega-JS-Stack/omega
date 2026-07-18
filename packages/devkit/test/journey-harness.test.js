/**
 * Unit pins for the journey harness's pure helpers (cp195). The full
 * runJourney() is the root `test:journey` lane itself — a real
 * outside-monorepo brand birth — and is exercised there, not here.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scrubCredentialEnv, latestRunFile, discoverBrandApps } = require('../src/test/journey-harness.js');

test('scrubCredentialEnv drops credential-shaped vars, keeps operating env', () => {
  const scrubbed = scrubCredentialEnv({
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    NODE_ENV: 'test',
    npm_config_cache: '/tmp/npm',
    OMEGA_MONOREPO: '/repo',
    OMEGA_NON_INTERACTIVE: '1',
    // Every one of these must go — the runtime legs prove themselves credless
    GOOGLE_CLIENT_ID: 'x',
    GOOGLE_CLIENT_SECRET: 'x',
    GOOGLE_APPLICATION_CREDENTIALS: '/adc.json',
    CLOUDFLARE_TOKEN: 'x',
    GH_TOKEN: 'x',
    GITHUB_TOKEN: 'x',
    SENDGRID_API_KEY: 'x',
    APPLE_API_KEY: 'x',
    STRIPE_SECRET_KEY: 'x',
    OMEGA_ADMIN_KEY: 'x',
    SENTRY_AUTH_TOKEN: 'x',
    DB_PASSWORD: 'x',
  });

  assert.deepEqual(Object.keys(scrubbed).sort(), [
    'HOME', 'NODE_ENV', 'OMEGA_MONOREPO', 'OMEGA_NON_INTERACTIVE', 'PATH', 'npm_config_cache',
  ]);
  assert.equal(scrubbed.PATH, '/usr/bin');
});

test('latestRunFile picks the newest .omega/runs entry; null without one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-unit-'));
  assert.equal(latestRunFile(root), null);

  const runsDir = path.join(root, '.omega', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  assert.equal(latestRunFile(root), null); // empty dir

  fs.writeFileSync(path.join(runsDir, '2026-07-17T01-00-00.json'), '{}');
  fs.writeFileSync(path.join(runsDir, '2026-07-17T02-30-00.json'), '{}');
  fs.writeFileSync(path.join(runsDir, 'notes.txt'), 'ignored');
  assert.equal(latestRunFile(root), path.join(runsDir, '2026-07-17T02-30-00.json'));

  fs.rmSync(root, { recursive: true, force: true });
});

test('discoverBrandApps returns package.json-bearing apps in journey order', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-unit-'));
  assert.deepEqual(discoverBrandApps(root), []); // no apps/ at all

  for (const name of ['extension', 'backend', 'website', 'desktop', 'website-docs']) {
    fs.mkdirSync(path.join(root, 'apps', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps', name, 'package.json'), '{}');
  }
  fs.mkdirSync(path.join(root, 'apps', 'no-manifest')); // skipped: no package.json

  assert.deepEqual(
    discoverBrandApps(root).map((dir) => path.basename(dir)),
    ['website', 'backend', 'desktop', 'extension', 'website-docs'],
  );

  fs.rmSync(root, { recursive: true, force: true });
});
