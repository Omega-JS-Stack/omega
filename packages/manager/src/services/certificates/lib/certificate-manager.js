/**
 * Certificate CRUD + local key material: list/create/download signing
 * certificates via the App Store Connect API, generate CSRs with openssl,
 * export .cer + private key pairs to Keychain-importable .p12 files, and
 * validate manually-downloaded .cer files.
 *
 * openssl notes (both verified against OpenSSL 3.x, which auto-detects
 * DER/PEM input): Apple serves .cer files as DER; `pkcs12 -export -legacy`
 * forces the older PBE-SHA1-3DES format because macOS `security import`
 * rejects OpenSSL 3's default PBES2/AES-256-CBC ("MAC verification
 * failed").
 */
const { execFileSync } = require('node:child_process');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const { certificateExpiry } = require('@omega.js/devkit/certs');

const { isStale } = require('../../../lib/stale.js');
const { API_BASE } = require('./apple-api.js');

/**
 * List all certificates (paginated).
 */
async function listCertificates(client) {
  return client.paginate(`${API_BASE}/certificates?limit=200`);
}

/**
 * Download a certificate's .cer content (base64-decoded DER) to disk.
 */
async function downloadCertificate(client, certificateId, outputPath) {
  const data = await client.request(`${API_BASE}/certificates/${certificateId}`);
  const certificateContent = data?.data?.attributes?.certificateContent;
  if (!certificateContent) {
    throw new Error(`Certificate ${certificateId} has no certificateContent`);
  }
  jetpack.write(outputPath, Buffer.from(certificateContent, 'base64'));
  console.log(`        ${chalk.green('✓')} Downloaded ${chalk.gray(outputPath)}`);
}

/**
 * Create a new certificate by submitting a CSR.
 */
async function createCertificate(client, type, csrContent) {
  const data = await client.request(`${API_BASE}/certificates`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'certificates',
        attributes: { certificateType: type, csrContent },
      },
    }),
  });
  return data.data;
}

/**
 * Generate a new RSA-2048 private key + CSR via openssl. Writes
 * `private.key` and `request.csr` to outputDir; returns the cleaned CSR
 * body (no PEM headers/newlines) ready to POST to Apple.
 */
