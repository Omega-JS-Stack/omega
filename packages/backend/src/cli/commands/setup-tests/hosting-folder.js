const BaseTest = require('./base-test');
const { writeJson } = require('@omega.js/devkit/write-json');

class HostingFolderTest extends BaseTest {
  getName() {
    return 'hosting is set to dedicated folder in JSON';
  }

  async run() {
    const self = this.self;
    const hosting = self.firebaseJSON?.hosting || {};
    return (hosting.public && (hosting.public === 'public' || hosting.public !== '.'));
  }

  async fix() {
    const self = this.self;
    self.firebaseJSON.hosting = self.firebaseJSON.hosting || {};
    self.firebaseJSON.hosting.public = 'public';
    writeJson(`${self.firebaseProjectPath}/firebase.json`, self.firebaseJSON);
  }
}

module.exports = HostingFolderTest;
