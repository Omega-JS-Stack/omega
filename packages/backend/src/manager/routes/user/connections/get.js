const { FieldValue } = require('firebase-admin/firestore');
const { buildContext, returnUrlError } = require('./_context.js');
const { generateCsrfToken, generatePkcePair, encryptState } = require('./_state.js');
const { buildGrantContext, runStep } = require('./_grant.js');

/**
 * GET /user/connections - Read operations
 *
 * Actions:
 *   - authorize (default): Get authorization URL
 *   - status: Check connection status
 */
module.exports = async ({ ctx, user, settings }) => {
  // `status` takes an admin's `uid` — it checks the connection AT THE PROVIDER
  // (and may delete a dead one), which a trusted server may do on a user's
  // behalf. `authorize` does not: the URL it answers is opened by the
  // connecting user's OWN browser ([#782](https://github.com/Omega-JS-Stack/omega/issues/782))
  const context = await buildContext({ ctx, user, settings, honorUid: settings.action === 'status' });

  if (context.error) {
    return ctx.respond(context.error.message, { code: context.error.code });
  }

  ctx.log('Connections GET request', { action: settings.action, provider: settings.provider });

  switch (settings.action) {
    case 'status':
      return processStatus(context);

    case 'authorize':
    default:
      return processAuthorize(context);
  }
};

// ============================================================================
// Handlers
// ============================================================================

async function processAuthorize(context) {
  const { ctx, Manager, admin, connectionProvider, settings, targetUid, clientId, clientSecret, redirectUri } = context;

  // The optional destination this connect comes back to
  // ([#784](https://github.com/Omega-JS-Stack/omega/issues/784)): a caller's
  // value, refused here — before anything is minted — when it is not a path
  const invalidReturn = returnUrlError(settings);

  if (invalidReturn) {
    return ctx.respond(invalidReturn.message, { code: invalidReturn.code });
  }

  if (!clientId) {
    return ctx.respond(`Missing client_id for ${settings.provider} provider`, { code: 500 });
  }

  // Generate CSRF token
  const csrfToken = generateCsrfToken();

  // PKCE, when the provider declares it: the verifier is minted here and rides
  // the SAME usage entry as the CSRF token, read back (and deleted) at tokenize
  const pkce = connectionProvider.pkce ? generatePkcePair() : null;

  // Store CSRF token in user's usage document (auto-cleaned daily)
  await admin.firestore().doc(`usage/${targetUid}`).set({
    connections: {
      [settings.provider]: {
        csrf: csrfToken,
        // A verifier is a one-time secret, never a log line and never the state
        verifier: pkce ? pkce.verifier : null,
        createdAt: Date.now(),
      },
    },
  }, { merge: true });

  // Build minimal state (no unnecessary data)
  const stateData = {
    provider: settings.provider,
    uid: targetUid,
    csrf: csrfToken,
    ts: Date.now(),
    // Where the callback page lands when this connect comes back
    // ([#784](https://github.com/Omega-JS-Stack/omega/issues/784)). It rides the
    // ENCRYPTED state because that is the only thing that survives the trip out
    // to the provider and back, and the key stays absent when no returnUrl was
    // passed — the page's own default is what answers then
    ...(settings.returnUrl ? { returnUrl: settings.returnUrl } : {}),
  };

  // Encrypt state
  let encryptedState;

  try {
    encryptedState = encryptState(stateData);
  } catch (e) {
    return ctx.respond(e.message, { code: 500 });
  }

  // Set scopes from app config, fall back to provider defaults
  const appScopes = Manager.config?.connections?.[settings.provider]?.scope || [];
  const finalScopes = appScopes.length > 0 ? appScopes : (connectionProvider.scope || []);

  // Build authorization URL — the provider's own step when it declares one
  const urlString = await runStep(connectionProvider, 'authorize', buildGrantContext({
    provider: connectionProvider,
    providerName: settings.provider,
    Manager,
    ctx,
    uid: targetUid,
    clientId,
    clientSecret,
    redirectUri,
    scope: finalScopes,
    state: encryptedState,
    pkce,
  }));

  ctx.log('Connections authorize URL generated');

  if (settings.redirect) {
    return ctx.redirect(urlString);
  }

  return ctx.respond({ url: urlString });
}

async function processStatus(context) {
  const { ctx, Manager, admin, connectionProvider, settings, targetUid, targetUser, clientId, clientSecret } = context;

  // `returnUrl` belongs to `authorize` alone; a caller passing it here fails
  // loudly rather than being silently landed nowhere (the #782 rule for `uid`)
  if (settings.returnUrl) {
    return ctx.respond('The returnUrl parameter is only accepted by action=authorize.', { code: 400 });
  }

  const storedToken = targetUser?.connections?.[settings.provider]?.token;

  if (!storedToken?.refresh_token) {
    return ctx.respond({ status: 'disconnected' });
  }

  // A provider that can ASK answers from there; without a `status` step, a
  // stored refresh token IS the answer — there is nothing else to read
  if (typeof connectionProvider.status !== 'function') {
    return ctx.respond({ status: 'connected' });
  }

  const status = await Promise.resolve().then(() => runStep(connectionProvider, 'status', buildGrantContext({
    provider: connectionProvider,
    providerName: settings.provider,
    Manager,
    ctx,
    uid: targetUid,
    clientId,
    clientSecret,
    token: storedToken,
  }))).catch(() => 'error');

  if ((status === 'disconnected' || status === 'error') && settings.removeInvalidTokens) {
    await admin.firestore().doc(`users/${targetUid}`).update({
      [`connections.${settings.provider}`]: FieldValue.delete(),
      metadata: Manager.Metadata().set({ tag: 'user/connections' }),
    });
    ctx.log(`Removed invalid token for user: ${targetUid}`);
  }

  return ctx.respond({ status });
}
