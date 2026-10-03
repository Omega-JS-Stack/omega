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
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'signing-env',
  tests: [
    {
      name: 'signing-env: derives CSC_LINK from the BRAND tree when the password opens it',
      run: (ctx) => {
        const { targetDir, brandTree } = stage(ctx);
        jetpack.write(path.join(brandTree, CERT_REL), P12);

        const env = { CSC_KEY_PASSWORD: PASSWORD };
        const { derived, problems } = deriveSigningEnv({ env, targetDir });

        ctx.expect(problems).toEqual([]);
        ctx.expect(derived).toEqual([{ key: 'CSC_LINK', value: path.join(brandTree, CERT_REL) }]);
        ctx.expect(env.CSC_LINK).toBe(path.join(brandTree, CERT_REL));
        ctx.expect(path.isAbsolute(env.CSC_LINK), 'the derived path is absolute').toBeTruthy();
      },
    },

    {
      name: 'signing-env: the COMPANY tree wins over the brand tree',
      run: (ctx) => {
        const { targetDir, brandTree, companyTree } = stage(ctx, { company: true });
        jetpack.write(path.join(brandTree, CERT_REL), P12);
        jetpack.write(path.join(companyTree, CERT_REL), P12);

        const env = { CSC_KEY_PASSWORD: PASSWORD };
        deriveSigningEnv({ env, targetDir });

        ctx.expect(env.CSC_LINK).toBe(path.join(companyTree, CERT_REL));
      },
    },

    {
      name: 'signing-env: an explicit CSC_LINK always wins and is never overwritten',
      run: (ctx) => {
        const { targetDir, brandTree } = stage(ctx);
        jetpack.write(path.join(brandTree, CERT_REL), P12);

        const env = { CSC_LINK: 'config/certs/mine.p12', CSC_KEY_PASSWORD: PASSWORD };
        const { derived } = deriveSigningEnv({ env, targetDir });

        ctx.expect(derived).toEqual([]);
        ctx.expect(env.CSC_LINK).toBe('config/certs/mine.p12');
      },
    },

    {
      name: 'signing-env: a .p12 the password does not open is a PROBLEM, and the key stays unset',
      run: (ctx) => {
        const { targetDir, brandTree } = stage(ctx);
        jetpack.write(path.join(brandTree, CERT_REL), P12);

        const env = { CSC_KEY_PASSWORD: 'the-wrong-password' };
        const { derived, problems } = deriveSigningEnv({ env, targetDir });

        ctx.expect(derived).toEqual([]);
        ctx.expect(env.CSC_LINK, 'Keychain discovery stays the default').toBe(undefined);
        ctx.expect(problems.length).toBe(1);
        ctx.expect(problems[0].key).toBe('CSC_LINK');
        ctx.expect(problems[0].reason).toMatch(/CSC_KEY_PASSWORD does not open/);
      },
    },

    {
      name: 'signing-env: a .p12 with no CSC_KEY_PASSWORD at all is a PROBLEM, not a silent skip',
      run: (ctx) => {
        const { targetDir, brandTree } = stage(ctx);
        jetpack.write(path.join(brandTree, CERT_REL), P12);

        const { derived, problems } = deriveSigningEnv({ env: {}, targetDir });

        ctx.expect(derived).toEqual([]);
        ctx.expect(problems.length).toBe(1);
        ctx.expect(problems[0].reason).toMatch(/CSC_KEY_PASSWORD is unset/);
      },
    },

    {
      name: 'signing-env: no tree at all derives nothing and reports nothing',
      run: (ctx) => {
        const { targetDir } = stage(ctx);

        ctx.expect(deriveSigningEnv({ env: { CSC_KEY_PASSWORD: PASSWORD }, targetDir })).toEqual({ derived: [], problems: [] });
      },
    },

    {
      name: 'signing-env: APPLE_API_KEY is derived from AuthKey_<id>.p8, and an unset id skips the key',
      run: (ctx) => {
        const { targetDir, brandTree } = stage(ctx);
        jetpack.write(path.join(brandTree, `AuthKey_${KEY_ID}.p8`), 'authkey-bytes');

        const withoutId = {};
        ctx.expect(deriveSigningEnv({ env: withoutId, targetDir }).derived).toEqual([]);
        ctx.expect(withoutId.APPLE_API_KEY, 'no id means no filename to look for').toBe(undefined);

        const env = { APPLE_API_KEY_ID: KEY_ID };
        const { derived } = deriveSigningEnv({ env, targetDir });

        ctx.expect(derived).toEqual([{ key: 'APPLE_API_KEY', value: path.join(brandTree, `AuthKey_${KEY_ID}.p8`) }]);
      },
    },

    {
      name: 'signing-env: a target outside a brand derives nothing',
      run: (ctx) => {
        const outside = fs.mkdtempSync(path.join(tmpdir(), 'omega-loose-'));
        ctx.after(() => fs.rmSync(outside, { recursive: true, force: true }));

        ctx.expect(deriveSigningEnv({ env: { CSC_KEY_PASSWORD: PASSWORD }, targetDir: outside })).toEqual({ derived: [], problems: [] });
        ctx.expect(signingPathCandidates({ env: {}, targetDir: outside })).toEqual([]);
      },
    },

    {
      name: 'signing-env: the candidate paths name both tiers, company first',
      run: (ctx) => {
        const { targetDir, brandTree, companyTree } = stage(ctx, { company: true });

        const candidates = signingPathCandidates({ env: { APPLE_API_KEY_ID: KEY_ID }, targetDir });

        ctx.expect(candidates.map((entry) => entry.key)).toEqual(['CSC_LINK', 'APPLE_API_KEY']);
        ctx.expect(candidates[0].paths).toEqual([path.join(companyTree, CERT_REL), path.join(brandTree, CERT_REL)]);
        ctx.expect(candidates[1].paths).toEqual([
          path.join(companyTree, `AuthKey_${KEY_ID}.p8`),
          path.join(brandTree, `AuthKey_${KEY_ID}.p8`),
        ]);
      },
    },
  ],
});
