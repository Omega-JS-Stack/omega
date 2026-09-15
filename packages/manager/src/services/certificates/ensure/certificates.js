/**
 * Ensure the account's signing certificates exist and are on disk. One set
 * of certificates signs all of an Apple Developer account's apps, so this
 * reconciles the account, not the brand.
 *
 * REUSE, never mint over a valid cert
 * ([#892](https://github.com/Omega-JS-Stack/omega/issues/892)): every read
 * looks in the company tree first and the brand's own second, and a valid cert
 * on the account is paired with a local key (modulus match, either tier) and
 * exported. Apple only issues so many certificates, and a second one for a type
 * that already has a valid cert is a cert nobody asked for.
 *
 * Per cert type in certificates.providers.apple.certificates:
 *   - valid cert on the account + a paired key  -> export the .p12 (reuse)
 *   - valid cert on the account + NO paired key -> ERROR naming the type, the
 *     expected key path and the fix. No create call happens on that path
 *     ([#891](https://github.com/Omega-JS-Stack/omega/issues/891))
 *   - no valid cert + automatable -> create via CSR (reused across runs, the
 *     private key pairs with the issued cert) + download + export
 *   - no valid cert + manual (DEVELOPER_ID_*) -> validate the local .cer;
 *     missing/expired prints the portal URL + save path and warns (Apple
 *     requires Account Holder login to issue these, no API path)
 *
 * Every configured type then reports its VALIDITY through the ONE expiry
 * reader (`@omega.js/devkit/certs`): fine, under 30 days warns, expired errors.
 * A type that cannot produce a .p12 is an ERROR, never a "synced" count: an
 * unsigned mac build is not a build this framework ships.
 *
 * After the loop, exported .p12 files import into the macOS login keychain
 * (best-effort, config-listed types only, never in dry-run).
 */
const { join } = require('node:path');
const chalk = require('chalk').default;
const { certificateExpiry, EXPIRY_WARN_DAYS } = require('@omega.js/devkit/certs');
const { catchAgreements } = require('../lib/apple-api.js');
const { canPrompt } = require('../../../lib/run-gates.js');
const { runManualCertWalkthrough } = require('../lib/manual-walkthrough.js');

const {
  listCertificates,
  downloadCertificate,
  createCertificate,
  getCSRContent,
  exportToP12,
  findValidCertificate,
  validateManualCertificate,
} = require('../lib/certificate-manager.js');

const APPLE_PORTAL_CERTIFICATES_URL = 'https://developer.apple.com/account/resources/certificates/list';

/** Trim an API cert record to the fields the later operations need. */
function trimCert(cert) {
  return {
    id: cert.id,
    certificateType: cert.attributes.certificateType,
    expirationDate: cert.attributes.expirationDate,
  };
}

/**
 * What an export result MEANS for a configured type. `current` and a real
 * export are both signing material; anything else is a rung that cannot produce
 * it, which is an error with the fix in it (#891).
 *
 * @param {string} type - Certificate type.
 * @param {object} result - The exportToP12 return.
 * @param {object} tree - The brand's signing tree.
 * @returns {string|null} The failure message, or null when the type has its .p12.
 */
function exportFailure(type, result, tree) {
  if (result.exported || result.reason === 'current') {
    return null;
  }

  if (result.reason === 'no-paired-key') {
    return `${type}: the certificate is valid but no private key in the signing tree pairs with it, so no .p12 can be exported. `
      + `Copy csr/${type}/private.key from the machine whose CSR created it into ${tree.writeDir}, `
      + `or revoke the certificate at ${APPLE_PORTAL_CERTIFICATES_URL} and re-run to issue one from a CSR this machine holds.`;
  }

  if (result.reason === 'no-certificate') {
    return `${type}: no .cer in the signing tree (${tree.readDirs.join(' or ')}), so no .p12 can be exported.`;
  }

  return `${type}: .p12 export failed (${result.reason}).`;
}

/**
 * Print the export outcome in the walk's voice and hand back the failure, if
 * any.
 */
function reportExport(type, result, tree) {
  if (result.exported) {
    console.log(`        ${chalk.green('✓')} Exported .p12 ${chalk.gray(result.p12Path)}`);
  }

  const failure = exportFailure(type, result, tree);
  if (failure) {
    console.log(`        ${chalk.red('✗')} ${failure}`);
  }

  return failure;
}

