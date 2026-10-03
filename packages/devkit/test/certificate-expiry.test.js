/**
 * The ONE expiry reader (#892), against REAL openssl material: a self-signed
 * DER `.cer` with a known lifetime, the `.p12` exported from it with a password,
 * and an already-expired cert. Nothing here is mocked, because a mocked expiry
 * proves nothing about the parse that the manager walk and the desktop's
 * validate-certs step now both depend on.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { certificateExpiry } = require('../src/certificate-expiry.js');

const PASSWORD = 'fixture-pass';

/** A self-signed cert + key + .p12 whose lifetime we chose. */
function stageCert(t, { days = 365 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-expiry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const keyPath = path.join(dir, 'private.key');
  const certPath = path.join(dir, 'cert.cer');
  const p12Path = path.join(dir, 'cert.p12');

  execFileSync('openssl', [
    'req', '-x509', '-nodes', '-newkey', 'rsa:2048',
    '-keyout', keyPath, '-out', certPath,
    '-days', String(Math.abs(days)),
    ...(days < 0 ? ['-not_before', formatAsn1(-2 * Math.abs(days)), '-not_after', formatAsn1(-Math.abs(days))] : []),
    '-subj', '/CN=Expiry Fixture/C=US', '-outform', 'DER',
  ], { stdio: 'pipe' });

  execFileSync('openssl', [
    'pkcs12', '-export', '-legacy', '-inkey', keyPath, '-in', certPath,
    '-out', p12Path, '-passout', 'env:OMEGA_P12_PASSWORD',
  ], { stdio: 'pipe', env: { ...process.env, OMEGA_P12_PASSWORD: PASSWORD } });

  return { dir, certPath, p12Path };
}

// openssl's explicit validity window format (YYYYMMDDHHMMSSZ), used to stage a
// certificate that is already expired.
function formatAsn1(daysFromNow) {
  return `${new Date(Date.now() + daysFromNow * 24 * 3600 * 1000).toISOString().replace(/[-:T]/g, '').split('.')[0]}Z`;
}

module.exports = defineCases({
  type: 'group',
  description: 'certificate-expiry',
  tests: [
    {
      name: 'certificateExpiry: a .cer reports its expiry date and the days left',
      run: (ctx) => {
        const { certPath } = stageCert(ctx, { days: 365 });

        const { expiresAt, daysLeft } = certificateExpiry(certPath);

        ctx.expect(expiresAt instanceof Date).toBeTruthy();
        ctx.expect(daysLeft >= 363 && daysLeft <= 365, `daysLeft was ${daysLeft}`).toBeTruthy();
        ctx.expect(Math.round((expiresAt - new Date()) / 86400000)).toBe(365);
      },
    },

    {
      name: 'certificateExpiry: a .p12 reads through its password, the same answer as its .cer',
      run: (ctx) => {
        const { certPath, p12Path } = stageCert(ctx, { days: 90 });

        const fromP12 = certificateExpiry(p12Path, { password: PASSWORD });
        const fromCer = certificateExpiry(certPath);

        ctx.expect(fromP12.expiresAt.getTime()).toBe(fromCer.expiresAt.getTime());
        ctx.expect(fromP12.daysLeft >= 88 && fromP12.daysLeft <= 90, `daysLeft was ${fromP12.daysLeft}`).toBeTruthy();
      },
    },

    {
      name: 'certificateExpiry: an expired certificate reports negative days, never an error',
      run: (ctx) => {
        const { certPath } = stageCert(ctx, { days: -30 });

        const { daysLeft, expiresAt } = certificateExpiry(certPath);

        ctx.expect(daysLeft < 0, `daysLeft was ${daysLeft}`).toBeTruthy();
        ctx.expect(expiresAt < new Date()).toBeTruthy();
      },
    },

    {
      name: 'certificateExpiry: an unreadable file THROWS, it is never zero days left',
      run: (ctx) => {
        const { dir, p12Path } = stageCert(ctx);

        ctx.expect(() => certificateExpiry(path.join(dir, 'nope.cer'))).toThrow(/no file at/);

        const garbage = path.join(dir, 'garbage.cer');
        fs.writeFileSync(garbage, 'not a certificate');
        ctx.expect(() => certificateExpiry(garbage)).toThrow(/could not read/);

        ctx.expect(() => certificateExpiry(p12Path, { password: 'wrong-password' })).toThrow(/could not read/);
      },
    },
  ],
});
