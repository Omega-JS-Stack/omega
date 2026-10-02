const BaseTest = require('./base-test');
const { missingBackendTools } = require('../../utils/project-type');
const { machineToolLine } = require('@omega.js/devkit/machine-tools');

class JavaInstalledTest extends BaseTest {
  getName() {
    return 'Java is installed (required by Firebase emulators)';
  }

  getWarning() {
    return [machineToolLine(this.miss)];
  }

  async run() {
    this.miss = missingBackendTools(this.self.firebaseProjectPath).find((miss) => miss.name === 'java');
    return this.miss ? 'warn' : true;
  }
}

module.exports = JavaInstalledTest;
