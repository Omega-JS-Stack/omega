/**
 * User: the OMEGA account as one class, the same on the backend and in the browser.
 *
 * The own enumerable fields are the resolved stored document (every schema
 * branch, in schema order), so `user.auth.uid` and `user.subscription.status`
 * read as they always have and `toJSON()` is the one stored shape a Firestore
 * write or an API response carries. Everything derived lives on the prototype
 * as getters, computed on every read, so it never reaches the stored shape and
 * never goes stale when code mutates `user.subscription` in place.
 *
 * `new User()` is the signed-out user: `authenticated` false, `plan` basic.
 */
const resolveAccount = require('./resolve-account.js');
const resolveSubscription = require('./subscription.js');

/**
 * An account: the stored document as own fields, identity-derived and
 * subscription-derived facts as getters.
 */
class User {
  // The '$uuid'/'$randomId'/'$apiKey' token generators. Static because there is one host per process:
  // the Node backend assigns { uuid, randomId, apiKey } once at boot; the browser never does, so those fields resolve to null.
  static generators = {};

  // The schema's own EMPTY discount node, which is what a CLEARED discount is
  // ([#333](https://github.com/Omega-JS-Stack/omega/issues/333)). The webhook
  // pipeline clears the node with a MERGE write, so every field has to be named or
  // half of the old claim survives it. Read off the resolver rather than spelled
  // out again: the node's shape keeps its one home in the schema, and a field
  // added there is cleared without anyone remembering a second list.
  static EMPTY_DISCOUNT = resolveAccount({}).subscription.discount;

  /**
   * @param {object} [document] - the stored account document (any partial object)
   * @param {object|null} [identity] - { uid, email, displayName, photoURL, emailVerified }; a Firebase user satisfies it as-is
   */
  constructor(document = {}, identity = null) {
    Object.assign(this, resolveAccount(document, { generators: User.generators, user: identity }));

    // Non-enumerable so it never reaches toJSON() or Object.keys(): the profile
    // comes from the sign-in, never from the stored document
    const source = identity || {};
    Object.defineProperty(this, 'profile', {
      value: {
        displayName: source.displayName || null,
        photoURL: source.photoURL || null,
        emailVerified: source.emailVerified === true,
      },
      writable: true,
    });
  }

  /** True only when the account carries a non-empty uid. */
  get authenticated() {
    return typeof this.auth.uid === 'string' && this.auth.uid.length > 0;
  }

  /** The account's uid, or null when signed out. */
  get uid() {
    return this.auth.uid;
  }

  /** The account's email, or null when signed out. */
  get email() {
    return this.auth.email;
  }

  /** The plan the user has access to right now ('basic' when cancelled or suspended). */
  get plan() {
    return resolveSubscription(this).plan;
  }

  /** True when a paid plan is active (including trialing and cancelling). */
  get active() {
    return resolveSubscription(this).active;
  }

  /** True while a claimed trial on an active paid plan has not yet expired. */
  get trialing() {
    return resolveSubscription(this).trialing;
  }

  /** True when an active paid plan (not trialing) has a cancellation pending. */
  get cancelling() {
    return resolveSubscription(this).cancelling;
  }

  /** True when the user has ever paid (a payment start date exists). */
  get everPaid() {
    return resolveSubscription(this).everPaid;
  }

  /** The stored document alone: own enumerable fields, never getters or profile. */
  toJSON() {
    return { ...this };
  }
}

module.exports = User;
