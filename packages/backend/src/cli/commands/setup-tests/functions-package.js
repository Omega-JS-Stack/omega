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
    // Fresh-read first: npm-driven fixes rewrote the manifest earlier in
    // this run — mutating the boot-time snapshot would clobber their work
    const app = this.readAppManifest();
    app.dependencies = app.dependencies || {};
    app.version = app.version || '0.0.1';
    app.private = true;

    this.writeAppManifest();
    this.restage();
  }
}

module.exports = FunctionsPackageTest;
