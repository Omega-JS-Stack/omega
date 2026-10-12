// Public test API: `const { defineCases, expect } = require('@omega.js/desktop/test')`.
// A case is `{ name, run(ctx) }` on every layer; a boot case's ctx adds `omega`, `projectRoot`,
// `appRoot`, `frameworkDistRoot` and `distSnapshotBefore`. A boot suite with `view: '<name>'`
// runs in that built view's window, where `ctx.page` is the page's `window`.
module.exports = {
  defineCases: require('@omega.js/devkit/test/define-cases'),
  expect: require('@omega.js/devkit/test/expect'),
};
