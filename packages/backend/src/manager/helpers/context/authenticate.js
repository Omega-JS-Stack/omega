/**
 * RouteContext authentication — resolves the calling user from the request.
 *
 * Lanes, in order: Bearer ID token (JWT) → __session cookie → explicit
 * authenticationToken/apiKey (options or payload). The omega-admin-key header
 * is a SEPARATE lane so one request can be admin-authenticated AND target a
 * user at the same time. Credentials are logged presence + last-4 only.
 */

const safeCompare = require('../safe-compare.js');
const redactSecret = require('../redact-secret.js');
const { healUserDoc, isUserDoc } = require('../../libraries/user-doc.js');
const env = require('../../libraries/env.js');

const methods = {
  async authenticate(options) {
    const self = this;

    // Shortcuts
    const admin = self.ref.admin;
    const req = self.ref.req;
    const data = self.request.data;

    // Get stored admin key
    const OMEGA_ADMIN_KEY = env.get('OMEGA_ADMIN_KEY') || '';

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
        const doc = await admin.firestore().doc(`users/${decodedIdToken.user_id}`).get();

        // Whether a doc was there AT ALL is the pre-heal lane's own question, and
        // it still decides the answer below on its own. Losing it would turn every
        // caller the heal declines to touch into a 401 it never used to get.
        const existed = doc.exists;

        let userDoc = existed ? doc.data() : null;

        // Heal FIRST, then authenticate normally. A token this project signed is
        // proof the account is real, so a missing users/{uid} is a database out of
        // sync with Auth rather than a caller to turn away — and every signed-in
        // surface arrives HERE, so one heal site covers them all
        // ([#405](https://github.com/Omega-JS-Stack/omega/issues/405)). The doc
        // requirement below stays exactly as strict: the heal recreates a doc only
        // behind an auth user that still exists, so a uid this project never
        // authenticated still cannot mint one (#399).
        if (!isUserDoc(userDoc)) {
          // A DECLINED heal (a signup still in flight, an anonymous account, an
          // account gone from Auth) leaves the caller exactly where the pre-heal
          // lane left them: whatever the doc held, and the same answer below.
          // /user/signup arrives inside the signup window holding nothing but
          // before-signin's activity, and the 30s poll it runs for its own doc
          // sits behind this authentication.
          userDoc = await healUserDoc({
            Manager: self.Manager,
            ctx: self,
            admin: admin,
            uid: decodedIdToken.user_id,
          }) || userDoc;
        }

        // Set the user — a healed/real doc, or the pre-heal rule: a doc existed
        if (isUserDoc(userDoc) || existed) {
          self.request.user = Object.assign({}, self.request.user, userDoc);
          self.request.user.authenticated = true;
          self.request.user.auth.uid = decodedIdToken.user_id;
          self.request.user.auth.email = decodedIdToken.email;
        }

        // Log the user
        if (options.debug) {
          self.log('Found user doc', self.request.user);
        }

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
