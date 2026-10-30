const BaseTest = require('./base-test');
const { writeJson } = require('@omega.js/devkit/write-json');
const _ = require('lodash');

class RealtimeRulesInJsonTest extends BaseTest {
  getName() {
    return 'realtime rules in JSON';
  }

  async run() {
    return this.self.firebaseJSON?.database?.rules === 'database.rules.json';
  }

  async fix() {
    _.set(this.self.firebaseJSON, 'database.rules', 'database.rules.json');
    writeJson(`${this.self.firebaseProjectPath}/firebase.json`, this.self.firebaseJSON);
  }
}

module.exports = RealtimeRulesInJsonTest;
