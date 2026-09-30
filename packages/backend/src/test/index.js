// Public test API: what consumers see. A case file exports its spec through
// defineCases, and the runner hands every run(ctx) its assertions as ctx.assert:
//   const { defineCases } = require('@omega.js/backend/test');
// The forms and the whole ctx: docs/backend/test-framework.md.

module.exports = {
  defineCases: require('@omega.js/devkit/test/define-cases'),
};
