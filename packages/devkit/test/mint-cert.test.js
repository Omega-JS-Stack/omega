/**
 * mintCert: a fixture certificate with the validity window a case asks for,
 * minted the way every openssl a runner carries accepts. Real openssl both
 * ways: the helper writes the file, openssl reads its dates and key back.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { mintCert } = require('@omega.js/devkit/test/mint-cert');
const { certificateExpiry } = require('../src/certificate-expiry.js');

const DAY_MS = 24 * 3600 * 1000;

// The two suites that mint expired fixtures; the 3.4-only window flags stay out of both.
const CERT_SUITES = [
  path.join(__dirname, 'certificate-expiry.test.js'),
  path.join(__dirname, '..', '..', 'manager', 'test', 'certificates.test.js'),
];

/** A temp dir for one case, removed after it. */
function tempDir(ctx) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-mint-cert-test-'));
  ctx.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const openssl = (...args) => execFileSync('openssl', args, { encoding: 'utf8', stdio: 'pipe' });

/** The certificate's `notAfter`, read back by openssl. */
function endDate(certPath, inform = 'DER') {
  const line = openssl('x509', '-inform', inform, '-in', certPath, '-noout', '-enddate').trim();
  return new Date(line.replace(/^notAfter=/, ''));
}

module.exports = defineCases({
  type: 'group',
  description: 'mint-cert',
  tests: [
    {
      name: 'days -30: openssl reads an end date in the past, and certificateExpiry reports daysLeft < 0',
      run: (ctx) => {
        const certPath = path.join(tempDir(ctx), 'expired.cer');

        mintCert({ certPath, days: -30 });

        const end = endDate(certPath);
        ctx.expect(end < new Date(), `notAfter was ${end.toISOString()}`).toBeTruthy();
        const { daysLeft } = certificateExpiry(certPath);
        ctx.expect(daysLeft < 0, `daysLeft was ${daysLeft}`).toBeTruthy();
      },
    },

    {
      name: 'days 365: the end date is about a year ahead',
      run: (ctx) => {
        const certPath = path.join(tempDir(ctx), 'year.cer');

        mintCert({ certPath, days: 365 });

        const daysAhead = (endDate(certPath) - Date.now()) / DAY_MS;
        ctx.expect(daysAhead > 364 && daysAhead <= 365, `the end date was ${daysAhead} days ahead`).toBeTruthy();
      },
    },

    {
      name: 'an existing keyPath: the certificate carries that key (x509 -pubkey equals pkey -pubout)',
      run: (ctx) => {
        const dir = tempDir(ctx);
        const keyPath = path.join(dir, 'private.key');
        const certPath = path.join(dir, 'keyed.cer');
        openssl('genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', keyPath);
        const keyBefore = fs.readFileSync(keyPath, 'utf8');

        mintCert({ keyPath, certPath, days: 30 });

        const fromCert = openssl('x509', '-inform', 'DER', '-in', certPath, '-noout', '-pubkey');
        const fromKey = openssl('pkey', '-in', keyPath, '-pubout');
        ctx.expect(fromCert).toBe(fromKey);
        ctx.expect(fs.readFileSync(keyPath, 'utf8'), 'the existing key is left as it was').toBe(keyBefore);
      },
    },

    {
      name: 'outform PEM: the file starts with the PEM certificate header line',
      run: (ctx) => {
        const certPath = path.join(tempDir(ctx), 'cert.pem');

        mintCert({ certPath, days: 30, outform: 'PEM' });

        const text = fs.readFileSync(certPath, 'utf8');
        ctx.expect(text.split('\n')[0]).toBe('-----BEGIN CERTIFICATE-----');
        ctx.expect(endDate(certPath, 'PEM') > new Date()).toBeTruthy();
      },
    },

    {
      name: 'the two certificate suites mint without -not_before or -not_after',
      run: (ctx) => {
        for (const suite of CERT_SUITES) {
          const source = fs.readFileSync(suite, 'utf8');
          const name = path.relative(path.join(__dirname, '..', '..'), suite);
          ctx.expect(/-not_(before|after)\b/.test(source), `${name} names a 3.4-only validity flag`).toBe(false);
        }
      },
    },
  ],
});
