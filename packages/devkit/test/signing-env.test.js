/**
 * signing-env tests: the ONE derivation of CSC_LINK and APPLE_API_KEY
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)).
 *
 * Real material only: openssl makes the key, the certificate and a real `.p12`
 * export, so the password gate is the actual container check the build runs,
 * not a stub of it. The cases are the four rungs the desktop signing lookup
 * always had (explicit env wins, company tree, brand tree, nothing set) plus
 * the two ways a file can be there and unusable.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const jetpack = require('fs-jetpack');

const { deriveSigningEnv, signingPathCandidates, CERT_REL } = require('../src/signing-env.js');
const { certsSourceDir } = require('../src/signing-tree.js');

const PASSWORD = 'fixture-password';
const KEY_ID = 'FIXKEY1234';

// ─── Real openssl material: a key, a self-signed cert, and a real .p12 ──────
const FIXTURE_DIR = fs.mkdtempSync(path.join(tmpdir(), 'omega-signing-env-'));
execSync(
  `openssl req -x509 -nodes -newkey rsa:2048 -keyout "${FIXTURE_DIR}/private.key" -out "${FIXTURE_DIR}/cert.pem" -days 365 -subj "/CN=Fixture/C=US"`,
  { stdio: 'pipe' },
);
execSync(
  `openssl pkcs12 -export -legacy -inkey "${FIXTURE_DIR}/private.key" -in "${FIXTURE_DIR}/cert.pem" -out "${FIXTURE_DIR}/fixture.p12" -passout pass:${PASSWORD}`,
  { stdio: 'pipe' },
);
const P12 = jetpack.read(path.join(FIXTURE_DIR, 'fixture.p12'), 'buffer');

process.on('exit', () => fs.rmSync(FIXTURE_DIR, { recursive: true, force: true }));

/**
 * A brand monorepo on disk: `<root>/config/omega.json5` (findBrandRoot needs
 * it) and a desktop target under `targets/`. `company` stages a SECOND brand
 * whose `company/` tree this one inherits, registered in a temp machine home so
 * the resolver can find it.
 */
function stage(t, { company = false, config = {} } = {}) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'omega-brand-'));
  const home = fs.mkdtempSync(path.join(tmpdir(), 'omega-home-'));

  const priorHome = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = home;

  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    if (priorHome === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = priorHome;
  });

  const brandConfig = { brand: { id: 'fixture-brand' }, ...config };
  jetpack.write(path.join(root, 'config', 'omega.json5'), JSON.stringify(brandConfig));

  const targetDir = path.join(root, 'targets', 'desktop');
  jetpack.dir(targetDir);

  let companyTree = null;
  if (company) {
    const parentRoot = path.join(root, '..', `parent-${path.basename(root)}`);
    t.after(() => fs.rmSync(parentRoot, { recursive: true, force: true }));

    jetpack.write(path.join(parentRoot, 'config', 'omega.json5'), JSON.stringify({ brand: { id: 'parent-brand' } }));
    jetpack.dir(path.join(parentRoot, 'company'));

    // The machine registry is how a sibling's `company: { id }` resolves.
    jetpack.write(path.join(home, 'brands.json'), JSON.stringify({
      'parent-brand': { root: parentRoot, name: 'Parent', url: 'https://parent.test' },
    }));

    jetpack.write(path.join(root, 'config', 'omega.json5'), JSON.stringify({
      ...brandConfig,
      company: { id: 'parent-brand' },
    }));

    companyTree = certsSourceDir(path.join(parentRoot, 'company'));
  }

  return { root, targetDir, brandTree: certsSourceDir(root), companyTree };
}

test('signing-env: derives CSC_LINK from the BRAND tree when the password opens it', (t) => {
  const { targetDir, brandTree } = stage(t);
  jetpack.write(path.join(brandTree, CERT_REL), P12);

  const env = { CSC_KEY_PASSWORD: PASSWORD };
  const { derived, problems } = deriveSigningEnv({ env, targetDir });

  assert.deepEqual(problems, []);
  assert.deepEqual(derived, [{ key: 'CSC_LINK', value: path.join(brandTree, CERT_REL) }]);
  assert.equal(env.CSC_LINK, path.join(brandTree, CERT_REL));
  assert.ok(path.isAbsolute(env.CSC_LINK), 'the derived path is absolute');
});

