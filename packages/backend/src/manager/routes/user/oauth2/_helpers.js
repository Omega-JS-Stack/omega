const crypto = require('crypto');
const path = require('path');
const fetch = require('wonderful-fetch');
const { arrayify } = require('node-powertools');
// Aliased: this file already exports its OWN loadProvider (the OAuth2 lookup below)
const loadProviderModule = require('../../../libraries/load-provider.js');
const env = require('../../../libraries/env.js');

const PROVIDERS_DIR = path.join(__dirname, 'providers');

// Constants
const STATE_TTL_MINUTES = 10;

// Derive OAuth state encryption key from OMEGA_ADMIN_KEY
const STATE_KEY = env.get('OMEGA_ADMIN_KEY')
  ? crypto.createHash('sha256').update(`oauth2-state:${env.get('OMEGA_ADMIN_KEY')}`).digest('hex')
  : null;

/**
 * Build context object with common OAuth2 data
 * Used by GET, POST, DELETE handlers
 */
async function buildContext({ ctx, user, settings, requireProvider = true }) {
  const Manager = ctx.Manager;
  const { admin } = Manager.libraries;

  // Require authentication
  if (!user.authenticated) {
    return { error: { message: 'Authentication required', code: 401 } };
  }

  // Get target user (admin can manage other users)
  const targetUid = settings.uid || user.auth.uid;

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
  const redirectUri = `${Manager.project.websiteUrl}/oauth2`;

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

  // Load provider module
  let oauth2Provider;

  try {
    oauth2Provider = loadProviderModule(PROVIDERS_DIR, settings.provider);
  } catch (e) {
    return { error: { message: `Unknown OAuth2 provider: ${settings.provider}`, code: 400 } };
  }

  // Get OAuth2 credentials
  const providerEnvKey = settings.provider.toUpperCase().replace(/-/g, '_');
  const clientId = env.get(`OAUTH2_${providerEnvKey}_CLIENT_ID`);
  const clientSecret = env.get(`OAUTH2_${providerEnvKey}_CLIENT_SECRET`);

  return {
    ctx,
    Manager,
    admin,
    oauth2Provider,
    settings,
    targetUid,
    targetUser,
    clientId,
    clientSecret,
    redirectUri,
  };
}

/**
 * Load provider and credentials from provider name
 */
function loadProvider(providerName) {
  let oauth2Provider;

  try {
    oauth2Provider = loadProviderModule(PROVIDERS_DIR, providerName);
  } catch (e) {
    return { error: { message: `Unknown OAuth2 provider: ${providerName}`, code: 400 } };
  }

  const providerEnvKey = providerName.toUpperCase().replace(/-/g, '_');
  const clientId = env.get(`OAUTH2_${providerEnvKey}_CLIENT_ID`);
  const clientSecret = env.get(`OAUTH2_${providerEnvKey}_CLIENT_SECRET`);

  return { oauth2Provider, clientId, clientSecret };
}

// ============================================================================
// Crypto Helpers
// ============================================================================

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function encryptState(data) {
  if (!STATE_KEY) {
    throw new Error('OMEGA_ADMIN_KEY not configured');
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(STATE_KEY, 'hex'), iv);

  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag().toString('base64');

  return `${iv.toString('base64')}.${encrypted}.${authTag}`;
}

function decryptState(encryptedState) {
  if (!STATE_KEY) {
    throw new Error('OMEGA_ADMIN_KEY not configured');
  }

  const parts = encryptedState.split('.');

  if (parts.length !== 3) {
    throw new Error('Invalid state format');
  }

  const [ivB64, encryptedB64, authTagB64] = parts;

  const iv = Buffer.from(ivB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(STATE_KEY, 'hex'), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
}

/**
 * The ONE line a provider's identity check may log
 * ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
 *
 * Every provider used to hand `ctx.log` the token exchange RESPONSE, which
 * carries the access token, the refresh token and (Google) the id token — so a
 * brand's Cloud Logging held live third-party credentials for the whole
 * retention window, readable by anyone with a log-viewer role. The decoded
 * profile and the provider's identity response went the same way, and those are
 * the user's PII.
 *
 * What a log needs is WHICH provider, WHOSE account, and whether the exchange
 * came back with a token. Nothing on this line is a credential or a person, and
 * one home for the format keeps the three providers from drifting apart.
 *
 * @param {object} ctx - The route context (the log sink)
 * @param {object} options
 * @param {string} options.provider - The provider key ('google', 'discord', …)
 * @param {string|null} [options.uid] - The account the identity is being linked to
 * @param {object} [options.tokenizeResult] - The token exchange response — READ for
 *   whether it succeeded, never logged
 */
function logIdentityCheck(ctx, { provider, uid, tokenizeResult }) {
  ctx.log(`verifyIdentity(): provider=${provider}, uid=${uid || 'null'}, tokenExchange=${tokenizeResult?.access_token ? 'succeeded' : 'failed'}`);
}

module.exports = {
  STATE_TTL_MINUTES,
  STATE_KEY,
  buildContext,
  loadProvider,
  generateCsrfToken,
  encryptState,
  decryptState,
  logIdentityCheck,
  // Re-export utilities for handlers
  fetch,
  arrayify,
};
