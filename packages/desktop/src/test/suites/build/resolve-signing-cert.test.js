// resolve-signing-cert tests ([#28](https://github.com/Omega-JS-Stack/omega/issues/28)) —
// the signing lookup ORDER: an explicit CSC_LINK wins, then the brand's
// gitignored .omega/certificates/apple/ tree, then the company's tree (reached
// through the brand's .omega/company.json stamp — a brand is NEVER physically
// inside its company folder), then the Keychain.
//
// The Keychain branch is today's default and MUST stay it: with no cert in the
// tree the resolver hands electron-builder nothing, exactly as before.
//
// The tree branch is only taken when the password actually OPENS the .p12 —
// the adoption flow can pair an adopted legacy .p12 with a freshly generated
// CSC_KEY_PASSWORD, and handing electron-builder an unopenable file is the
// failure this lookup exists to avoid. Real openssl material is generated in a
// temp dir for that check; nothing here is stubbed.

const { execFileSync } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { homedir, tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const resolveSigningCert = require('../../../utils/resolve-signing-cert.js');

const CERT_REL = join('.omega', 'certificates', 'apple', 'certificates', 'DEVELOPER_ID_APPLICATION_G2.p12');
const REAL_PASSWORD = 'fixture-p12-password';

// One real self-signed key/cert exported to a .p12, the same way the manager's
// certificate-manager.js exports one (`pkcs12 -export -legacy`).
let realP12 = null;
function realP12Bytes() {
  if (realP12) {
    return realP12;
  }

  const dir = mkdtempSync(join(tmpdir(), 'omega-signing-material-'));
  execFileSync('openssl', [
    'req', '-x509', '-nodes', '-newkey', 'rsa:2048',
    '-keyout', join(dir, 'private.key'), '-out', join(dir, 'cert.cer'),
    '-days', '2', '-subj', '/CN=Signing Fixture/C=US', '-outform', 'DER',
  ], { stdio: 'pipe' });
  execFileSync('openssl', [
    'pkcs12', '-export', '-legacy',
    '-inkey', join(dir, 'private.key'), '-in', join(dir, 'cert.cer'),
    '-out', join(dir, 'fixture.p12'), '-passout', 'env:OMEGA_P12_PASSWORD',
  ], { stdio: 'pipe', env: { ...process.env, OMEGA_P12_PASSWORD: REAL_PASSWORD } });

  realP12 = jetpack.read(join(dir, 'fixture.p12'), 'buffer');
  return realP12;
}

// A brand root with a desktop app under it, mirroring a real brand monorepo.
// `cert: 'real'` writes an openable .p12; `cert: 'dummy'` writes bytes that are
// not a certificate at all. A brand root ALWAYS carries a `.omega/` — that is
// what identifies it to the walk.
function stageBrand({ cert = null, root = null } = {}) {
  const brandRoot = root || mkdtempSync(join(tmpdir(), 'omega-signing-'));
  const targetRoot = join(brandRoot, 'targets', 'desktop');

  jetpack.dir(targetRoot);
  jetpack.dir(join(brandRoot, '.omega'));
  if (cert === 'real') {
    jetpack.write(join(brandRoot, CERT_REL), realP12Bytes());
  } else if (cert === 'dummy') {
    jetpack.write(join(brandRoot, CERT_REL), 'p12-bytes');
  }

  return { brandRoot, targetRoot };
}

// Stamp a brand as company-managed — the ONE membership rule
// (@omega.js/config's readCompanyRoot / .omega/company.json).
function stampCompany(brandRoot, companyRoot) {
  jetpack.write(join(brandRoot, '.omega', 'company.json'), JSON.stringify({ root: companyRoot }));
}

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'resolve-signing-cert',
  tests: [
    {
      name: 'no cert anywhere → keychain (today\'s default, unchanged)',
      run: (ctx) => {
        const { targetRoot } = stageBrand();

        const resolved = resolveSigningCert({ projectRoot: targetRoot, env: {} });

        ctx.expect(resolved.source).toBe('keychain');
        ctx.expect(resolved.cscLink).toBe(null);
      },
    },
    {
      name: 'an explicit CSC_LINK always wins',
      run: (ctx) => {
        const { targetRoot } = stageBrand({ cert: 'real' });

        const resolved = resolveSigningCert({
          projectRoot: targetRoot,
          env: { CSC_LINK: 'config/certs/developer-id-application.p12', CSC_KEY_PASSWORD: REAL_PASSWORD },
        });

        ctx.expect(resolved.source).toBe('env');
        ctx.expect(resolved.cscLink).toBe('config/certs/developer-id-application.p12');
      },
    },
    {
      name: 'the brand certificates tree is preferred over the keychain',
      run: (ctx) => {
        const { brandRoot, targetRoot } = stageBrand({ cert: 'real' });

        const resolved = resolveSigningCert({ projectRoot: targetRoot, env: { CSC_KEY_PASSWORD: REAL_PASSWORD } });

        ctx.expect(resolved.source).toBe('certificates');
        ctx.expect(resolved.cscLink).toBe(join(brandRoot, CERT_REL));
      },
    },
    {
      name: 'a stamped brand reaches its company tree — a SIBLING directory, never an ancestor',
      run: (ctx) => {
        // No nesting: the company workspace lives beside the brand, and the
        // brand's .omega/company.json is the only thing pointing at it.
        const { brandRoot, targetRoot } = stageBrand();
        const companyRoot = mkdtempSync(join(tmpdir(), 'omega-company-'));
        jetpack.write(join(companyRoot, CERT_REL), realP12Bytes());
        stampCompany(brandRoot, companyRoot);

        const resolved = resolveSigningCert({ projectRoot: targetRoot, env: { CSC_KEY_PASSWORD: REAL_PASSWORD } });

        ctx.expect(resolved.source).toBe('certificates');
        ctx.expect(resolved.cscLink).toBe(join(companyRoot, CERT_REL));
      },
    },
    {
      name: 'the brand tree wins over the company tree',
      run: (ctx) => {
        const { brandRoot, targetRoot } = stageBrand({ cert: 'real' });
        const companyRoot = mkdtempSync(join(tmpdir(), 'omega-company-'));
        jetpack.write(join(companyRoot, CERT_REL), realP12Bytes());
        stampCompany(brandRoot, companyRoot);

        const resolved = resolveSigningCert({ projectRoot: targetRoot, env: { CSC_KEY_PASSWORD: REAL_PASSWORD } });

        ctx.expect(resolved.cscLink).toBe(join(brandRoot, CERT_REL));
      },
    },
    {
      name: 'an unstamped brand with no tree stays on the keychain — no company is guessed',
      run: (ctx) => {
        const { targetRoot } = stageBrand();
        // A company workspace exists on disk but nothing points at it.
        const companyRoot = mkdtempSync(join(tmpdir(), 'omega-company-'));
        jetpack.write(join(companyRoot, CERT_REL), realP12Bytes());

        const resolved = resolveSigningCert({ projectRoot: targetRoot, env: { CSC_KEY_PASSWORD: REAL_PASSWORD } });

        ctx.expect(resolved.source).toBe('keychain');
        ctx.expect(resolved.cscLink).toBe(null);
      },
    },
    {
      name: 'a stamp pointing at a company with no tree stays on the keychain',
      run: (ctx) => {
        const { brandRoot, targetRoot } = stageBrand();
        stampCompany(brandRoot, mkdtempSync(join(tmpdir(), 'omega-company-')));

        const resolved = resolveSigningCert({ projectRoot: targetRoot, env: { CSC_KEY_PASSWORD: REAL_PASSWORD } });

        ctx.expect(resolved.source).toBe('keychain');
      },
    },
    {
      name: 'a cert with no CSC_KEY_PASSWORD stays on the keychain — an unopenable .p12 would fail the build',
      run: (ctx) => {
        const { targetRoot } = stageBrand({ cert: 'real' });

        const resolved = resolveSigningCert({ projectRoot: targetRoot, env: {} });

        ctx.expect(resolved.source).toBe('keychain');
        ctx.expect(resolved.cscLink).toBe(null);
        ctx.expect(resolved.reason.includes('CSC_KEY_PASSWORD')).toBe(true);
      },
    },
    {
      name: 'a password that does NOT open the .p12 stays on the keychain',
      run: (ctx) => {
        const { targetRoot } = stageBrand({ cert: 'real' });

        const resolved = resolveSigningCert({ projectRoot: targetRoot, env: { CSC_KEY_PASSWORD: 'not-the-password' } });

        ctx.expect(resolved.source).toBe('keychain');
        ctx.expect(resolved.cscLink).toBe(null);
        ctx.expect(resolved.reason.includes('does not open')).toBe(true);
      },
    },
    {
      name: 'a file that is not a .p12 at all stays on the keychain',
      run: (ctx) => {
        const { targetRoot } = stageBrand({ cert: 'dummy' });

        const resolved = resolveSigningCert({ projectRoot: targetRoot, env: { CSC_KEY_PASSWORD: REAL_PASSWORD } });

        ctx.expect(resolved.source).toBe('keychain');
        ctx.expect(resolved.reason.includes('does not open')).toBe(true);
      },
    },
    {
      name: 'an empty CSC_LINK is not an answer — the tree still wins',
      run: (ctx) => {
        const { brandRoot, targetRoot } = stageBrand({ cert: 'real' });

        const resolved = resolveSigningCert({ projectRoot: targetRoot, env: { CSC_LINK: '', CSC_KEY_PASSWORD: REAL_PASSWORD } });

        ctx.expect(resolved.source).toBe('certificates');
        ctx.expect(resolved.cscLink).toBe(join(brandRoot, CERT_REL));
      },
    },
    {
      name: 'a tree AT the home directory never signs a build (the ~/.omega overlay)',
      run: (ctx) => {
        // ~/.omega is a real personal overlay on developer machines. A stand-in
        // home carries the tree here; without the bound the walk would take it.
        const fakeHome = mkdtempSync(join(tmpdir(), 'omega-fake-home-'));
        const targetRoot = join(fakeHome, 'brand', 'targets', 'desktop');
        jetpack.dir(targetRoot);
        jetpack.write(join(fakeHome, CERT_REL), realP12Bytes());

        const resolved = resolveSigningCert({
          projectRoot: targetRoot,
          env: { CSC_KEY_PASSWORD: REAL_PASSWORD },
          homeDir: fakeHome,
        });

        ctx.expect(resolved.source).toBe('keychain');
        ctx.expect(resolved.cscLink).toBe(null);
      },
    },
    {
      name: 'a tree ABOVE the home directory is out of bounds too',
      run: (ctx) => {
        const above = mkdtempSync(join(tmpdir(), 'omega-above-home-'));
        const fakeHome = join(above, 'home');
        const targetRoot = join(fakeHome, 'brand', 'targets', 'desktop');
        jetpack.dir(targetRoot);
        jetpack.write(join(above, CERT_REL), realP12Bytes());

        const resolved = resolveSigningCert({
          projectRoot: targetRoot,
          env: { CSC_KEY_PASSWORD: REAL_PASSWORD },
          homeDir: fakeHome,
        });

        ctx.expect(resolved.source).toBe('keychain');
      },
    },
    {
      name: 'a tree BELOW home still resolves — the bound is the home dir, not "anywhere under it"',
      run: (ctx) => {
        const fakeHome = mkdtempSync(join(tmpdir(), 'omega-under-home-'));
        const brandRoot = join(fakeHome, 'Developer', 'brand');
        const targetRoot = join(brandRoot, 'targets', 'desktop');
        jetpack.dir(targetRoot);
        jetpack.write(join(brandRoot, CERT_REL), realP12Bytes());

        const resolved = resolveSigningCert({
          projectRoot: targetRoot,
          env: { CSC_KEY_PASSWORD: REAL_PASSWORD },
          homeDir: fakeHome,
        });

        ctx.expect(resolved.source).toBe('certificates');
        ctx.expect(resolved.cscLink).toBe(join(brandRoot, CERT_REL));
      },
    },
    {
      name: 'a LibreSSL openssl (no -legacy flag) still verifies the cert — the check retries without the flag',
      run: (ctx) => {
        // Stock macOS /usr/bin/openssl is LibreSSL: it rejects the -legacy FLAG
        // but reads legacy containers natively. A stub front presents exactly
        // that behavior, delegating the flagless retry to the system binary.
        const { brandRoot, targetRoot } = stageBrand({ cert: 'real' });
        const stubDir = mkdtempSync(join(tmpdir(), 'omega-libressl-stub-'));
        const stub = join(stubDir, 'openssl');
        jetpack.write(stub, [
          '#!/bin/sh',
          'for a in "$@"; do',
          '  if [ "$a" = "-legacy" ]; then echo "pkcs12: unknown option \'-legacy\'" >&2; exit 1; fi',
          'done',
          'if [ -x /usr/bin/openssl ]; then exec /usr/bin/openssl "$@"; fi',
          'exit 0',
          '',
        ].join('\n'));
        execFileSync('chmod', ['+x', stub]);

        const realPath = process.env.PATH;
        process.env.PATH = `${stubDir}:${realPath}`;
        try {
          const resolved = resolveSigningCert({ projectRoot: targetRoot, env: { ...process.env, CSC_KEY_PASSWORD: REAL_PASSWORD } });

          ctx.expect(resolved.source).toBe('certificates');
          ctx.expect(resolved.cscLink).toBe(join(brandRoot, CERT_REL));
        } finally {
          process.env.PATH = realPath;
        }
      },
    },
    {
      name: 'no openssl at all names the tooling, not the password, and stays on the keychain',
      run: (ctx) => {
        const { targetRoot } = stageBrand({ cert: 'real' });
        const emptyDir = mkdtempSync(join(tmpdir(), 'omega-no-openssl-'));

        const realPath = process.env.PATH;
        process.env.PATH = emptyDir;
        try {
          const resolved = resolveSigningCert({ projectRoot: targetRoot, env: { ...process.env, CSC_KEY_PASSWORD: REAL_PASSWORD } });

          ctx.expect(resolved.source).toBe('keychain');
          ctx.expect(resolved.reason.includes('openssl is not available')).toBe(true);
          ctx.expect(resolved.reason.includes('does not open')).toBe(false);
        } finally {
          process.env.PATH = realPath;
        }
      },
    },
    {
      name: 'the default boundary is the REAL home — a project under it picks up no stray tree',
      run: (ctx) => {
        const projectRoot = mkdtempSync(join(homedir(), '.omega-signing-probe-'));

        // No homeDir passed: the default must apply, and nothing in the real
        // home (including its ~/.omega overlay) may be reached.
        const resolved = resolveSigningCert({ projectRoot, env: { CSC_KEY_PASSWORD: REAL_PASSWORD } });

        ctx.expect(resolved.source).toBe('keychain');
        ctx.expect(resolved.cscLink).toBe(null);

        jetpack.remove(projectRoot);
      },
    },
  ],
};
