/**
 * Certs delivery tests — the copy layer the manager's disperse service and a
 * desktop build both call (#678): the full desktop signing set into
 * config/certs/, the byte-compared converged run, the self-protecting
 * .gitignore, the unresolved-placeholder and missing-source misses, the
 * mobile build/certs/ paths, the dry run that writes nothing, and the WARN-ONLY
 * miss that leaves a hand-placed dest alone.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const { deliverCerts, resolveCertRules, certsSourceDir } = require('../src/certs.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

const BRAND = { id: 'fixture-brand', name: 'Fixture Brand' };
const KEY_ID = 'FIXKEY123';

// Full desktop signing set under .omega/certificates/apple/
const APPLE_FIXTURES = {
  'certificates/DEVELOPER_ID_APPLICATION_G2.p12': 'dev-id-application-p12-bytes',
  'certificates/DEVELOPER_ID_INSTALLER_G2.p12': 'dev-id-installer-p12-bytes',
  [`AuthKey_${KEY_ID}.p8`]: 'authkey-p8-bytes',
  [`profiles/${BRAND.id}/DEVELOPER_ID_APPLICATION_G2/MACOS.mobileprovision`]: 'macos-profile-bytes',
};

/** Stage a source root holding .omega/certificates/apple/ plus an empty target dir. */
function stage(t, { apple = APPLE_FIXTURES, keyId = KEY_ID } = {}) {
  const root = path.join(TEMP_ROOT, `certs-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.rmSync(root, { recursive: true, force: true });

  const prior = process.env.APPLE_API_KEY_ID;
  if (keyId === null) delete process.env.APPLE_API_KEY_ID;
  else process.env.APPLE_API_KEY_ID = keyId;

  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (prior === undefined) delete process.env.APPLE_API_KEY_ID;
    else process.env.APPLE_API_KEY_ID = prior;
  });

  for (const [rel, contents] of Object.entries(apple || {})) {
    jetpack.write(path.join(certsSourceDir(root), rel), contents);
  }

  return { sourceRoot: root, targetDir: path.join(root, 'targets', 'desktop') };
}

const at = (targetDir, ...rest) => path.join(targetDir, 'config', 'certs', ...rest);

test('certs: the desktop target receives the full signing set + a self-protecting .gitignore', (t) => {
  const { sourceRoot, targetDir } = stage(t);

  const result = deliverCerts({ sourceRoot, targetDir, target: 'desktop', brand: BRAND });

  assert.equal(result.copied.length, 4);
  assert.deepEqual(result.missing, []);
  assert.ok(result.copied.every((rel) => !path.isAbsolute(rel)), 'result paths are target-relative');
  assert.equal(jetpack.read(at(targetDir, 'developer-id-application.p12')), 'dev-id-application-p12-bytes');
  assert.equal(jetpack.read(at(targetDir, 'developer-id-installer.p12')), 'dev-id-installer-p12-bytes');
  assert.equal(jetpack.read(at(targetDir, `AuthKey_${KEY_ID}.p8`)), 'authkey-p8-bytes');
  assert.equal(jetpack.read(at(targetDir, `${BRAND.id}.provisionprofile`)), 'macos-profile-bytes');
  assert.equal(jetpack.read(at(targetDir, '.gitignore')), '*\n!.gitignore\n');
});

test('certs: a converged second delivery copies nothing', (t) => {
  const { sourceRoot, targetDir } = stage(t);

  deliverCerts({ sourceRoot, targetDir, target: 'desktop', brand: BRAND });
  const before = fs.statSync(at(targetDir, 'developer-id-application.p12')).mtimeMs;
  const result = deliverCerts({ sourceRoot, targetDir, target: 'desktop', brand: BRAND });

  assert.deepEqual(result.copied, []);
  assert.equal(result.current.length, 4);
  assert.equal(fs.statSync(at(targetDir, 'developer-id-application.p12')).mtimeMs, before);
});

test('certs: a source that is not there lands in missing, by target-relative path', (t) => {
  // Only the AuthKey exists — the required .p12 is missing, both optionals too
  const { sourceRoot, targetDir } = stage(t, { apple: { [`AuthKey_${KEY_ID}.p8`]: 'authkey-p8-bytes' } });

  const result = deliverCerts({ sourceRoot, targetDir, target: 'desktop', brand: BRAND });

  assert.deepEqual(result.copied, [`config/certs/AuthKey_${KEY_ID}.p8`]);
  assert.equal(result.missing.length, 3);
  assert.ok(result.missing.includes('config/certs/developer-id-application.p12'));
});

test('certs: an unset env placeholder misses instead of resolving to AuthKey_.p8', (t) => {
  const { sourceRoot, targetDir } = stage(t, {
    apple: { 'certificates/DEVELOPER_ID_APPLICATION_G2.p12': 'dev-id-application-p12-bytes' },
    keyId: null,
  });

  const result = deliverCerts({ sourceRoot, targetDir, target: 'desktop', brand: BRAND });

  assert.deepEqual(result.copied, ['config/certs/developer-id-application.p12']);
  assert.ok(result.missing.includes('config/certs/AuthKey_{env.APPLE_API_KEY_ID}.p8'), `unresolved rule reports its template: ${result.missing.join(', ')}`);
  assert.equal(jetpack.exists(at(targetDir, 'AuthKey_.p8')), false);
});

test('certs: the mobile target uses build/certs/ paths', (t) => {
  const { sourceRoot, targetDir } = stage(t, {
    apple: {
      'certificates/IOS_DISTRIBUTION.p12': 'ios-distribution-p12-bytes',
      [`AuthKey_${KEY_ID}.p8`]: 'authkey-p8-bytes',
      [`profiles/${BRAND.id}/IOS_DISTRIBUTION/IOS.mobileprovision`]: 'ios-profile-bytes',
    },
  });

  const result = deliverCerts({ sourceRoot, targetDir, target: 'mobile', brand: BRAND });

  assert.equal(result.copied.length, 3);
  const mobileCerts = path.join(targetDir, 'build', 'certs');
  assert.equal(jetpack.read(path.join(mobileCerts, 'ios-distribution.p12')), 'ios-distribution-p12-bytes');
  assert.equal(jetpack.read(path.join(mobileCerts, `AuthKey_${KEY_ID}.p8`)), 'authkey-p8-bytes');
  assert.equal(jetpack.read(path.join(mobileCerts, `${BRAND.id}.mobileprovision`)), 'ios-profile-bytes');
});

test('certs: a dry run plans the copies without writing', (t) => {
  const { sourceRoot, targetDir } = stage(t);

  const result = deliverCerts({ sourceRoot, targetDir, target: 'desktop', brand: BRAND, dryRun: true });

  assert.equal(result.copied.length, 4);
  assert.equal(jetpack.exists(path.join(targetDir, 'config')), false, 'a dry run writes nothing');
});

test('certs: a target with no signing rules delivers nothing', (t) => {
  const { sourceRoot, targetDir } = stage(t);

  assert.deepEqual(deliverCerts({ sourceRoot, targetDir, target: 'web', brand: BRAND }), { copied: [], current: [], missing: [] });
});

// ─── Warn-only misses ───────────────────────────────────────────────────────
test('certs: a hand-placed dest survives a signing tree with no source for it', (t) => {
  // What `omega company init` leaves behind: .omega/certificates/apple/ exists
  // and is EMPTY (both callers' absent-tree guards pass), while the operator
  // dropped the .p12 straight into the documented human drop point
  const { sourceRoot, targetDir } = stage(t, { apple: {} });
  jetpack.dir(certsSourceDir(sourceRoot));
  jetpack.write(at(targetDir, 'developer-id-application.p12'), 'hand-placed-p12-bytes');

  const result = deliverCerts({ sourceRoot, targetDir, target: 'desktop', brand: BRAND });

  assert.equal(jetpack.read(at(targetDir, 'developer-id-application.p12')), 'hand-placed-p12-bytes');
  assert.deepEqual(result.copied, []);
  assert.ok(result.missing.includes('config/certs/developer-id-application.p12'));
});

test('resolveCertRules: carries each rule\'s optional flag and its resolved target-relative path', () => {
  const rules = resolveCertRules({ target: 'desktop', brand: BRAND });

  const profile = rules.find((rule) => rule.dest.includes('{brand.id}'));
  assert.equal(profile.optional, true);
  assert.equal(profile.destRel, `config/certs/${BRAND.id}.provisionprofile`);
  const application = rules.find((rule) => rule.dest === 'config/certs/developer-id-application.p12');
  assert.equal(application.optional, false);
});
