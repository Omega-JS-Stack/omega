const { generateKeyPairSync } = require('node:crypto');
const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

/**
 * Build a FAKE service-account.json for an emulator-only demo-* project:
 * shaped like the real thing (firebase-admin's cert() parses it) but with a
 * throwaway locally-generated RSA key — no live credential exists for a
 * project that doesn't exist. Real projects still require the downloaded
 * file (friction #10).
 */
function buildDemoServiceAccount(projectId) {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return {
    type: 'service_account',
    project_id: projectId,
    private_key_id: 'demo-local-throwaway',
    private_key: privateKey,
    client_email: `demo@${projectId}.iam.gserviceaccount.com`,
    client_id: '0',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/demo%40${projectId}.iam.gserviceaccount.com`,
  };
}

class ServiceAccountTest extends BaseTest {
  getName() {
    return 'has correct service-account.json';
  }

  async run() {
    // Source chain (src/dist pillar): target root (standalone) → brand
    // .omega/secrets/ (the firebase manage service mints it there); the
    // stage step carries whichever exists into dist/
    const serviceAccount = jetpack.read(this.resolveSaPath());

    // Make sure the service account exists
    if (!serviceAccount) {
      console.error(chalk.red('Missing service-account.json'));
      return false;
    }

    return true;
  }

  /** First existing SA in the source chain; target root as the write default. */
  resolveSaPath() {
    const { findBrandRoot } = require('@omega.js/config');
    const path = require('path');
    const targetRootPath = `${this.self.firebaseProjectPath}/service-account.json`;
    const brandRoot = findBrandRoot(this.self.firebaseProjectPath);
    const brandPath = brandRoot ? path.join(brandRoot, '.omega', 'secrets', 'service-account.json') : null;

    if (jetpack.exists(targetRootPath)) return targetRootPath;
    if (brandPath && jetpack.exists(brandPath)) return brandPath;
    return targetRootPath;
  }

  async fix() {
    // Emulator-only demo-* projects get an auto-generated fake — the runtime
    // only reads the file on the PRODUCTION branch, but setup and tooling
    // expect it to exist.
    if (this.isDemoProject) {
      const saPath = `${this.self.firebaseProjectPath}/service-account.json`;
      jetpack.write(saPath, `${JSON.stringify(buildDemoServiceAccount(this.self.projectId), null, 2)}\n`);
      this.restage();
      console.log(chalk.green(`  ✓ Generated fake service-account.json for demo project ${chalk.bold(this.self.projectId)} (throwaway local key)`));
      return;
    }

    console.log(chalk.red(`There is no automatic fix for this check.`));
    console.log(chalk.red(`Please install a service account --> ` + chalk.yellow.red(`${this.self.projectUrl}/settings/serviceaccounts/adminsdk`)));
    throw new Error('Missing or incorrect service-account.json');
  }
}

module.exports = ServiceAccountTest;
module.exports.buildDemoServiceAccount = buildDemoServiceAccount;