/**
 * The validity rung for a type's local certificate: one line per type, always
 * (a cert nobody measured is a cert that expires in CI). Three outcomes, the
 * SAME three the desktop's validate-certs step reports, over the same reader.
 *
 * @param {string} type - Certificate type.
 * @param {string} certPath - The local .cer.
 * @returns {{ level: 'success'|'warned'|'error', message: string|null }}
 */
function reportValidity(type, certPath) {
  let expiry;
  try {
    expiry = certificateExpiry(certPath);
  } catch (error) {
    console.log(`        ${chalk.red('✗')} ${error.message}`);
    return { level: 'error', message: `${type}: ${error.message}` };
  }

  const date = expiry.expiresAt.toISOString().split('T')[0];

  if (expiry.daysLeft < 0) {
    console.log(`        ${chalk.red('✗')} EXPIRED ${date} ${chalk.dim(`(${Math.abs(expiry.daysLeft)} days ago)`)}`);
    return { level: 'error', message: `${type}: the certificate EXPIRED on ${date}. Revoke it at ${APPLE_PORTAL_CERTIFICATES_URL}, delete the local .cer and re-run.` };
  }

  if (expiry.daysLeft < EXPIRY_WARN_DAYS) {
    console.log(`        ${chalk.yellow('⚠')} expires ${date} ${chalk.yellow(`(${expiry.daysLeft} days)`)}`);
    return { level: 'warned', message: `${type}: expires ${date} (${expiry.daysLeft} days left)` };
  }

  console.log(`        ${chalk.dim(`expires ${date} (${expiry.daysLeft} days)`)}`);
  return { level: 'success', message: null };
}

