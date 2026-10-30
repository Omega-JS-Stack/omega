const BaseTest = require('./base-test');
const { writeJson } = require('@omega.js/devkit/write-json');
const _ = require('lodash');

class StorageRulesInJsonTest extends BaseTest {
  getName() {
    return 'storage rules in JSON';
  }

  async run() {
    return this.self.firebaseJSON?.storage?.rules === 'storage.rules';
  }

  async fix() {
    _.set(this.self.firebaseJSON, 'storage.rules', 'storage.rules');
    writeJson(`${this.self.firebaseProjectPath}/firebase.json`, this.self.firebaseJSON);
  }
}

module.exports = StorageRulesInJsonTest;
