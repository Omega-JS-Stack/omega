// Consumer gulpfile — the framework's gulp pipeline, resolved through the
// require climb so it works wherever npm hoists the framework (brand-root
// node_modules in a monorepo, local node_modules standalone). The old
// scripts hardcoded ./node_modules/@omega.js/extension/... and broke under
// workspace hoisting (dogfood friction #14).
module.exports = require('@omega.js/extension/gulp');