function generateCSR(emailAddress, commonName, outputDir) {
  jetpack.dir(outputDir);
  const keyPath = `${outputDir}/private.key`;
  const csrPath = `${outputDir}/request.csr`;
  const subject = `/emailAddress=${emailAddress}/CN=${commonName}/C=US`;

  execFileSync(
    'openssl',
    ['req', '-nodes', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', csrPath, '-subj', subject],
    { stdio: 'pipe' },
  );

  return cleanCSR(jetpack.read(csrPath));
}

/**
 * Get CSR content for a cert type, reusing an existing CSR when found: the
 * company tier first, then the brand's own (#892). A NEW one is generated in
 * the tree's write dir.
 *
 * IMPORTANT: CSR private keys must be preserved across runs. They are
 * paired with the issued certificate, so deleting a CSR private key while a
 * matching cert is active makes the cert unusable for signing.
 */
function getCSRContent(type, tree, teamId) {
  const existing = tree.find(`csr/${type}/request.csr`);

  if (existing) {
    console.log(`        ${chalk.gray('ℹ')} Reusing existing CSR from ${existing.path}`);
    return cleanCSR(jetpack.read(existing.path));
  }

  console.log(`        Generating new CSR...`);
  return generateCSR(`${teamId}@apple.com`, `${type} Certificate`, tree.path(`csr/${type}`));
}

function cleanCSR(csrContent) {
  return csrContent
    .replace('-----BEGIN CERTIFICATE REQUEST-----', '')
    .replace('-----END CERTIFICATE REQUEST-----', '')
    .replace(/\n/g, '');
}

/**
 * Export the .cer + private.key pair to a Keychain-importable .p12.
 *
 * Both halves resolve through the TWO tiers (company first, brand second,
 * #892); the .p12 is written where the tree writes. The key is not merely
 * PRESENT, it is PAIRED: the modulus of each candidate key is compared with the
 * certificate's, so the answer is the key that can actually sign, wherever it
 * lives.
 *
 * No-ops when the .cer is missing or when the .p12 is already fresher than the
 * .cer (mtime diff, so a converged brand runs zero openssl execs). It REPORTS
 * instead of printing: whether a configured type ends up with signing material
 * is the walk's verdict to give ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)),
 * and a cert with no paired key is an error there, never a warning.
 *
 * @param {string} type - Certificate type (DEVELOPER_ID_APPLICATION_G2, ...).
 * @param {object} tree - The brand's signing tree (@omega.js/devkit/signing-tree).
 * @param {string} [certificatePassword] - Password the .p12 carries.
 * @returns {{ exported: boolean, keyPath: string|null, p12Path: string|null, reason: string|null }}
 *   `reason` is null on a real export, else one of `no-certificate`,
 *   `current`, `no-paired-key`, `export-failed: <message>`.
 */
function exportToP12(type, tree, certificatePassword = '') {
  const cert = tree.find(`certificates/${type}.cer`);
  const p12Path = tree.path(`certificates/${type}.p12`);

  if (!cert) {
    return { exported: false, keyPath: null, p12Path, reason: 'no-certificate' };
  }

  const existing = tree.find(`certificates/${type}.p12`);
  if (existing && !isStale(cert.path, existing.path)) {
    return { exported: false, keyPath: null, p12Path: existing.path, reason: 'current' };
  }

  const keyPath = findPairedKey(cert.path, type, tree);
  if (!keyPath) {
    return { exported: false, keyPath: null, p12Path, reason: 'no-paired-key' };
  }

  try {
    // -legacy: macOS `security import` requires the old PKCS12 format.
    // Password rides an env var (-passout env:), never argv, never a shell string.
    execFileSync(
      'openssl',
      ['pkcs12', '-export', '-legacy', '-inkey', keyPath, '-in', cert.path, '-out', p12Path, '-passout', 'env:OMEGA_P12_PASSWORD'],
      { stdio: 'pipe', env: { ...process.env, OMEGA_P12_PASSWORD: certificatePassword } },
    );
  } catch (error) {
    return { exported: false, keyPath, p12Path, reason: `export-failed: ${error.message}` };
  }

  return { exported: true, keyPath, p12Path, reason: null };
}

/**
 * The private key that PAIRS with a certificate, company tier first: proof the
 * cert was issued from a CSR this pipeline holds the key for, and the answer to
 * "can this type sign anything". Null when no tier holds a pairing key.
 *
 * @param {string} certPath - The certificate.
 * @param {string} type - Certificate type (names the csr/ dir).
 * @param {object} tree - The brand's signing tree.
 * @returns {string|null}
 */
function findPairedKey(certPath, type, tree) {
  for (const dir of tree.readDirs) {
    const candidate = `${dir}/csr/${type}/private.key`;
    if (jetpack.exists(candidate) && certificateMatchesKey(certPath, candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Find a non-expired certificate of the given type, preferring the one
 * that expires furthest in the future.
 */
function findValidCertificate(existingCerts, type) {
  const now = new Date();
  const validCerts = existingCerts.filter((cert) => {
    return cert.attributes.certificateType === type
      && new Date(cert.attributes.expirationDate) > now;
  });

  if (validCerts.length === 0) {
    return null;
  }

  return validCerts.sort((a, b) => {
    return new Date(b.attributes.expirationDate) - new Date(a.attributes.expirationDate);
  })[0];
}

/**
 * Validate a manually-downloaded .cer (exists + not expired) through the ONE
 * expiry reader (`@omega.js/devkit/certs`, #892). Manual types (DEVELOPER_ID_*)
 * can only be downloaded from the developer portal, the API cannot create them.
 *
 * @param {string} certPath - The .cer.
 * @returns {{ valid: boolean, expiresAt: Date|null, daysLeft: number|null, reason: string|null }}
 */
function validateManualCertificate(certPath) {
  if (!certPath || !jetpack.exists(certPath)) {
    return { valid: false, expiresAt: null, daysLeft: null, reason: 'file not found' };
  }

  let expiry;
  try {
    expiry = certificateExpiry(certPath);
  } catch (error) {
    return { valid: false, expiresAt: null, daysLeft: null, reason: error.message };
  }

  if (expiry.daysLeft < 0) {
    return { valid: false, ...expiry, reason: 'expired' };
  }

  return { valid: true, ...expiry, reason: null };
}

/**
 * Common Name of a certificate's subject (openssl auto-detects DER/PEM).
 * Apple stamps the portal type into the CN ("Developer ID Installer: Team
 * Name (TEAMID)") — how a downloaded .cer is matched to the expected type.
 *
 * @returns {string|null}
 */
function getCertificateCommonName(certPath) {
  try {
    const subject = execFileSync(
      'openssl',
      ['x509', '-subject', '-noout', '-in', certPath],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    const match = subject.match(/CN\s*=\s*([^,]+)/);
    return match ? match[1].trim() : null;
  } catch (error) {
    return null;
  }
}

/**
 * Whether the certificate's public key pairs with the private key (modulus
 * comparison) — proof a portal-downloaded .cer was issued from the
 * pipeline's own CSR, so the .p12 export has its pair.
 */
function certificateMatchesKey(certPath, keyPath) {
  try {
    const certModulus = execFileSync(
      'openssl',
      ['x509', '-modulus', '-noout', '-in', certPath],
      { encoding: 'utf8', stdio: 'pipe' },
    ).trim();
    const keyModulus = execFileSync(
      'openssl',
      ['rsa', '-modulus', '-noout', '-in', keyPath],
      { encoding: 'utf8', stdio: 'pipe' },
    ).trim();
    return certModulus.length > 0 && certModulus === keyModulus;
  } catch (error) {
    return false;
  }
}

module.exports = {
  listCertificates,
  downloadCertificate,
  createCertificate,
  generateCSR,
  getCSRContent,
  exportToP12,
  findValidCertificate,
  validateManualCertificate,
  getCertificateCommonName,
  certificateMatchesKey,
  findPairedKey,
};
