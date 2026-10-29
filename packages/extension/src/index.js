// Default export: the build-time entry (version + the build module). Each extension
// context imports its own ready-made instance from its subpath instead:
//   import omega from '@omega.js/extension/background'
//   import omega from '@omega.js/extension/popup'
const package = require('../package.json');

module.exports = {
  version: package.version,
  build:   require('./build.js'),

  // Load a package from @omega.js/extension's own module context, the door a consumer
  // hook running under plain node uses for a dependency it does not declare itself.
  require(name) {
    return require(name);
  },
};
