/**
 * @omega.js/account, resolved once for the whole backend: the `User` class and
 * the resolvers every service and route reads it through.
 *
 * @omega.js/account is a private workspace package: in the monorepo the bare
 * specifier resolves via the workspace link (and the prepare-package vendor
 * hook rewrites it in dist/), but src/ ships in the tarball UNREWRITTEN and the
 * test corpus deep-requires it in consumers, so the fallback is the copy
 * vendored into dist/, which sits at the same depth from both trees.
 */
let account;

try {
  account = require('@omega.js/account');
} catch (e) {
  account = require('../../../dist/vendor/account/index.js');
}

module.exports = account;
