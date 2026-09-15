/**
 * How long a signing certificate has left: the ONE expiry reader
 * ([#892](https://github.com/Omega-JS-Stack/omega/issues/892)).
 *
 * Two places used to parse `openssl x509 -enddate` with their own regex and
 * their own date math (the manager's `validateManualCertificate`, the desktop's
 * `validate-certs` provisioning-profile block), and neither could read a `.p12`
 * at all, so the walk that PRODUCES the signing material never said how long it
 * had left. One function answers for both container shapes:
 *
 *   .cer / .pem   openssl x509 -enddate           (openssl 3 auto-detects DER/PEM)
 *   .p12          openssl pkcs12 -nokeys + x509   (the cert half, then the same read)
 *
 * The password rides an env var (`-passin env:`), never argv and never a shell
 * string, exactly as the manager's export and the desktop's signing lookup pass
 * theirs.
 *
 * It THROWS on a file it cannot read: an unreadable certificate is not "zero
 * days left", it is a broken invariant the caller must report as its own error.
 */
const { execFileSync } = require('node:child_process');
const { extname } = require('node:path');
const jetpack = require('fs-jetpack');

const PASSWORD_ENV = 'OMEGA_P12_PASSWORD';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The ONE renewal window: under this many days left, every reader of this
// module warns (the manager walk per type, the desktop's validate-certs step);
// past zero, every one of them errors.
const EXPIRY_WARN_DAYS = 30;

/**
 * The certificate half of a .p12, as PEM.
 *
 * Two openssl families answer differently: OpenSSL 3 needs `-legacy` for the
 * legacy-format containers the manager exports (macOS `security import` needs
 * that format), while stock macOS /usr/bin/openssl is LibreSSL, which rejects
 * the `-legacy` FLAG but reads legacy containers natively. A flag rejection is
 * retried without it; anything else is the caller's error.
 *
 * @param {string} filePath - Path to the .p12.
 * @param {string} password - Password that opens it.
 * @returns {string} PEM text.
 */
function p12Certificate(filePath, password) {
  const run = (extra) => execFileSync(
    'openssl',
    ['pkcs12', ...extra, '-in', filePath, '-nokeys', '-passin', `env:${PASSWORD_ENV}`],
    { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, [PASSWORD_ENV]: password } },
  );

  try {
    return run(['-legacy']);
  } catch (error) {
    if (String(error.stderr || '').includes('unknown option')) {
      return run([]);
    }
    throw error;
  }
}

/**
 * When a certificate expires, and how many days that is from now.
 *
 * @param {string} filePath - A .cer, .pem or .p12 on disk.
 * @param {object} [options]
 * @param {string} [options.password] - The .p12 password (ignored for a .cer/.pem).
 * @returns {{ expiresAt: Date, daysLeft: number }} `daysLeft` is negative for an
 *   expired certificate.
 * @throws {Error} When the file is missing, unopenable, or carries no date.
 */
function certificateExpiry(filePath, { password = '' } = {}) {
  if (!filePath || !jetpack.exists(filePath)) {
    throw new Error(`certificateExpiry: no file at ${filePath}`);
  }

  const isP12 = extname(filePath).toLowerCase() === '.p12';
  let output;

  try {
    output = isP12
      ? execFileSync('openssl', ['x509', '-enddate', '-noout'], {
        encoding: 'utf8',
        stdio: 'pipe',
        input: p12Certificate(filePath, password),
      })
      : execFileSync('openssl', ['x509', '-enddate', '-noout', '-in', filePath], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
  } catch (error) {
    throw new Error(`certificateExpiry: could not read ${filePath}: ${error.message}`);
  }

  const match = String(output).match(/notAfter=(.+)/);
  const expiresAt = match ? new Date(match[1].trim()) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    throw new Error(`certificateExpiry: no expiration date in ${filePath}`);
  }

  return {
    expiresAt,
    daysLeft: Math.floor((expiresAt.getTime() - Date.now()) / MS_PER_DAY),
  };
}

module.exports = { certificateExpiry, EXPIRY_WARN_DAYS };
