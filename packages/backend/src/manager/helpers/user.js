/**
 * User — thin wrapper over @omegajs/account, the single source of truth for
 * the OMEGA user/account schema (shared with web-manager, so a doc resolved
 * here is byte-identical to one resolved on the frontend).
 *
 * @omegajs/backend's contribution is injecting the real value generators for the
 * '$uuid'/'$randomId'/'$apiKey' schema tokens — the frontend injects none and
 * those fields resolve to null (real values always come from the backend).
 * API unchanged:
 *   new User(Manager, settings).properties
 *   User.resolveSubscription(accountOrUserInstance)
 */
const uuid4 = require('uuid').v4;
const UIDGenerator = require('uid-generator');
const uidgen = new UIDGenerator(256);

// @omegajs/account is a private workspace package: in the monorepo the bare
// specifier resolves via the workspace link (and the prepare-package vendor
// hook rewrites it in dist/), but src/ ships in the tarball UNREWRITTEN and
// the test corpus deep-requires it in consumers — so fall back to the copy
// vendored into dist/, which sits at the same depth from both trees.
let account;
try {
  account = require('@omegajs/account');
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

module.exports = User;
