/**
 * WHO a call acts on, and the two 400s that decide it
 * ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)): the
 * authenticated caller, the target user an admin may name, and the destination
 * an authorize leg may come back to.
 *
 * One concern, one file: the provider lookup is `_providers.js`, the secrets
 * are `_state.js`, the steps are `_grant.js`.
 */

const { loadProvider } = require('./_providers.js');

/**
 * The 400 an action that does NOT take `uid` answers when one is passed
 * ([#782](https://github.com/Omega-JS-Stack/omega/issues/782)).
 *
 * `authorize` and `tokenize` are the connecting user's OWN legs — the
 * authorization URL is opened by their browser and the code comes back from it —
 * so an admin cannot run them for somebody else. A caller still passing `uid`
 * was written against the argument they used to take, and ignoring it silently
 * would answer for the WRONG user; it fails loudly here instead, naming the
 * argument. A plain read of another user's stored record is the admin firestore
 * route (`GET /admin/firestore?path=users/<uid>`).
 *
 * @param {object} settings - The resolved route settings
 * @returns {object|null} The error, or null when no uid was passed
 */
function droppedUidError(settings) {
  if (!settings.uid) {
    return null;
  }

  return {
    message: 'The uid parameter is not accepted by this action: it acts on the authenticated user. Use `status`, `refresh` or `delete` to act on another user as an admin, or GET /admin/firestore to read their record.',
    code: 400,
  };
}

// The rule `returnUrl` has to satisfy, in the words the 400 says it in
// ([#784](https://github.com/Omega-JS-Stack/omega/issues/784))
const RETURN_PATH_RULE = 'a path on this site: it starts with a single `/` and carries no scheme, no `//`, no backslash and no whitespace (a query and a hash are fine)';

/**
 * Whether a value is a path on this site — the ONE home of the rule
 * ([#784](https://github.com/Omega-JS-Stack/omega/issues/784)).
 *
 * The value ends up assigned to `location` in the connecting user's browser, so
 * every shape that could name another origin is out: an absolute URL, a
 * protocol-relative `//host`, a backslash (browsers read `/\host` as `//host`),
 * a `javascript:` scheme, and any whitespace a parser might strip on the way to
 * one of those. What is left is a path, and a path can only land here.
 *
 * @param {*} value - The candidate
 * @returns {boolean} True when it is a path on this site
 */
function isSitePath(value) {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
    && !/\s/.test(value);
}

/**
 * The 400 `authorize` answers when its optional `returnUrl` is not a path
 * ([#784](https://github.com/Omega-JS-Stack/omega/issues/784)).
 *
 * The parameter is optional, so an absent one is no error. A value that is not a
 * path is refused rather than dropped: a caller that asked to be sent somewhere
 * would otherwise be silently landed on the default and never learn why.
 *
 * @param {object} settings - The resolved route settings
 * @returns {object|null} The error, or null when no returnUrl was passed or it is a path
 */
function returnUrlError(settings) {
  if (!settings.returnUrl) {
    return null;
  }

  if (isSitePath(settings.returnUrl)) {
    return null;
  }

  return {
    // The caller's value is never echoed: it is refused precisely because it may
    // be an attacker's, and this message can end up on a page
    message: `The returnUrl parameter must be ${RETURN_PATH_RULE}.`,
    code: 400,
  };
}

/**
 * Build context object with common connection data
 * Used by GET, POST, DELETE handlers
 *
 * `honorUid` is the per-action flag ([#782](https://github.com/Omega-JS-Stack/omega/issues/782)):
 * true for the actions a trusted server may run at the provider on a user's
 * behalf (`status`, `refresh`, `delete`), false for the ones that need the
 * connecting user's own browser (`authorize`, `tokenize`) — those answer
 * droppedUidError() rather than acting on anybody.
 *
 * @param {object} options
 * @param {object} options.ctx - The route context
 * @param {object} options.user - The authenticated caller
 * @param {object} options.settings - The resolved route settings
 * @param {boolean} [options.requireProvider] - Load the provider named in `settings`
 * @param {boolean} [options.honorUid] - Whether an admin's `uid` acts on that user
 * @returns {Promise<object>} The route context, or `{ error }`
 */
async function buildContext({ ctx, user, settings, requireProvider = true, honorUid = false }) {
  const Manager = ctx.Manager;
  const { admin } = Manager.libraries;

  // Require authentication
  if (!user.authenticated) {
    return { error: { message: 'Authentication required', code: 401 } };
  }

  if (!honorUid) {
    const dropped = droppedUidError(settings);

    if (dropped) {
      return { error: dropped };
    }
  }

  // Get target user (admin can manage other users)
  const targetUid = (honorUid && settings.uid) || user.auth.uid;

  if (targetUid !== user.auth.uid && !user.roles.admin) {
    return { error: { message: 'Admin required to manage other users', code: 403 } };
  }

  // Resolve target user data
  let targetUser = user;

  if (targetUid !== user.auth.uid) {
    const doc = await admin.firestore().doc(`users/${targetUid}`).get();

    if (!doc.exists) {
      return { error: { message: 'User not found', code: 404 } };
    }

    targetUser = doc.data();
  }

  // Build redirect URI
  const redirectUri = `${Manager.project.websiteUrl}/connections/callback`;

  // If provider not required (e.g., tokenize gets it from encrypted state), skip loading
  if (!requireProvider) {
    return {
      ctx,
      Manager,
      admin,
      settings,
      targetUid,
      targetUser,
      redirectUri,
    };
  }

  // Provider is required
  if (!settings.provider) {
    return { error: { message: 'The provider parameter is required', code: 400 } };
  }

  // The module and the credentials it was registered with, in ONE lookup: the
  // brand's own dir first, then the package's
  const resolved = loadProvider(settings.provider, Manager);

  if (resolved.error) {
    return { error: resolved.error };
  }

  return {
    ctx,
    Manager,
    admin,
    connectionProvider: resolved.connectionProvider,
    settings,
    targetUid,
    targetUser,
    clientId: resolved.clientId,
    clientSecret: resolved.clientSecret,
    redirectUri,
  };
}

module.exports = {
  buildContext,
  droppedUidError,
  returnUrlError,
};