module.exports = catchAgreements(async (context) => {
  const { appleClient, appleSecrets, tree, brandConfig, keychainImport } = context;
  const dryRun = context.options?.dryRun || false;

  const appleConfig = brandConfig.certificates.providers?.apple || {};
  const certConfigs = appleConfig.certificates || [];
  const certificatePassword = appleSecrets.certificatePassword || '';

  // List once; tolerate API failure when manual certs can still be checked
  // locally (accounts without admin API access hit this).
  let existingCerts;
  try {
    existingCerts = await listCertificates(appleClient);
    console.log(`      ${chalk.green('✓')} Found ${existingCerts.length} existing certificates`);
  } catch (error) {
    if (certConfigs.some((c) => c.manual)) {
      console.log(`      ${chalk.yellow('⚠')} Could not list certificates via API: ${chalk.gray(error.message)}`);
      existingCerts = [];
    } else {
      throw error;
    }
  }

  const certificateMap = {};
  const planned = [];
  const failures = [];
  let downloaded = 0;
  let created = 0;
  let synced = 0;
  let manualMissing = 0;
  let expiringSoon = 0;

  // One type's whole verdict: the export, then the validity of what is on disk.
  const finish = (type) => {
    if (dryRun) {
      return;
    }

    const failure = reportExport(type, exportToP12(type, tree, certificatePassword), tree);
    if (failure) {
      failures.push(failure);
    }

    const local = tree.find(`certificates/${type}.cer`);
    if (!local) {
      return;
    }

    const validity = reportValidity(type, local.path);
    if (validity.level === 'error') {
      failures.push(validity.message);
    } else if (validity.level === 'warned') {
      expiringSoon++;
    }
  };

  for (const certConfig of certConfigs) {
    const { type, manual } = certConfig;

    console.log(`      ${chalk.dim('•')} ${chalk.cyan(type)}`);

    const validCert = findValidCertificate(existingCerts, type);

    if (validCert) {
      certificateMap[type] = trimCert(validCert);
      const local = tree.find(`certificates/${type}.cer`);

      if (!local) {
        if (dryRun) {
          console.log(`        ${chalk.cyan('[DRY RUN]')} Would download .cer + export .p12`);
          planned.push(`download ${type}`);
          continue;
        }
        await downloadCertificate(appleClient, validCert.id, tree.path(`certificates/${type}.cer`));
        downloaded++;
      } else {
        const reused = local.source === 'company' ? ` ${chalk.dim('(reused from company)')}` : '';
        console.log(`        ${chalk.green('✓')} Valid cert exists${reused}`);
        synced++;
      }

      finish(type);
      continue;
    }

    if (manual) {
      let validation = validateManualCertificate(tree.find(`certificates/${type}.cer`)?.path);

      // Interactive rescue: only the Account Holder can CREATE Developer ID
      // certs (portal-only, no API path), but the CSR, the download, and the
      // install are ours to automate. Non-interactive runs keep the
      // print-and-warn + converge-on-rerun contract below.
      if (!validation.valid && canPrompt(context.options)) {
        const { installed } = await runManualCertWalkthrough({
          type,
          certPath: tree.path(`certificates/${type}.cer`),
          tree,
          teamId: appleSecrets.teamId,
          ...(context.downloadsDir ? { downloadsDir: context.downloadsDir } : {}),
        });
        if (installed) {
          validation = validateManualCertificate(tree.find(`certificates/${type}.cer`)?.path);
        }
      }

      if (validation.valid) {
        const local = tree.find(`certificates/${type}.cer`);
        const reused = local.source === 'company' ? ` ${chalk.dim('(reused from company)')}` : '';
        console.log(`        ${chalk.green('✓')} Local file valid${reused}`);
        certificateMap[type] = {
          id: 'manual',
          certificateType: type,
          expirationDate: validation.expiresAt.toISOString(),
        };
        synced++;
        finish(type);
      } else {
        console.log(`        ${chalk.red('✗')} ${validation.reason}: Apple requires Account Holder login to issue this type`);
        console.log(`        ${chalk.gray('→')} Download the .cer from ${chalk.cyan(APPLE_PORTAL_CERTIFICATES_URL)}`);
        console.log(`        ${chalk.gray('→')} Save it to ${chalk.gray(tree.path(`certificates/${type}.cer`))} and re-run`);
        manualMissing++;
      }
      continue;
    }

    if (dryRun) {
      console.log(`        ${chalk.cyan('[DRY RUN]')} Would create via CSR + download + export .p12`);
      planned.push(`create ${type}`);
      continue;
    }

    // Nothing valid on the account for this type: minting is the only path
    const csrContent = getCSRContent(type, tree, appleSecrets.teamId);
    const newCert = await createCertificate(appleClient, type, csrContent);
    console.log(`        ${chalk.green('✓')} Created ${chalk.dim(`(expires ${newCert.attributes.expirationDate})`)}`);
    await downloadCertificate(appleClient, newCert.id, tree.path(`certificates/${type}.cer`));
    certificateMap[type] = trimCert(newCert);
    created++;
    finish(type);
  }

  // Import config-listed .p12 files into the login keychain (macOS only), from
  // every tier: a company-managed brand signs with the company's material, and
  // a tier the tree does not hold is a no-op.
  if (!dryRun) {
    for (const dir of tree.readDirs) {
      keychainImport({
        certificatesDir: join(dir, 'certificates'),
        keychainPassword: appleSecrets.keychainPassword,
        certificatePassword,
        allowedTypes: certConfigs.map((c) => c.type),
      });
    }
  }

  const summary = dryRun
    ? { planned }
    : { synced, downloaded, created };
  const counts = {
    ...(manualMissing > 0 ? { manualMissing } : {}),
    ...(expiringSoon > 0 ? { expiringSoon } : {}),
  };

  if (failures.length > 0) {
    console.log(`      ${chalk.red('✗')} ${failures.length} certificate(s) cannot produce signing material`);
    return {
      state: { certificateMap },
      output: { certificates: { ...summary, ...counts, failed: failures.length } },
      status: 'error',
      error: failures.join(' '),
    };
  }

  if (manualMissing > 0 || expiringSoon > 0) {
    const reasons = [
      ...(manualMissing > 0 ? [`${manualMissing} manual cert(s) missing: download them from the Apple Developer portal`] : []),
      ...(expiringSoon > 0 ? [`${expiringSoon} certificate(s) expire within ${EXPIRY_WARN_DAYS} days`] : []),
    ];
    console.log(`      ${chalk.yellow('⚠')} ${reasons.join('; ')}`);
    return {
      state: { certificateMap },
      output: { certificates: { ...summary, ...counts } },
      status: 'warned',
      reason: reasons.join('; '),
    };
  }

  return { state: { certificateMap }, output: { certificates: summary } };
});
