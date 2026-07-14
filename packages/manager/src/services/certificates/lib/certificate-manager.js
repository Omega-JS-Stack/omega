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
const { execSync } = require('node:child_process');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

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

  execSync(
    `openssl req -nodes -newkey rsa:2048 -keyout "${keyPath}" -out "${csrPath}" -subj "${subject}"`,
    { stdio: 'pipe' },
  );

  return cleanCSR(jetpack.read(csrPath));
}

/**
 * Get CSR content for a cert type, reusing an existing CSR when found.
 *
 * IMPORTANT: CSR private keys must be preserved across runs — they're
 * paired with the issued certificate. Deleting a CSR private key while a
 * matching cert is active makes the cert unusable for signing.
 */
function getCSRContent(type, appleDir, teamId) {
  const csrDir = `${appleDir}/csr/${type}`;
  const csrPath = `${csrDir}/request.csr`;

  if (jetpack.exists(csrPath)) {
    console.log(`        ${chalk.gray('ℹ')} Reusing existing CSR from ${csrPath}`);
    return cleanCSR(jetpack.read(csrPath));
  }

  console.log(`        Generating new CSR...`);
  return generateCSR(`${teamId}@apple.com`, `${type} Certificate`, csrDir);
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
 * No-ops when the .cer is missing or when the .p12 is already fresher than
 * the .cer (mtime diff — a converged brand runs zero openssl execs). A cert
 * WITHOUT its paired key warns instead of silently skipping: that cert
 * can't sign anything until csr/{TYPE}/private.key arrives from the machine
 * whose CSR created it.
 */
function exportToP12(type, appleDir, certificatePassword = '') {
  const certPath = `${appleDir}/certificates/${type}.cer`;
  const keyPath = `${appleDir}/csr/${type}/private.key`;
  const p12Path = `${appleDir}/certificates/${type}.p12`;

  if (!jetpack.exists(certPath)) {
    return;
  }
  if (!jetpack.exists(keyPath)) {
    console.log(`        ${chalk.yellow('⚠')} No local private key for ${type} — .p12 not exported (copy csr/${type}/private.key from the machine that created the CSR, then re-run)`);
    return;
  }
  if (!isStale(certPath, p12Path)) {
    return;
  }

  try {
    // -legacy: macOS `security import` requires the old PKCS12 format
    execSync(
      `openssl pkcs12 -export -legacy -inkey "${keyPath}" -in "${certPath}" -out "${p12Path}" -passout pass:${certificatePassword}`,
      { stdio: 'pipe' },
    );
    console.log(`        ${chalk.green('✓')} Exported .p12 ${chalk.gray(p12Path)}`);
  } catch (error) {
    console.log(`        ${chalk.yellow('⚠')} Failed to export .p12: ${chalk.gray(error.message)}`);
  }
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
 * Validate a manually-downloaded .cer via openssl (exists + not expired).
 * Manual types (DEVELOPER_ID_*) can only be downloaded from the developer
 * portal — the API doesn't allow creating them.
 *
 * @returns {{ valid: boolean, expirationDate: Date|null, reason: string|null }}
 */
function validateManualCertificate(certPath) {
  if (!jetpack.exists(certPath)) {
    return { valid: false, expirationDate: null, reason: 'file not found' };
  }

  try {
    const endDateOutput = execSync(
      `openssl x509 -enddate -noout -in "${certPath}"`,
      { encoding: 'utf8', stdio: 'pipe' },
    ).trim();

    const dateMatch = endDateOutput.match(/notAfter=(.+)/);
    if (!dateMatch) {
      return { valid: false, expirationDate: null, reason: 'could not parse expiration date' };
    }

    const expirationDate = new Date(dateMatch[1]);
    if (expirationDate <= new Date()) {
      return { valid: false, expirationDate, reason: 'expired' };
    }

    return { valid: true, expirationDate, reason: null };
  } catch (error) {
    return { valid: false, expirationDate: null, reason: error.message };
  }
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
    const subject = execSync(
      `openssl x509 -subject -noout -in "${certPath}"`,
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
    const certModulus = execSync(
      `openssl x509 -modulus -noout -in "${certPath}"`,
      { encoding: 'utf8', stdio: 'pipe' },
    ).trim();
    const keyModulus = execSync(
      `openssl rsa -modulus -noout -in "${keyPath}"`,
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
};
