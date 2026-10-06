// Public test API: what consumers see. A case file exports its spec through
// defineCases; a helper outside a case body asserts with the same expect every
// run(ctx) receives: const { defineCases, expect } = require('@omega.js/backend/test');
// The forms and the whole ctx: docs/backend/test-framework.md.

module.exports = {
  defineCases: require('@omega.js/devkit/test/define-cases'),
  expect: require('@omega.js/devkit/test/expect'),
};
