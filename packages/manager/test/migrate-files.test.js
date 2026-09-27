/**
 * Brand-root `omega migrate` over EVERY authored file the loader reads: the
 * brand's omega.json5 and its environment overlays, each target's own omega
 * files, and every `.env` the cascade reads (the brand root's and each
 * target's), one report block per file. Nothing outside the brand is touched.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');

const { write, stageBrand, runMigrate, block } = require('./lib/migrate-harness.js');
const { renameEnvKey } = require('../src/migrate/env-pass.js');

const BASE = `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: { type: 'web' } },
}
`;

// A web target whose framework leg has nothing to do, so the config and .env
// blocks are the whole story
function stageWithWebTarget() {
  const brand = stageBrand(BASE);
  write(path.join(brand, 'targets', 'web', 'package.json'), { name: 'web', private: true, dependencies: { '@omega.js/web': '*' } });
  const framework = path.join(brand, 'node_modules', '@omega.js', 'web');
  write(path.join(framework, 'package.json'), { name: '@omega.js/web', exports: { './migrate': './migrate.js' } });
  write(path.join(framework, 'migrate.js'), 'module.exports = { migrateTarget: () => ({ due: [], changed: [], errors: [] }) };\n');
  return brand;
}

test('migrate: an overlay and a target\'s own file are judged like the base, one block each', async () => {
  const brand = stageWithWebTarget();
  const overlay = path.join(brand, 'config', 'omega.production.json5');
  const local = path.join(brand, 'targets', 'web', 'config', 'omega.json5');
  write(overlay, "{\n  // production only\n  translation: { exclude: ['docs'] },\n}\n");
  write(local, "{\n  meta: { index: false },\n  bogus: { flavor: 'house' },\n}\n");

  const report = await runMigrate(brand);
  assert.match(block(report.text, 'config/omega.production.json5'), /due\s+move translation\.exclude → translation\.include/, report.text);
  const target = block(report.text, 'targets/web/config/omega.json5');
  assert.match(target, /due\s+config\.bogus\.flavor is not a key the schema declares; remove it by hand/, report.text);
  assert.doesNotMatch(target, /meta\.index/, 'a target\'s own file is judged as that target\'s layer');
  assert.match(block(report.text, 'config/omega.json5'), /no retired keys/);
  assert.equal(report.code, 1);

  const converted = await runMigrate(brand, { execute: true });
  assert.deepEqual(JSON5.parse(fs.readFileSync(overlay, 'utf8')).translation, { include: ['**', '!docs'] }, 'the overlay converted in place');
  assert.ok(fs.readFileSync(overlay, 'utf8').includes('// production only'), 'its comments survive');
  assert.match(block(converted.text, 'targets/web/config/omega.json5'), /due\s+config\.bogus\.flavor/, 'the by-hand residue is still owed');
  assert.equal(converted.code, 1);
});

test('migrate: each target\'s .env is its own block, and a .env outside the brand is never read or written', async () => {
  const brand = stageWithWebTarget();
  const targetEnv = path.join(brand, 'targets', 'web', '.env');
  const outside = path.join(brand, '..', '.env');
  const stray = path.join(brand, 'tools', '.env');
  const retired = 'OAUTH2_GOOGLE_CLIENT_ID="value-marker-target"\n';
  write(targetEnv, retired);
  write(outside, 'OAUTH2_GOOGLE_CLIENT_SECRET="value-marker-outside"\n');
  write(stray, 'OAUTH2_GOOGLE_CLIENT_SECRET="value-marker-stray"\n');

  const report = await runMigrate(brand);
  assert.match(block(report.text, 'targets/web/.env'), /due\s+rename OAUTH2_GOOGLE_CLIENT_ID → CONNECTIONS_GOOGLE_CLIENT_ID/, report.text);
  assert.doesNotMatch(report.text, /OAUTH2_GOOGLE_CLIENT_SECRET/, 'no file outside the brand root and its targets is read');
  assert.doesNotMatch(report.text, /value-marker/, 'a value never reaches the report');

  await runMigrate(brand, { execute: true });
  assert.equal(fs.readFileSync(targetEnv, 'utf8'), retired.replace('OAUTH2_GOOGLE_CLIENT_ID=', 'CONNECTIONS_GOOGLE_CLIENT_ID='));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'OAUTH2_GOOGLE_CLIENT_SECRET="value-marker-outside"\n', 'outside the brand: never written');
  assert.equal(fs.readFileSync(stray, 'utf8'), 'OAUTH2_GOOGLE_CLIENT_SECRET="value-marker-stray"\n', 'a folder no target owns: never written');
});

test('migrate --execute: the `KEY: value` spelling dotenv also reads is renamed too', async () => {
  const brand = stageBrand(BASE);
  const env = path.join(brand, '.env');
  write(env, 'OAUTH2_GOOGLE_CLIENT_ID: value-marker-colon\nexport OAUTH2_GOOGLE_CLIENT_SECRET=value-marker-export\n');

  const { text, code } = await runMigrate(brand, { execute: true });

  assert.equal(fs.readFileSync(env, 'utf8'), 'CONNECTIONS_GOOGLE_CLIENT_ID: value-marker-colon\nexport CONNECTIONS_GOOGLE_CLIENT_SECRET=value-marker-export\n');
  assert.match(block(text, '.env'), /changed\s+renamed OAUTH2_GOOGLE_CLIENT_ID → CONNECTIONS_GOOGLE_CLIENT_ID in place/);
  assert.equal(code, undefined, text);
});

// The pass refuses whenever the rename changed nothing, so "renamed in place"
// is never printed over an untouched file: the helper's no-op is that signal.
test('renameEnvKey leaves a file with no assignment of the key byte-identical', () => {
  const source = '# OAUTH2_GOOGLE_CLIENT_ID=commented out\nGH_TOKEN="x"\nNOTE="OAUTH2_GOOGLE_CLIENT_ID=inside a value"\n';

  assert.equal(renameEnvKey(source, 'OAUTH2_GOOGLE_CLIENT_ID', 'CONNECTIONS_GOOGLE_CLIENT_ID'), source);
});
