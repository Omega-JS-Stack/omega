/**
 * Ensure the account's signing certificates exist and are on disk. One set
 * of certificates signs all of an Apple Developer account's apps, so this
 * reconciles the account, not the brand.
 *
 * Per cert type in certificates.apple.certificates:
 *   - valid cert on the account → download the .cer if the local file is
 *     missing (delete it to force a re-download), refresh the .p12 if stale
 *   - no valid cert + automatable → create via CSR (reused across runs —
 *     the private key pairs with the issued cert) + download + export
 *   - no valid cert + manual (DEVELOPER_ID_*) → validate the local .cer;
 *     missing/expired prints the portal URL + save path and warns (Apple
 *     requires Account Holder login to issue these — no API path)
 *
 * After the loop, exported .p12 files import into the macOS login keychain
 * (best-effort, config-listed types only, never in dry-run).
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

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

/** Trim an API cert record to the durable fields state.json keeps. */
function trimCert(cert) {
  return {
    id: cert.id,
    certificateType: cert.attributes.certificateType,
    expirationDate: cert.attributes.expirationDate,
  };
}

module.exports = async (context) => {
  const { appleClient, appleSecrets, appleDir, brandConfig, keychainImport } = context;
  const dryRun = context.options?.dryRun || false;

  const appleConfig = brandConfig.certificates.apple || {};
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
  let downloaded = 0;
  let created = 0;
  let synced = 0;
  let manualMissing = 0;

  for (const certConfig of certConfigs) {
    const { type, manual } = certConfig;
    const certPath = join(appleDir, 'certificates', `${type}.cer`);

    console.log(`      ${chalk.dim('•')} ${chalk.cyan(type)}`);

    const validCert = findValidCertificate(existingCerts, type);

    if (validCert) {
      certificateMap[type] = trimCert(validCert);

      if (!jetpack.exists(certPath)) {
        if (dryRun) {
          console.log(`        ${chalk.cyan('[DRY RUN]')} Would download .cer + export .p12`);
          planned.push(`download ${type}`);
        } else {
          await downloadCertificate(appleClient, validCert.id, certPath);
          exportToP12(type, appleDir, certificatePassword);
          downloaded++;
        }
      } else {
        console.log(`        ${chalk.green('✓')} Valid cert exists ${chalk.dim(`(expires ${validCert.attributes.expirationDate})`)}`);
        if (!dryRun) {
          exportToP12(type, appleDir, certificatePassword); // no-op unless the .p12 is stale
        }
        synced++;
      }
      continue;
    }

    if (manual) {
      const validation = validateManualCertificate(certPath);
      if (validation.valid) {
        const expDate = validation.expirationDate.toISOString().split('T')[0];
        console.log(`        ${chalk.green('✓')} Local file valid ${chalk.dim(`(expires ${expDate})`)}`);
        if (!dryRun) {
          exportToP12(type, appleDir, certificatePassword);
        }
        certificateMap[type] = {
          id: 'manual',
          certificateType: type,
          expirationDate: validation.expirationDate.toISOString(),
        };
        synced++;
      } else {
        console.log(`        ${chalk.red('✗')} ${validation.reason} — Apple requires Account Holder login to issue this type`);
        console.log(`        ${chalk.gray('→')} Download the .cer from ${chalk.cyan(APPLE_PORTAL_CERTIFICATES_URL)}`);
        console.log(`        ${chalk.gray('→')} Save it to ${chalk.gray(certPath)} and re-run`);
        manualMissing++;
      }
      continue;
    }

    if (dryRun) {
      console.log(`        ${chalk.cyan('[DRY RUN]')} Would create via CSR + download + export .p12`);
      planned.push(`create ${type}`);
      continue;
    }

    const csrContent = getCSRContent(type, appleDir, appleSecrets.teamId);
    const newCert = await createCertificate(appleClient, type, csrContent);
    console.log(`        ${chalk.green('✓')} Created ${chalk.dim(`(expires ${newCert.attributes.expirationDate})`)}`);
    await downloadCertificate(appleClient, newCert.id, certPath);
    exportToP12(type, appleDir, certificatePassword);
    certificateMap[type] = trimCert(newCert);
    created++;
  }

  // Import config-listed .p12 files into the login keychain (macOS only)
  if (!dryRun) {
    keychainImport({
      certificatesDir: join(appleDir, 'certificates'),
      keychainPassword: appleSecrets.keychainPassword,
      certificatePassword,
      allowedTypes: certConfigs.map((c) => c.type),
    });
  }

  const summary = dryRun
    ? { planned }
    : { synced, downloaded, created };

  if (manualMissing > 0) {
    console.log(`      ${chalk.yellow('⚠')} ${manualMissing} manual cert(s) missing — download from the Apple Developer portal and re-run`);
    return {
      state: { certificateMap },
      output: { certificates: { ...summary, manualMissing } },
      status: 'warned',
    };
  }

  return { state: { certificateMap }, output: { certificates: summary } };
};
