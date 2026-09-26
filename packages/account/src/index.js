/**
 * @omega.js/account: the single source of truth for the OMEGA user/account schema.
 *
 * The account shape once lived in two drifted places: @omega.js/backend's user
 * helper (canonical, schema engine + tokens) and @omega.js/client's hand-rolled
 * DEFAULT_ACCOUNT (missing flags/activity/personal branches and `everPaid`).
 * This package unifies them; each framework is a thin wrapper (the backend's
 * src/omega/services/user.js, the client's modules/auth.js).
 *
 * Exports:
 *   User: the account as a class (user.js), the stored document as own fields
 *     plus the computed getters.
 *   resolveAccount(data, options): the plain resolved document (resolve-account.js).
 *   resolveSubscription(account): the subscription math (subscription.js).
 */
const USER_SCHEMA = require('./schema.js');
const resolveAccount = require('./resolve-account.js');
const resolveSubscription = require('./subscription.js');
const User = require('./user.js');
const features = require('./features.js');

module.exports = { USER_SCHEMA, User, resolveAccount, resolveSubscription, ...features };
