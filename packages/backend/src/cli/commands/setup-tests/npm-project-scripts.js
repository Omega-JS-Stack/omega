const BaseTest = require('./base-test');

class NpmProjectScriptsTest extends BaseTest {
  getName() {
    return 'has all @omega.js/backend project scripts';
  }

  async run() {
    const bemPackage = require('../../../../package.json');
    const projectScripts = bemPackage.projectScripts || {};
    const consumerScripts = this.context.package.scripts || {};

    // Check if all projectScripts exist in consumer
    for (const [name, command] of Object.entries(projectScripts)) {
      if (consumerScripts[name] !== command) {
        return false;
      }
    }

    return true;
  }

  async fix() {
    const bemPackage = require('../../../../package.json');
    const projectScripts = bemPackage.projectScripts || {};

    // Fresh-read first: npm-driven fixes rewrote the manifest earlier in
    // this run — writing the boot-time snapshot would clobber their installs
    // (cp195 journey catch: this exact fix erased firebase-admin/functions)
    const manifest = this.readTargetManifest();
    manifest.scripts = manifest.scripts || {};

    // Copy all projectScripts to consumer
    for (const [name, command] of Object.entries(projectScripts)) {
      manifest.scripts[name] = command;
    }

    this.writeTargetManifest();
  }
}

module.exports = NpmProjectScriptsTest;
