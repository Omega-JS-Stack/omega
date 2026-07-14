/**
 * Interactive walkthrough for portal-only certificate types (DEVELOPER_ID_*).
 * Apple's API can list and download these but only the Account Holder can
 * CREATE them, in the portal UI — so the walkthrough automates everything
 * around that one human step: it generates/reuses the pipeline's CSR (the
 * private key stays local, so the .p12 export pairs), drops a picker-friendly
 * copy in Downloads, opens the portal's create page (Enter-gated), then polls
 * Downloads + the target path for the issued .cer — installing it only when
 * it provably pairs with our key and names the expected certificate type.
 *
 * Restores omega-manager's interactive rescue (the port had reduced it to
 * printed guidance) and goes further: legacy still sent the user to Keychain
 * Access to make the CSR; here upload + download are the only human steps.
 */
const { homedir } = require('node:os');
const { join, basename } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const { openBrowserAndPoll } = require('@omega.js/devkit/flows');

const {
  getCSRContent,
  validateManualCertificate,
  certificateMatchesKey,
  getCertificateCommonName,
} = require('./certificate-manager.js');

const PORTAL_CREATE_URL = 'https://developer.apple.com/account/resources/certificates/add';

// Portal option labels by config type prefix — the radio button the Account
// Holder must pick on the create page, and the CN prefix Apple stamps on the
// issued certificate (how a wrong-type download is caught).
const PORTAL_LABELS = [
  { prefix: 'DEVELOPER_ID_APPLICATION', label: 'Developer ID Application' },
  { prefix: 'DEVELOPER_ID_INSTALLER', label: 'Developer ID Installer' },
];

function portalLabelOf(type) {
  const match = PORTAL_LABELS.find((entry) => type.startsWith(entry.prefix));
  return match ? match.label : type;
}

/**
 * Find the issued .cer among the candidates: the target path itself (the
 * user saved straight to the printed path) or any .cer that landed in the
 * downloads dir since the walkthrough started. A candidate is accepted only
 * when it pairs with the pipeline's private key (modulus match — proof it
 * was issued from OUR CSR) and carries the expected CN prefix (catches
 * creating the wrong Developer ID type from the right CSR). Rejections are
 * remembered so each bad file warns once, not every poll tick.
 *
 * @returns {string|null} - Path of the accepted .cer, or null
 */
function findIssuedCert({ certPath, downloadsDir, keyPath, portalLabel, startedAt, rejected }) {
  const candidates = [];

  if (jetpack.exists(certPath)) {
    candidates.push(certPath);
  }

  for (const name of jetpack.list(downloadsDir) || []) {
    if (!name.toLowerCase().endsWith('.cer')) {
      continue;
    }
    const candidate = join(downloadsDir, name);
    const modified = jetpack.inspect(candidate, { times: true })?.modifyTime;
    if (modified && modified.getTime() >= startedAt) {
      candidates.push(candidate);
    }
  }

  for (const candidate of candidates) {
    if (rejected.has(candidate)) {
      continue;
    }
    if (!validateManualCertificate(candidate).valid) {
      continue;
    }

    if (!certificateMatchesKey(candidate, keyPath)) {
      rejected.add(candidate);
      console.log(`\n        ${chalk.yellow('⚠')} ${basename(candidate)} was not issued from the CSR I staged — create the certificate with that exact file`);
      continue;
    }

    const cn = getCertificateCommonName(candidate);
    if (!cn || !cn.startsWith(portalLabel)) {
      rejected.add(candidate);
      console.log(`\n        ${chalk.yellow('⚠')} ${basename(candidate)} is "${cn || 'unreadable'}" — expected a ${portalLabel} certificate`);
      continue;
    }

    return candidate;
  }

  return null;
}

/**
 * Walk the user through creating a portal-only certificate: CSR staged →
 * portal opened → issued .cer detected → installed to certPath. The caller
 * re-validates and continues down its normal valid-local-file path (.p12
 * export + keychain import), exactly as if the file had always been there.
 *
 * @param {Object} options
 * @param {string} options.type - Certificate type (e.g. DEVELOPER_ID_INSTALLER_G2)
 * @param {string} options.certPath - Where the .cer must land
 * @param {string} options.appleDir - The brand's .omega/certificates/apple dir
 * @param {string} options.teamId - Apple team ID (CSR subject)
 * @param {string} [options.downloadsDir] - Where downloads land (test seam)
 * @returns {Promise<{ installed: boolean }>}
 */
async function runManualCertWalkthrough({ type, certPath, appleDir, teamId, downloadsDir = join(homedir(), 'Downloads') }) {
  const portalLabel = portalLabelOf(type);
  const startedAt = Date.now();

  // The same CSR machinery as the automatable types: key + CSR generated
  // once, reused forever — the issued cert must pair with this key or the
  // .p12 export (and CI signing) has nothing to pair with.
  getCSRContent(type, appleDir, teamId);
  const keyPath = join(appleDir, 'csr', type, 'private.key');

  // Picker-friendly copy: the portal's file dialog starts in Downloads, and
  // some browsers filter for the .certSigningRequest extension.
  const uploadName = `omega-${type}.certSigningRequest`;
  jetpack.copy(join(appleDir, 'csr', type, 'request.csr'), join(downloadsDir, uploadName), { overwrite: true });

  const g2Note = type.endsWith('_G2')
    ? `\n           ${chalk.dim('(asked for a profile type? choose "G2 Sub-CA")')}`
    : '';
  const steps = [
    `Apple only lets the ${chalk.bold('Account Holder')} create ${chalk.cyan(portalLabel)} certificates, in the portal:`,
    `          1. Sign in as the Account Holder`,
    `          2. Choose ${chalk.bold(portalLabel)} under Software, then Continue${g2Note}`,
    `          3. Upload ${chalk.cyan(uploadName)} — already staged in your Downloads folder`,
    `          4. Download the issued certificate — I'll detect it in Downloads and take it from there`,
  ].join('\n');

  const rejected = new Set();
  const result = await openBrowserAndPoll({
    url: PORTAL_CREATE_URL,
    promptMessage: steps,
    label: 'the Apple Developer portal',
    waitMessage: `Waiting for the issued ${portalLabel} certificate`,
    intervalMs: 3000,
    check: async () => {
      const found = findIssuedCert({ certPath, downloadsDir, keyPath, portalLabel, startedAt, rejected });
      if (!found) {
        return { done: false };
      }
      if (found !== certPath) {
        jetpack.copy(found, certPath, { overwrite: true });
      }
      return { done: true, result: found };
    },
  });

  if (result.success) {
    console.log(`        ${chalk.green('✓')} Installed ${chalk.gray(certPath)}`);
  }

  return { installed: Boolean(result.success) };
}

module.exports = { runManualCertWalkthrough, PORTAL_CREATE_URL };
