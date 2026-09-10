const { FieldValue } = require('firebase-admin/firestore');
const { buildContext } = require('./_context.js');
const { buildGrantContext, runStep, REVOKE_UNSUPPORTED } = require('./_grant.js');

/**
 * DELETE /user/connections - Remove a connection
 *
 * Revokes tokens with the provider (best effort) and removes the connection.
 */
module.exports = async ({ ctx, user, settings }) => {
  // An admin may pass `uid`: revoking happens AT THE PROVIDER, on the user's
  // behalf, and needs no browser ([#782](https://github.com/Omega-JS-Stack/omega/issues/782))
  const context = await buildContext({ ctx, user, settings, honorUid: true });

  if (context.error) {
    return ctx.respond(context.error.message, { code: context.error.code });
  }

  const { Manager, admin, connectionProvider, targetUid, targetUser, clientId, clientSecret } = context;

  ctx.log('Connections DELETE request', { provider: settings.provider });

  const storedToken = targetUser?.connections?.[settings.provider]?.token;

  // Revoking is BEST EFFORT and never gates the delete
  // ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)): the default
  // step is the RFC 7009 POST, a provider that declares no `urls.revoke` answers
  // `unsupported` (Spotify has no endpoint at all), and a provider that refuses
  // throws — the user asked to be disconnected either way.
  if (storedToken?.access_token) {
    const outcome = await Promise.resolve()
      .then(() => runStep(connectionProvider, 'revoke', buildGrantContext({
        provider: connectionProvider,
        providerName: settings.provider,
        Manager,
        ctx,
        uid: targetUid,
        clientId,
        clientSecret,
        token: storedToken,
      })))
      .then((answer) => (answer === REVOKE_UNSUPPORTED ? REVOKE_UNSUPPORTED : 'revoked'))
      .catch((e) => `failed: ${e.message}`);

    ctx.log('Connections revoke', { provider: settings.provider, outcome });
  }

  // Delete the connection record from the user document
  await admin.firestore().doc(`users/${targetUid}`).update({
    [`connections.${settings.provider}`]: FieldValue.delete(),
    metadata: Manager.Metadata().set({ tag: 'user/connections' }),
  });

  return ctx.respond({ success: true });
};