test('signing-env: the COMPANY tree wins over the brand tree', (t) => {
  const { targetDir, brandTree, companyTree } = stage(t, { company: true });
  jetpack.write(path.join(brandTree, CERT_REL), P12);
  jetpack.write(path.join(companyTree, CERT_REL), P12);

  const env = { CSC_KEY_PASSWORD: PASSWORD };
  deriveSigningEnv({ env, targetDir });

  assert.equal(env.CSC_LINK, path.join(companyTree, CERT_REL));
});

test('signing-env: an explicit CSC_LINK always wins and is never overwritten', (t) => {
  const { targetDir, brandTree } = stage(t);
  jetpack.write(path.join(brandTree, CERT_REL), P12);

  const env = { CSC_LINK: 'config/certs/mine.p12', CSC_KEY_PASSWORD: PASSWORD };
  const { derived } = deriveSigningEnv({ env, targetDir });

  assert.deepEqual(derived, []);
  assert.equal(env.CSC_LINK, 'config/certs/mine.p12');
});

test('signing-env: a .p12 the password does not open is a PROBLEM, and the key stays unset', (t) => {
  const { targetDir, brandTree } = stage(t);
  jetpack.write(path.join(brandTree, CERT_REL), P12);

  const env = { CSC_KEY_PASSWORD: 'the-wrong-password' };
  const { derived, problems } = deriveSigningEnv({ env, targetDir });

  assert.deepEqual(derived, []);
  assert.equal(env.CSC_LINK, undefined, 'Keychain discovery stays the default');
  assert.equal(problems.length, 1);
  assert.equal(problems[0].key, 'CSC_LINK');
  assert.match(problems[0].reason, /CSC_KEY_PASSWORD does not open/);
});

test('signing-env: a .p12 with no CSC_KEY_PASSWORD at all is a PROBLEM, not a silent skip', (t) => {
  const { targetDir, brandTree } = stage(t);
  jetpack.write(path.join(brandTree, CERT_REL), P12);

  const { derived, problems } = deriveSigningEnv({ env: {}, targetDir });

  assert.deepEqual(derived, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0].reason, /CSC_KEY_PASSWORD is unset/);
});

test('signing-env: no tree at all derives nothing and reports nothing', (t) => {
  const { targetDir } = stage(t);

  assert.deepEqual(deriveSigningEnv({ env: { CSC_KEY_PASSWORD: PASSWORD }, targetDir }), { derived: [], problems: [] });
});

test('signing-env: APPLE_API_KEY is derived from AuthKey_<id>.p8, and an unset id skips the key', (t) => {
  const { targetDir, brandTree } = stage(t);
  jetpack.write(path.join(brandTree, `AuthKey_${KEY_ID}.p8`), 'authkey-bytes');

  const withoutId = {};
  assert.deepEqual(deriveSigningEnv({ env: withoutId, targetDir }).derived, []);
  assert.equal(withoutId.APPLE_API_KEY, undefined, 'no id means no filename to look for');

  const env = { APPLE_API_KEY_ID: KEY_ID };
  const { derived } = deriveSigningEnv({ env, targetDir });

  assert.deepEqual(derived, [{ key: 'APPLE_API_KEY', value: path.join(brandTree, `AuthKey_${KEY_ID}.p8`) }]);
});

test('signing-env: a target outside a brand derives nothing', (t) => {
  const outside = fs.mkdtempSync(path.join(tmpdir(), 'omega-loose-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));

  assert.deepEqual(deriveSigningEnv({ env: { CSC_KEY_PASSWORD: PASSWORD }, targetDir: outside }), { derived: [], problems: [] });
  assert.deepEqual(signingPathCandidates({ env: {}, targetDir: outside }), []);
});

test('signing-env: the candidate paths name both tiers, company first', (t) => {
  const { targetDir, brandTree, companyTree } = stage(t, { company: true });

  const candidates = signingPathCandidates({ env: { APPLE_API_KEY_ID: KEY_ID }, targetDir });

  assert.deepEqual(candidates.map((entry) => entry.key), ['CSC_LINK', 'APPLE_API_KEY']);
  assert.deepEqual(candidates[0].paths, [path.join(companyTree, CERT_REL), path.join(brandTree, CERT_REL)]);
  assert.deepEqual(candidates[1].paths, [
    path.join(companyTree, `AuthKey_${KEY_ID}.p8`),
    path.join(brandTree, `AuthKey_${KEY_ID}.p8`),
  ]);
});
