/**
 * macOS keychain import for the exported .p12 files, kept fully
 * non-interactive:
 *
 *   1. .p12 password — Sonoma+ rejects empty-password .p12 with "MAC
 *      verification failed", so exports always carry CSC_KEY_PASSWORD.
 *   2. Trusted tools (-T) — codesign/productbuild/productsign/xcodebuild
 *      are whitelisted so they can use the key without a GUI prompt.
 *   3. Partition list — with APPLE_KEYCHAIN_PASSWORD provided, the
 *      "<tool> wants to use the keychain" prompt is suppressed entirely;
 *      without it, it fires once on first signing then never again.
 *   4. Allowed-types filter — only cert types currently in config import;
 *      .p12 files for deprecated types stay on disk but are skipped.
 *
 * Failures print manual-import guidance (omega-manager auto-opened
 * Keychain Access — the port stays non-interactive). Non-macOS platforms
 * skip entirely.
 */
const { execSync } = require('node:child_process');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

/**
 * Import .p12 files into the macOS login keychain (best-effort).
 *
 * @param {Object} options
 * @param {string} options.certificatesDir - Directory containing .p12 files
 * @param {string} [options.keychainPassword] - Mac login password (unlock + partition list)
 * @param {string} [options.certificatePassword] - Password on the .p12 files
 * @param {string[]} [options.allowedTypes] - Cert types (filename sans .p12) to import
 * @returns {{ imported: number, skipped: number, failed: number }}
 */
function importP12Files({ certificatesDir, keychainPassword = null, certificatePassword = '', allowedTypes = null }) {
  if (process.platform !== 'darwin') {
    console.log(`      ${chalk.dim('⊘ Keychain import skipped (not macOS)')}`);
    return { imported: 0, skipped: 0, failed: 0 };
  }

  if (!jetpack.exists(certificatesDir)) {
    return { imported: 0, skipped: 0, failed: 0 };
  }

  let p12Files = jetpack.find(certificatesDir, { matching: '*.p12' });

  if (allowedTypes && Array.isArray(allowedTypes)) {
    const allowSet = new Set(allowedTypes);
    p12Files = p12Files.filter((p) => allowSet.has(p.split('/').pop().replace('.p12', '')));
  }

  if (p12Files.length === 0) {
    return { imported: 0, skipped: 0, failed: 0 };
  }

  let imported = 0;
  let skipped = 0;
  const failed = [];

  // Pre-unlock when the login password was provided — `security import`
  // fails on a locked keychain.
  if (keychainPassword) {
    try {
      execSync(
        `security unlock-keychain -p "${keychainPassword}" ~/Library/Keychains/login.keychain-db`,
        { stdio: 'pipe' },
      );
    } catch {
      // Continue — failures below print manual guidance.
    }
  }

  // -T whitelists specific signing binaries (finer-grained than -A).
  const trustedTools = [
    '/usr/bin/codesign',
    '/usr/bin/productbuild',
    '/usr/bin/productsign',
    '/usr/bin/security',
    '/usr/bin/xcodebuild',
  ];
  const tFlags = trustedTools.map((tool) => `-T "${tool}"`).join(' ');

  for (const p12Path of p12Files) {
    const certType = p12Path.split('/').pop().replace('.p12', '');

    try {
      execSync(
        `security import "${p12Path}" -k ~/Library/Keychains/login.keychain-db -P "${certificatePassword}" ${tFlags}`,
        { stdio: 'pipe' },
      );
      console.log(`      ${chalk.green('✓')} Imported ${chalk.cyan(certType)} to Keychain`);
      imported++;
    } catch (error) {
      const message = error?.message || '';
      if (message.includes('already exists') || message.includes('duplicate')) {
        console.log(`      ${chalk.dim(`ℹ ${certType} already in Keychain`)}`);
        skipped++;
      } else {
        failed.push({ path: p12Path, type: certType, message });
      }
    }
  }

  // Suppress the per-signing keychain prompt (macOS Sierra+ requirement) —
  // without this, codesign prompts for the login keychain password the
  // first time it uses each imported private key.
  if (imported > 0 && keychainPassword) {
    try {
      execSync(
        `security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "${keychainPassword}" ~/Library/Keychains/login.keychain-db`,
        { stdio: 'pipe' },
      );
    } catch {
      // Non-fatal — codesign may prompt once on first use.
    }
  }

  if (failed.length > 0) {
    console.log(`      ${chalk.yellow('⚠')} ${failed.length} cert(s) failed keychain import — import manually:`);
    for (const { path, type, message } of failed) {
      console.log(`      ${chalk.gray('→')} ${chalk.cyan(type)}: ${chalk.gray(message.split('\n')[0])}`);
      console.log(`        ${chalk.gray(`double-click ${path} (password: ${certificatePassword || 'empty'})`)}`);
    }
  }

  return { imported, skipped, failed: failed.length };
}

module.exports = { importP12Files };
