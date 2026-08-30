const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');

class EnvRuntimeConfigDeprecatedTest extends BaseTest {
  getName() {
    return 'does not use deprecated RUNTIME_CONFIG';
  }

  async run() {
    // The authored .env (target root) — OPTIONAL and human-written since #678:
    // it is the per-key override over the brand root's, and no machine writes it
    const envPath = `${this.self.firebaseProjectPath}/.env`;
    const existingContent = jetpack.read(envPath);

    // If no .env file, pass (other test will handle that)
    if (!existingContent) {
      return true;
    }

    // Check if RUNTIME_CONFIG exists in the file
    const hasRuntimeConfig = existingContent.split('\n').some(line => {
      const trimmed = line.trim();
      // Skip comments
      if (trimmed.startsWith('#')) {
        return false;
      }
      // Check for RUNTIME_CONFIG= at start of line
      return trimmed.startsWith('RUNTIME_CONFIG=');
    });

    // Return true (pass) if RUNTIME_CONFIG is NOT found
    return !hasRuntimeConfig;
  }

  async fix() {
    throw new Error(
      'RUNTIME_CONFIG is deprecated and must be manually migrated.\n' +
      '  The new format uses individual environment variables:\n' +
      '    OMEGA_ADMIN_KEY=\n' +
      '    OMEGA_NAMESPACE=\n' +
      '    GH_TOKEN=\n' +
      '  Please update your .env file manually and remove RUNTIME_CONFIG.'
    );
  }
}

module.exports = EnvRuntimeConfigDeprecatedTest;
