const BaseTest = require('./base-test');
const { missingBackendTools } = require('../../utils/project-type');
const { machineToolLine } = require('@omega.js/devkit/machine-tools');

class FirebaseCliTest extends BaseTest {
  getName() {
    return 'firebase CLI is installed';
  }

  getWarning() {
    return [machineToolLine(this.miss)];
  }

  async run() {
    this.miss = missingBackendTools(this.self.firebaseProjectPath).find((miss) => miss.name === 'firebase');
    return this.miss ? 'warn' : true;
  }
}

module.exports = FirebaseCliTest;
