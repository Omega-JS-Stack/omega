const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');

const DIRS = [
  'routes',
  'schemas',
  'hooks/auth',
  'hooks/cron/daily',
];

class ProjectDirectoriesTest extends BaseTest {
  getName() {
    return 'project directories exist';
  }

  async run() {
    const self = this.self;
    // The AUTHORED tree (src/dist pillar): consumer code lives in src/, the
    // stage step mirrors it into functions/
    const srcDir = `${self.firebaseProjectPath}/src`;

    for (const dir of DIRS) {
      jetpack.dir(`${srcDir}/${dir}`);
    }

    return true;
  }

  async fix() {
    throw new Error('No automatic fix available for this test');
  }
}

module.exports = ProjectDirectoriesTest;
