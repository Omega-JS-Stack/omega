const BaseTest = require('./base-test');
const { writeJson } = require('@omega.js/devkit/write-json');
const _ = require('lodash');

class FirestoreIndexesInJsonTest extends BaseTest {
  getName() {
    return 'firestore indexes in JSON';
  }

  async run() {
    return this.self.firebaseJSON?.firestore?.indexes === 'firestore.indexes.json';
  }

  async fix() {
    _.set(this.self.firebaseJSON, 'firestore.indexes', 'firestore.indexes.json');
    writeJson(`${this.self.firebaseProjectPath}/firebase.json`, this.self.firebaseJSON);
  }
}

module.exports = FirestoreIndexesInJsonTest;
