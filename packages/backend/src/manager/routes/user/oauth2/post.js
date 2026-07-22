const { FieldValue } = require('firebase-admin/firestore');
const {
  buildContext,
  loadProvider,
  decryptState,
  STATE_TTL_MINUTES,
  fetch,
} = require('./_helpers.js');

/**
 * POST /user/oauth2 - Write operations
 *
 * Actions:
 *   - tokenize (default): Exchange authorization code for tokens
 *   - refresh: Refresh access token
 */
module.exports = async ({ ctx, user, settings }) => {
  ctx.log('OAuth2 POST request', { action: settings.action });

  switch (settings.action) {
    case 'refresh':
      return processRefresh({ ctx, user, settings });

    case 'tokenize':
    default:
      return processTokenize({ ctx, settings });
  }
};

// ============================================================================
// Handlers
// ============================================================================

async function processTokenize({ ctx, settings }) {
  const Manager = ctx.Manager;
  const { admin } = Manager.libraries;
  ctx.log('processTokenize settings', {
    hasCode: !!settings.code,
    codeType: typeof settings.code,
    codeLength: settings.code?.length,
    hasEncryptedState: !!settings.encryptedState,
    encryptedStateLength: settings.encryptedState?.length,
  });

  // Validate required params
  if (!settings.code) {
    return ctx.respond('Missing authorization code', { code: 400 });
  }

  if (!settings.encryptedState) {
    return ctx.respond('Missing encrypted state', { code: 400 });
  }

  // Build redirect URI
  const redirectUri = `${Manager.project.websiteUrl}/oauth2`;

  // Decrypt and validate state
  let stateData;

  try {
    stateData = decryptState(settings.encryptedState);
  } catch (e) {
    ctx.log('Failed to decrypt state:', e.message);
    return ctx.respond('Invalid OAuth state', { code: 400 });
  }

  // Validate timestamp (10 min TTL)
  const ageMinutes = (Date.now() - stateData.ts) / 1000 / 60;

  if (ageMinutes > STATE_TTL_MINUTES) {
    return ctx.respond('OAuth session expired. Please try again.', { code: 400 });
  }

  // Load provider from decrypted state
  const providerResult = loadProvider(stateData.provider);

  if (providerResult.error) {
    return ctx.respond(providerResult.error.message, { code: providerResult.error.code });
  }

  const { oauth2Provider, clientId, clientSecret } = providerResult;

  // Retrieve stored CSRF token from user's usage document
  const usageDocRef = admin.firestore().doc(`usage/${stateData.uid}`);
  const usageDoc = await usageDocRef.get();

  if (!usageDoc.exists) {
    return ctx.respond('OAuth session not found. Please try again.', { code: 400 });
  }

  const storedCsrf = usageDoc.data()?.oauth2?.[stateData.provider]?.csrf;

  if (!storedCsrf) {
    return ctx.respond('OAuth session not found. Please try again.', { code: 400 });
  }

  // Validate CSRF token
  if (storedCsrf !== stateData.csrf) {
    ctx.log('CSRF mismatch', { stored: storedCsrf, received: stateData.csrf });
    return ctx.respond('Invalid OAuth session', { code: 400 });
  }

  // Exchange code for tokens
  const body = {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code: settings.code,
  };

  const tokenResponse = await fetch(oauth2Provider.urls.tokenize, {
    method: 'POST',
    timeout: 60000,
    response: 'json',
    body: new URLSearchParams(body),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }).catch(e => e);

  if (tokenResponse instanceof Error) {
    return ctx.respond(`Token exchange failed: ${tokenResponse.message}`, { code: 500 });
  }

  // Verify identity with provider
  const verifiedIdentity = await oauth2Provider.verifyIdentity(tokenResponse, Manager, ctx)
    .catch(e => e);

  if (verifiedIdentity instanceof Error) {
    return ctx.respond(verifiedIdentity.message, { code: 400 });
  }

  if (!tokenResponse.refresh_token) {
    return ctx.respond(
      `Missing refresh_token. Visit ${oauth2Provider.urls.removeAccess} and remove our app, then try again.`,
      { code: 400 }
    );
  }

  // Store tokens (only necessary fields, no raw settings)
  await admin.firestore().doc(`users/${stateData.uid}`).set({
    oauth2: {
      [stateData.provider]: {
        token: {
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token,
          token_type: tokenResponse.token_type,
          expires_in: tokenResponse.expires_in,
          scope: tokenResponse.scope,
        },
        identity: verifiedIdentity,
        updated: {
          timestamp: ctx.meta.startTime.timestamp,
          timestampUNIX: ctx.meta.startTime.timestampUNIX,
        },
      },
    },
    metadata: Manager.Metadata().set({ tag: 'user/oauth2' }),
  }, { merge: true });

  // Delete CSRF token (cleanup)
  await usageDocRef.update({
    [`oauth2.${stateData.provider}`]: FieldValue.delete(),
  });

  ctx.log('OAuth2 tokenize complete');

  return ctx.respond({ success: true });
}

async function processRefresh({ ctx, user, settings }) {
  const context = await buildContext({ ctx, user, settings });

  if (context.error) {
    return ctx.respond(context.error.message, { code: context.error.code });
  }

  const { Manager, admin, oauth2Provider, targetUid, targetUser, clientId, clientSecret } = context;

  const refreshToken = targetUser?.oauth2?.[settings.provider]?.token?.refresh_token;

  if (!refreshToken) {
    return ctx.respond('No refresh token found', { code: 400 });
  }

  const body = {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  };

  const refreshResponse = await fetch(oauth2Provider.urls.refresh, {
    method: 'POST',
    timeout: 60000,
    response: 'json',
    body: new URLSearchParams(body),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }).catch(e => e);

  if (refreshResponse instanceof Error) {
    return ctx.respond(`Token refresh failed: ${refreshResponse.message}`, { code: 500 });
  }

  // Update stored tokens
  await admin.firestore().doc(`users/${targetUid}`).set({
    oauth2: {
      [settings.provider]: {
        token: {
          access_token: refreshResponse.access_token,
          refresh_token: refreshResponse.refresh_token || refreshToken, // Some providers don't return new refresh token
          token_type: refreshResponse.token_type,
          expires_in: refreshResponse.expires_in,
          scope: refreshResponse.scope,
        },
        updated: {
          timestamp: ctx.meta.startTime.timestamp,
          timestampUNIX: ctx.meta.startTime.timestampUNIX,
        },
      },
    },
    metadata: Manager.Metadata().set({ tag: 'user/oauth2' }),
  }, { merge: true });

  return ctx.respond({ success: true });
}
