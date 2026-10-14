/**
 * Mint a self-signed fixture certificate with an explicit validity window.
 *
 * `openssl ca -selfsign` takes `-startdate`/`-enddate` on every openssl a test
 * meets (OpenSSL 1.1, 3.0, 4.0, LibreSSL), so an already-expired certificate is
 * real material on a CI runner too; `req -x509 -not_before` exists from 3.4 only.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const OUTFORMS = ['DER', 'PEM'];

/**
 * openssl's explicit validity time (YYYYMMDDHHMMSSZ), `daysFromNow` from now.
 *
 * @param {number} daysFromNow - Negative is in the past
 * @returns {string}
 */
function formatAsn1(daysFromNow) {
  return `${new Date(Date.now() + daysFromNow * MS_PER_DAY).toISOString().replace(/[-:T]/g, '').split('.')[0]}Z`;
}

/**
 * The throwaway CA config: a database in `dir`, and a policy taking every
 * standard name field as given, so the subject lands whole.
 *
 * @param {string} dir - The temp dir holding the database
 * @returns {string} The config text
 */
function caConfig(dir) {
  return [
    '[ ca ]',
    'default_ca = fixture',
    '[ fixture ]',
    `database = ${path.join(dir, 'index.txt')}`,
    `new_certs_dir = ${dir}`,
    `serial = ${path.join(dir, 'serial')}`,
    'default_md = sha256',
    'policy = policy_any',
    'unique_subject = no',
    '[ policy_any ]',
    ...['countryName', 'stateOrProvinceName', 'localityName', 'organizationName', 'organizationalUnitName', 'commonName', 'emailAddress']
      .map((field) => `${field} = optional`),
    '',
  ].join('\n');
}

/**
 * A certificate for `keyPath` valid for `days` from now (negative: `2 * days` to `days`,
 * expired); a missing key file is generated first, no `keyPath` signs with a throwaway one.
 *
 * @param {object} options
 * @param {string} [options.keyPath] - The PEM private key the certificate carries
 * @param {string} options.certPath - Where the certificate is written
 * @param {number} options.days - Its lifetime in days from now; negative is expired
 * @param {string} [options.subject] - The subject, openssl's `/CN=.../C=..` form
 * @param {'DER'|'PEM'} [options.outform] - The file's encoding
 * @returns {{ keyPath: string|undefined, certPath: string }}
 */
function mintCert({ keyPath, certPath, days, subject = '/CN=Fixture/C=US', outform = 'DER' }) {
  if (!certPath) throw new Error('mintCert needs a certPath');
  if (!Number.isFinite(days)) throw new Error(`mintCert needs a numeric days, got ${days}`);
  if (!OUTFORMS.includes(outform)) throw new Error(`mintCert outform must be one of ${OUTFORMS.join(', ')}, got ${outform}`);

  const dir = jetpack.tmpDir({ prefix: 'omega-mint-cert-' });
  try {
    const key = keyPath || dir.path('private.key');
    const openssl = (args) => execFileSync('openssl', args, { stdio: 'pipe' });
    if (!jetpack.exists(key)) {
      jetpack.dir(path.dirname(key));
      openssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', key]);
    }

    dir.write('index.txt', '');
    dir.write('serial', '01\n');
    dir.write('ca.cnf', caConfig(dir.path()));
    openssl(['req', '-new', '-key', key, '-subj', subject, '-out', dir.path('request.csr')]);
    openssl([
      'ca', '-selfsign', '-batch', '-notext', '-preserveDN',
      '-config', dir.path('ca.cnf'), '-keyfile', key, '-in', dir.path('request.csr'), '-out', dir.path('cert.pem'),
      '-startdate', formatAsn1(days < 0 ? 2 * days : 0), '-enddate', formatAsn1(days),
    ]);

    jetpack.dir(path.dirname(certPath));
    openssl(['x509', '-in', dir.path('cert.pem'), '-outform', outform, '-out', certPath]);
    return { keyPath, certPath };
  } finally {
    dir.remove();
  }
}

module.exports = { mintCert };
