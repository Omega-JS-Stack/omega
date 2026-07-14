const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;
const path = require('path');
const { loadConfig, hasOmegaConfig, findBrandRoot } = require('@omega.js/config');

// The framework template seeds STANDALONE consumers at the app root; brand
// apps carry NO app-layer file at all — brand `targets.*` is the per-target
// home and the stage step composes the runtime file (src/dist pillar).
const TEMPLATES_DIR = path.resolve(__dirname, '../../../../templates');

class OmegaConfigTest extends BaseTest {
  getName() {
    return 'using proper config/omega.json5';
  }

  /**
   * The shared schema is the required-key oracle (dogfood friction #5): the
   * RESOLVED config (app ← brand root ← defaults, targets overlaid) must load
   * and validate. The template stopped being a requirements list — its every
   * leaf demanded keys (brand.address, brand.images, …) the canonical schema
   * calls optional, and a brand app resolves shared sections from the brand
   * root that a raw file walk can never see.
   */
  async run() {
    // A brand app legitimately has no file of its own — the brand root's
    // omega.json5 is the config (loadConfig rides it alone since cp121c)
    if (!hasOmegaConfig(this.self.firebaseProjectPath) && !findBrandRoot(this.self.firebaseProjectPath)) {
      this.errors = ['config/omega.json5 is missing (standalone apps carry config/omega.json5 at the app root)'];
      return false;
    }

    try {
      const loaded = loadConfig(this.self.firebaseProjectPath, 'backend');
      this.errors = (loaded.errors || []).map((error) => (typeof error === 'string' ? error : error.message || JSON.stringify(error)));
    } catch (e) {
      this.errors = [e.message];
    }

    return this.errors.length === 0;
  }

  async fix() {
    const ui = require('../../utils/ui');

    // STANDALONE app with a missing/empty config → seed the full template at
    // the app root (the same escape hatch every target uses). Brand apps have
    // nothing to seed — their config IS the brand file.
    if (!this.context.hasContent(this.self.omegaConfigJSON)
      && !findBrandRoot(this.self.firebaseProjectPath)) {
      jetpack.copy(
        path.join(TEMPLATES_DIR, 'config', 'omega.json5'),
        `${this.self.firebaseProjectPath}/config/omega.json5`,
        { overwrite: true },
      );
      this.restage();

      // Re-check: a fresh seed resolves clean.
      if (await this.run()) {
        return;
      }
    }

    ui.note(`Fix ${chalk.bold('config/omega.json5')} — the resolved config (app ← brand root) fails the shared schema:`, 3);
    for (const message of this.errors) {
      console.log(`${ui.indent(4)}${chalk.red('•')} ${message}`);
    }

    const preview = this.errors.slice(0, 8);
    const summaryDetails = [
      chalk.dim(`Resolve ${chalk.bold(this.errors.length)} config error(s) in config/omega.json5:`),
      ...preview.map((message) => `${chalk.red('•')} ${message}`),
    ];
    if (this.errors.length > preview.length) {
      summaryDetails.push(chalk.dim(`…and ${this.errors.length - preview.length} more (see list above)`));
    }

    const error = new Error('config/omega.json5 fails the shared schema');
    error.summaryDetails = summaryDetails;
    throw error;
  }
}

module.exports = OmegaConfigTest;
