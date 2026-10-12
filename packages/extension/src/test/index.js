// The public test door: `const { defineCases, expect } = require('@omega.js/extension/test');`
// A boot case is `{ name, run(ctx) }` like any other, with `ctx.extension` and a fresh `ctx.page`;
// a suite that runs inside a built view declares `layer: 'boot'` and `view: '<name>'`, where
// `ctx.page` is the view's `window`. The full reference: docs/extension/test-framework.md.

module.exports = {
  defineCases: require('@omega.js/devkit/test/define-cases'),
  expect: require('@omega.js/devkit/test/expect'),
};
