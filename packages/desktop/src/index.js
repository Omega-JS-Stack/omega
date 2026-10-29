// Default export: the build-time entry (version + the build module). Each Electron
// process imports its own ready-made instance from its subpath instead:
//   require('@omega.js/desktop/main')
//   import omega from '@omega.js/desktop/renderer'
//   require('@omega.js/desktop/preload')
const package = require('../package.json');

module.exports = {
  version: package.version,
  build:   require('./build.js'),

  // Load a package from @omega.js/desktop's own module context, the door a consumer
  // hook running under plain node uses for a dependency it does not declare itself.
  require(name) {
    return require(name);
  },
};
