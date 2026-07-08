/**
 * Firebase Auth admin client over the Identity Toolkit REST API — the
 * non-interactive replacement for omega-manager's firebase-admin
 * `getAuth(brandId)`. Authenticates with the brand's own service account
 * (.omega/secrets/service-account.json, provisioned by the firebase
 * service) via the shared google-token provider; custom tokens are signed
 * locally with the shared jwt helper, so there is no SDK dependency.
 *
 * Handlers call named methods, so tests fake this surface
 * method-for-method. Lookups return null for missing users (instead of
 * firebase-admin's auth/user-not-found throw).
 */
const { createTokenProvider } = require('../../../lib/google-token.js');
const { signJwt } = require('../../../lib/jwt.js');

const IDENTITY_TOOLKIT_BASE = 'https://identitytoolkit.googleapis.com/v1';
const SCOPE = 'https://www.googleapis.com/auth/identitytoolkit';

// Fixed audience for Firebase custom tokens (not the project)
const CUSTOM_TOKEN_AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

/**
 * Map an Identity Toolkit user record to the subset the service uses.
 */
function toUser(record) {
  return {
    uid: record.localId,
    email: record.email,
    providerData: (record.providerUserInfo || []).map((p) => ({ providerId: p.providerId })),
  };
}

/**
 * Create the auth admin client.
 *
 * @param {Object} serviceAccount - Parsed service-account JSON
 * @returns {Object} { getUserByEmail, getUser, createUser, updateUser, createCustomToken }
 */
function createAuthAdmin(serviceAccount) {
  const projectId = serviceAccount.project_id;
  const tokenProvider = createTokenProvider(serviceAccount, SCOPE);

  async function request(method, body) {
    const token = await tokenProvider.getAccessToken();

    const response = await fetch(`${IDENTITY_TOOLKIT_BASE}/projects/${projectId}/${method}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Identity Toolkit API error: ${data.error?.message || JSON.stringify(data)}`);
    }

    return data;
  }

  return {
    /** Look up a user by email. Missing → null. */
    async getUserByEmail(email) {
      const data = await request('accounts:lookup', { email: [email] });
      return data.users?.[0] ? toUser(data.users[0]) : null;
    },

    /** Look up a user by uid. Missing → null. */
    async getUser(uid) {
      const data = await request('accounts:lookup', { localId: [uid] });
      return data.users?.[0] ? toUser(data.users[0]) : null;
    },

    /** Create a user with email + password. */
    async createUser({ email, password }) {
      const data = await request('accounts', { email, password });
      return { uid: data.localId, email };
    },

    /** Update a user's password. */
    async updateUser(uid, { password }) {
      await request('accounts:update', { localId: uid, password });
    },

    /**
     * Mint a Firebase custom token for a uid — signed locally with the
     * service account's key (RS256), exchangeable for an ID token via the
     * public signInWithCustomToken endpoint.
     */
    createCustomToken(uid) {
      const now = Math.floor(Date.now() / 1000);

      return signJwt(
        { alg: 'RS256', typ: 'JWT' },
        {
          iss: serviceAccount.client_email,
          sub: serviceAccount.client_email,
          aud: CUSTOM_TOKEN_AUD,
          iat: now,
          exp: now + 3600,
          uid,
        },
        serviceAccount.private_key,
      );
    },
  };
}

module.exports = { createAuthAdmin, CUSTOM_TOKEN_AUD };
