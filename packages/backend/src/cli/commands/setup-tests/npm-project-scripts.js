const BaseTest = require('./base-test');
const { frameworkOwnedScripts } = require('../../utils/project-type');

class NpmProjectScriptsTest extends BaseTest {
  getName() {
    return 'has all @omega.js/backend project scripts';
  }

  async run() {
    // frameworkOwnedScripts is the ONE home of which keys this framework owns
    // and at what value (#689) — the same call ensure-target's scaffold makes,
    // so a check and a verb can never disagree about a target's scripts.
    const projectScripts = frameworkOwnedScripts(this.self.firebaseProjectPath);
    const consumerScripts = this.context.package.scripts || {};

    for (const [name, command] of Object.entries(projectScripts)) {
      if (consumerScripts[name] !== command) {
        return false;
      }
    }

    return true;
  }

  async fix() {
    const projectScripts = frameworkOwnedScripts(this.self.firebaseProjectPath);

    // Fresh-read first: npm-driven fixes rewrote the manifest earlier in
    // this run — writing the boot-time snapshot would clobber their installs
    // (cp195 journey catch: this exact fix erased firebase-admin/functions)
    const manifest = this.readTargetManifest();
    manifest.scripts = manifest.scripts || {};

    for (const [name, command] of Object.entries(projectScripts)) {
      manifest.scripts[name] = command;
    }

    this.writeTargetManifest();
  }
}

module.exports = NpmProjectScriptsTest;
