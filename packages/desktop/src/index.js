// Default export: the build-time entry (version + the build module). Each Electron
// process imports its own ready-made instance from its subpath instead:
//   require('@omega.js/desktop/main')
//   import omega from '@omega.js/desktop/renderer'
//   require('@omega.js/desktop/preload')
const package = require('../package.json');

module.exports = {
  version: package.version,
  build:   require('./build.js'),
};
