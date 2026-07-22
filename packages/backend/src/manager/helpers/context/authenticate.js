/**
 * RouteContext authentication — resolves the calling user from the request.
 *
 * Lanes, in order: Bearer ID token (JWT) → __session cookie → explicit
 * authenticationToken/apiKey (options or payload). The omega-admin-key header
 * is a SEPARATE lane so one request can be admin-authenticated AND target a
 * user at the same time. Credentials are logged presence + last-4 only.
 */

const safeCompare = require('../safe-compare.js');

const methods = {
  async authenticate(options) {
    const self = this;

    // Shortcuts
    const admin = self.ref.admin;
    const req = self.ref.req;
    const data = self.request.data;

    // Get stored admin key
    const OMEGA_ADMIN_KEY = process.env.OMEGA_ADMIN_KEY || '';

    // Build the ID token from the request
    let idToken;
    let adminKey;

    // Set options
    options = options || {};
    options.resolve = typeof options.resolve === 'undefined' ? true : options.resolve;
    options.debug = typeof options.debug === 'undefined' ? false : options.debug;

    function _resolve(user) {
      // Resolve the properties
      user = user || {};
      user.authenticated = typeof user.authenticated === 'undefined'
        ? false
        : user.authenticated;

      // Validate OMEGA_ADMIN_KEY (constant-time — a plain === leaks match length via timing)
      if (safeCompare(adminKey, OMEGA_ADMIN_KEY)) {
        // Update roles
        user.roles = user.roles || {};
        user.roles.admin = true;

        // Set authenticated
        user.authenticated = true;
      }

      // Resolve the user
      if (options.resolve) {
        self.request.user = self.Manager.User(user).properties;
        self.request.user.authenticated = user.authenticated || false;
        return self.request.user;
      } else {
        return user;
      }
    }

    // Get shortcuts
    const authHeader = req?.headers?.authorization || '';

    // Extract the admin key — a separate lane from the ID token so one request
    // can be admin-authenticated AND target a user at the same time.
    // Wire: the `omega-admin-key` request header ONLY (query/body keys leak into
    // access logs and payload schemas). In-process callers pass options.adminKey.
    if (options.adminKey || req?.headers?.['omega-admin-key']) {
      adminKey = options.adminKey || req.headers['omega-admin-key'];

      // Log the token (redacted — these lines land in Cloud Logging)
      self.log('Found "omega-admin-key" header', redactSecret(adminKey));
    }

    // Extract the token / API key
    // This is the main token that will be used to authenticate the user (it can be a JWT or a user's API key)
    if (authHeader.startsWith('Bearer ')) {
      // Read the ID Token from the Authorization header.
      idToken = authHeader.split('Bearer ')[1];

      // Log the token (redacted — these lines land in Cloud Logging)
      self.log('Found "Authorization" header', redactSecret(idToken));
    } else if (req?.cookies?.__session) {
      // Read the ID Token from cookie.
      idToken = req.cookies.__session;

      // Log the token (redacted — these lines land in Cloud Logging)
      self.log('Found "__session" cookie', redactSecret(idToken));
    } else if (
      options.authenticationToken || data.authenticationToken
      || options.apiKey || data.apiKey
    ) {
      // Read token OR API Key from options or data
      idToken = options.authenticationToken || data.authenticationToken
      || options.apiKey || data.apiKey;

      // Log the token (redacted — these lines land in Cloud Logging)
      self.log('Found "authenticationToken" parameter', redactSecret(idToken));
    } else {
      // No token found
      return _resolve(self.request.user);
    }

    // Check if the token is a JWT
    if (isJWT(idToken)) {
      // Check with firebase
      try {
        const decodedIdToken = await admin.auth().verifyIdToken(idToken);

        // Log the token
        if (options.debug) {
          self.log('JWT token decoded', decodedIdToken.email, decodedIdToken.user_id);
        }

        // Get the user
        await admin.firestore().doc(`users/${decodedIdToken.user_id}`)
        .get()
        .then((doc) => {
          // Set the user
          if (doc.exists) {
            self.request.user = Object.assign({}, self.request.user, doc.data());
            self.request.user.authenticated = true;
            self.request.user.auth.uid = decodedIdToken.user_id;
            self.request.user.auth.email = decodedIdToken.email;
          }

          // Log the user
          if (options.debug) {
            self.log('Found user doc', self.request.user);
          }
        });

        // Return the user
        return _resolve(self.request.user);
      } catch (error) {
        self.error('Error while verifying JWT:', error);

        // Return the user
        return _resolve(self.request.user);
      }
    } else {
      // Query by API key
      await admin.firestore().collection(`users`)
        .where('api.privateKey', '==', idToken)
        .get()
        .then((querySnapshot) => {
          querySnapshot.forEach((doc) => {
            self.request.user = Object.assign({}, self.request.user, doc.data());
            self.request.user.authenticated = true;
          });
        })
        .catch((error) => {
          console.error('Error getting documents: ', error);
        });

      // Return the user
      return _resolve(self.request.user);
    }
  },
};

// Presence + last-4 only — full secrets in log lines land in Cloud Logging
function redactSecret(value) {
  const string = `${value || ''}`;

  if (!string) {
    return '(empty)';
  }

  return `***${string.slice(-4)} (${string.length} chars)`;
}

const isJWT = (token) => {
  const { jwtDecode } = require('jwt-decode');

  try {
    // Decode the token and request the header
    const decoded = jwtDecode(token, { header: true });

    // Check for expected JWT keys in the header
    return decoded?.alg && decoded?.typ === 'JWT';
  } catch (err) {
    // If parsing fails, it's not a valid JWT
    return false;
  }
};

module.exports = { methods };
