const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');

/**
 * The APP MANIFEST (app-root package.json — scripts + runtime deps; src/dist
 * pillar) is well-formed, and the STAGED functions/package.json derives from
 * it correctly (Cloud Functions reads main/engines/dependencies from the
 * staged copy).
 */
class FunctionsPackageTest extends BaseTest {
  getName() {
    return 'app package.json + staged functions manifest';
  }

  async run() {
    const app = this.context.package;
    if (!app || !app.dependencies || !app.version || app.private !== true) {
      return false;
    }

    // The staged derivation (written by the stage step that ran before the
    // checks): main + engines + the app's runtime deps, nothing else
    const staged = jetpack.read(`${this.self.firebaseProjectPath}/functions/package.json`, 'json');
    return !!staged
      && staged.main === 'index.js'
      && !!(staged.engines && staged.engines.node)
      && JSON.stringify(staged.dependencies) === JSON.stringify(app.dependencies)
      && staged.scripts === undefined;
  }

  async fix() {
    this.context.package.dependencies = this.context.package.dependencies || {};
    this.context.package.version = this.context.package.version || '0.0.1';
    this.context.package.private = true;

    jetpack.write(`${this.self.firebaseProjectPath}/package.json`, JSON.stringify(this.context.package, null, 2));
    this.restage();
  }
}

module.exports = FunctionsPackageTest;
