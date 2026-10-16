// Public test API: what a brand's web suites require. A case file exports its
// spec through defineCases; a helper outside a case body asserts with the same
// expect every run(ctx) receives; a page module loads through loadModule:
// const { defineCases, expect, loadModule } = require('@omega.js/web/test');
// A framework dependency comes from web too: require('@omega.js/web/test').require('esbuild').

module.exports = {
  defineCases: require('@omega.js/devkit/test/define-cases'),
  expect: require('@omega.js/devkit/test/expect'),
  // The framework's own module context: a brand cannot resolve its dependencies
  require(name) {
    return require(name);
  },
  loadModule: require('./load-module.js').loadModule,
};
