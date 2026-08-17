/**
 * User — thin wrapper over @omega.js/account, the single source of truth for
 * the OMEGA user/account schema (shared with @omega.js/client, so a doc resolved
 * here is byte-identical to one resolved on the frontend).
 *
 * @omega.js/backend's contribution is injecting the real value generators for the
 * '$uuid'/'$randomId'/'$apiKey' schema tokens — the frontend injects none and
 * those fields resolve to null (real values always come from the backend).
 * API unchanged:
 *   new User(Manager, settings).properties
 *   User.resolveSubscription(accountOrUserInstance)
 */
const uuid4 = require('uuid').v4;
const UIDGenerator = require('uid-generator');
const uidgen = new UIDGenerator(256);

// @omega.js/account is a private workspace package: in the monorepo the bare
// specifier resolves via the workspace link (and the prepare-package vendor
// hook rewrites it in dist/), but src/ ships in the tarball UNREWRITTEN and
// the test corpus deep-requires it in consumers — so fall back to the copy
// vendored into dist/, which sits at the same depth from both trees.
let account;
try {
  account = require('@omega.js/account');
} catch (e) {
  account = require('../../../dist/vendor/account/index.js');
}

function User(Manager, settings) {
  const self = this;

  self.Manager = Manager;

  settings = settings || {};

  self.properties = account.resolveAccount(settings, {
    generators: {
      uuid: () => `${uuid4()}`,
      randomId: () => Manager.Utilities().randomId({ size: 8 }),
      apiKey: () => `${uidgen.generateSync()}`,
    },
  });

  return self;
}

User.resolveSubscription = account.resolveSubscription;

// The schema's own EMPTY discount node, which is what a CLEARED discount is
// ([#333](https://github.com/Omega-JS-Stack/omega/issues/333)). The webhook
// pipeline clears the node with a MERGE write, so every field has to be named or
// half of the old claim survives it. Read off the resolver rather than spelled
// out again: the node's shape keeps its one home in the schema, and a field
// added there is cleared without anyone remembering a second list.
User.EMPTY_DISCOUNT = account.resolveAccount({}).subscription.discount;

module.exports = User;
