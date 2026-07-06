const BaseTest = require('./base-test');
const { writePublicFiles } = require('../../utils/public-files');

class PublicHtmlFilesTest extends BaseTest {
  getName() {
    return 'create public .html files';
  }

  async run() {
    const self = this.self;

    writePublicFiles(self.firebaseProjectPath, { url: self.omegaConfigJSON.brand.url, overwrite: true });

    return true;
  }

  async fix() {
    throw new Error('No automatic fix available for this test');
  }
}

module.exports = PublicHtmlFilesTest;
