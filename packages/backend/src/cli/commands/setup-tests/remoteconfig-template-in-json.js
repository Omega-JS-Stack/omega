const BaseTest = require('./base-test');
const { writeJson } = require('@omega.js/devkit/write-json');
const _ = require('lodash');

const ENABLED = false;

class RemoteconfigTemplateInJsonTest extends BaseTest {
  getName() {
    return 'remoteconfig template in JSON';
  }

  async run() {
    if (ENABLED) {
      return this.self.firebaseJSON?.remoteconfig?.template === 'remoteconfig.template.json';
    }

    return !this.self.firebaseJSON?.remoteconfig;
  }

  async fix() {
    if (ENABLED) {
      _.set(this.self.firebaseJSON, 'remoteconfig.template', 'remoteconfig.template.json');
    } else {
      delete this.self.firebaseJSON.remoteconfig;
    }

    writeJson(`${this.self.firebaseProjectPath}/firebase.json`, this.self.firebaseJSON);
  }
}

module.exports = RemoteconfigTemplateInJsonTest;
