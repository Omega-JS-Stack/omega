// Public test API: what a brand's web suites require. A case file exports its
// spec through defineCases; a helper outside a case body asserts with the same
// expect every run(ctx) receives: const { defineCases, expect } = require('@omega.js/web/test');

module.exports = {
  defineCases: require('@omega.js/devkit/test/define-cases'),
  expect: require('@omega.js/devkit/test/expect'),
};
