/**
 * @omegajs/account — the single source of truth for the OMEGA user/account schema.
 *
 * Today the account shape lives in two drifted places: @omegajs/backend's
 * src/manager/helpers/user.js (canonical — schema engine + tokens) and
 * @omegajs/client's DEFAULT_ACCOUNT in modules/auth.js (hand-rolled deep-merge,
 * missing flags/activity/personal branches and `everPaid`). This package
 * unifies them; each framework becomes a thin wrapper (@omegajs/backend keeps its
 * `new User(Manager, settings).properties` API, @omegajs/client keeps
 * `resolveAccount(rawData, firebaseUser)`).
 *
 * resolveAccount(data, options):
 *   options.generators — { uuid, randomId, apiKey } value generators for the
 *     '$uuid'/'$randomId'/'$apiKey' schema tokens. @omegajs/backend injects real ones
 *     (uuid v4, Utilities().randomId, uid-generator); the frontend passes none
 *     and the fields resolve to null (real values always come from the backend).
 *   options.user — optional auth-user overlay ({ uid, email }): fills
 *     account.auth identity when the doc doesn't carry it (@omegajs/client's
 *     resolveAccount(rawData, firebaseUser) semantic).
 */
const USER_SCHEMA = require('./schema.js');
const { resolve } = require('./engine.js');
const resolveSubscription = require('./subscription.js');

function resolveAccount(data, options) {
  options = options || {};

  // Time context — byte-identical to @omegajs/backend's node-powertools timestamps:
  // powertools.timestamp(d, { output: 'string' }) === d.toISOString(),
  // powertools.timestamp(d, { output: 'unix' }) === floor(ms / 1000).
  const now = new Date();
  const ctx = {
    generators: options.generators || {},
    now: now.toISOString(),
    nowUNIX: Math.floor(now.getTime() / 1000),
    oldDate: new Date(0).toISOString(),
    oldDateUNIX: 0,
  };

  const account = resolve(USER_SCHEMA, data || {}, ctx);

  // Auth-user overlay (frontend semantic): identity from the signed-in Firebase
  // user when the stored doc doesn't already carry it
  if (options.user) {
    account.auth.uid = account.auth.uid || options.user.uid || null;
    account.auth.email = account.auth.email || options.user.email || null;
  }

  return account;
}

module.exports = { USER_SCHEMA, resolveAccount, resolveSubscription };
