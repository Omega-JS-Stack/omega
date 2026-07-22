const { FieldValue } = require('firebase-admin/firestore');
const {
  buildContext,
} = require('./_helpers.js');

/**
 * DELETE /user/oauth2 - Remove OAuth connection
 *
 * Revokes tokens with the provider (best effort) and removes the connection.
 */
module.exports = async ({ ctx, user, settings }) => {
  const context = await buildContext({ ctx, user, settings });

  if (context.error) {
    return ctx.respond(context.error.message, { code: context.error.code });
  }

  const { Manager, admin, oauth2Provider, targetUid, targetUser, clientId, clientSecret } = context;

  ctx.log('OAuth2 DELETE request', { provider: settings.provider });

  // Get current access token to revoke
  const accessToken = targetUser?.oauth2?.[settings.provider]?.token?.access_token;

  // Attempt to revoke token with provider (best effort)
  if (accessToken && oauth2Provider.revokeToken) {
    const revokeResult = await oauth2Provider.revokeToken(accessToken, {
      ctx,
      clientId,
      clientSecret,
    }).catch(e => ({ revoked: false, reason: e.message }));

    ctx.log('Token revocation result:', revokeResult);
  }

  // Delete OAuth data from user document
  await admin.firestore().doc(`users/${targetUid}`).update({
    [`oauth2.${settings.provider}`]: FieldValue.delete(),
    metadata: Manager.Metadata().set({ tag: 'user/oauth2' }),
  });

  return ctx.respond({ success: true });
};
