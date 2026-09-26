/**
 * MCP OAuth endpoints (admin key auto-approve OR user sign-in via consumer website)
 *
 * The OAuth 2.1 half of the MCP HTTP surface, routed here by handler.js:
 * - Authorize: admin key auto-approve, else the consumer website's sign-in, else a key form
 * - Token: exchanges the auth code (the admin key, or a Firebase ID token) for an access token
 * - Register: dynamic client registration (RFC 7591)
 */
const { sendJson } = require('./utils.js');

/**
 * OAuth Authorize
 *
 * Three paths:
 * 1. client_id matches admin key → auto-redirect (no form, no sign-in)
 * 2. No matching key → redirect to consumer's website for user sign-in
 * 3. Fallback → show manual key entry form
 */
function handleAuthorize(req, res, options, baseUrl) {
  const query = req.query || {};
  const { redirect_uri, state, client_id } = query;
  const omega = options.omega;

  // Auto-approve if client_id matches the admin key
  if (isAdminKey(client_id) && redirect_uri) {
    return redirectWithCode(res, redirect_uri, client_id, state);
  }

  // Try to redirect to consumer's website for user sign-in
  const consumerAuthUrl = resolveConsumerAuthUrl(omega);

  if (consumerAuthUrl && redirect_uri) {
    const authUrl = new URL(consumerAuthUrl);
    authUrl.searchParams.set('redirect_uri', redirect_uri);
    if (state) {
      authUrl.searchParams.set('state', state);
    }
    authUrl.searchParams.set('mcp', 'true');
    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
    return;
  }

  // Fallback: show manual key entry form
  if (req.method === 'GET') {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>OMEGA Backend: Authorize MCP</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, system-ui, sans-serif; background: #111; color: #eee; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 32px; max-width: 420px; width: 100%; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    p { font-size: 14px; color: #999; margin-bottom: 24px; }
    label { font-size: 13px; color: #aaa; display: block; margin-bottom: 6px; }
    input[type="password"] { width: 100%; padding: 10px 12px; background: #222; border: 1px solid #444; border-radius: 6px; color: #eee; font-size: 14px; }
    input[type="password"]:focus { outline: none; border-color: #7c6df0; }
    button { margin-top: 20px; width: 100%; padding: 10px; background: #7c6df0; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
    button:hover { background: #6b5de0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize MCP Connection</h1>
    <p>Enter your OMEGA Backend key to allow Claude to connect.</p>
    <form method="POST">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri || '')}">
      <input type="hidden" name="state" value="${escapeHtml(state || '')}">
      <label for="key">OMEGA Backend Key</label>
      <input type="password" id="key" name="key" placeholder="Enter your key" required autofocus>
      <button type="submit">Allow</button>
    </form>
  </div>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  // POST: validate key and redirect back with code
  if (req.method === 'POST') {
    const body = req.body || {};
    const key = body.key || '';
    const redirectUri = body.redirect_uri || '';
    const postState = body.state || '';

    if (!isAdminKey(key)) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end('<html><body style="background:#111;color:#e55;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><h2>Invalid key. Go back and try again.</h2></body></html>');
      return;
    }

    if (!redirectUri) {
      return sendJson(res, 400, { error: 'Missing redirect_uri' });
    }

    return redirectWithCode(res, redirectUri, key, postState);
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

/**
 * OAuth Token: exchanges an auth code for an access token.
 *
 * Two paths:
 * 1. Code is the admin key → return it as access_token (existing behavior)
 * 2. Code is a Firebase ID token → verify, look up user, return api.privateKey
 */
async function handleToken(req, res, options) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const body = req.body || {};
  const code = body.code || body.client_secret || body.client_id || '';
  const omega = options.omega;

  // Path 1: admin key
  if (isAdminKey(code)) {
    return sendJson(res, 200, {
      access_token: code,
      token_type: 'Bearer',
      scope: 'tools',
    });
  }

  // Path 2: Firebase ID token → exchange for user's API key
  if (code) {
    try {
      const admin = omega.firebase.admin;

      if (!admin) {
        return sendJson(res, 500, {
          error: 'server_error',
          error_description: 'Firebase Admin not available.',
        });
      }

      const decoded = await admin.auth().verifyIdToken(code);
      const uid = decoded.uid;

      const userDoc = await admin.firestore().doc(`users/${uid}`).get();

      if (!userDoc.exists) {
        return sendJson(res, 401, {
          error: 'invalid_grant',
          error_description: 'User not found.',
        });
      }

      const userData = userDoc.data();
      let apiKey = userData?.api?.privateKey;

      // Generate an API key if the user doesn't have one
      if (!apiKey) {
        const { v4: uuidv4 } = require('uuid');
        apiKey = `pk_${uuidv4().replace(/-/g, '')}`;

        await admin.firestore().doc(`users/${uid}`).set(
          { api: { privateKey: apiKey } },
          { merge: true },
        );
      }

      return sendJson(res, 200, {
        access_token: apiKey,
        token_type: 'Bearer',
        scope: 'tools',
      });
    } catch (error) {
      return sendJson(res, 401, {
        error: 'invalid_grant',
        error_description: error.message || 'Invalid authorization code.',
      });
    }
  }

  sendJson(res, 401, {
    error: 'invalid_grant',
    error_description: 'Missing authorization code.',
  });
}

/**
 * OAuth Dynamic Client Registration (RFC 7591)
 * MCP clients register themselves before starting the auth flow.
 * We accept any client and return a generated client_id.
 */
function handleRegister(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const body = req.body || {};
  const { v4: uuidv4 } = require('uuid');
  const clientId = `mcp_${uuidv4().replace(/-/g, '')}`;

  sendJson(res, 201, {
    client_id: clientId,
    client_name: body.client_name || 'MCP Client',
    redirect_uris: body.redirect_uris || [],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
}

// --- Helpers ---

function isAdminKey(key) {
  const configKey = process.env.OMEGA_ADMIN_KEY || '';
  return !!key && !!configKey && key === configKey;
}

function resolveConsumerAuthUrl(omega) {
  // Check config/omega.json5 for explicit mcp.authUrl
  const mcpConfig = omega.config?.mcp || {};

  if (mcpConfig.authUrl) {
    return mcpConfig.authUrl;
  }

  // Use getWebsiteUrl(): auto-resolves to localhost in dev/testing, production otherwise
  const websiteUrl = omega.getWebsiteUrl ? omega.getWebsiteUrl() : null;

  if (websiteUrl) {
    return `${websiteUrl.replace(/\/+$/, '')}/token`;
  }

  return null;
}

function redirectWithCode(res, redirectUri, code, state) {
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) {
    url.searchParams.set('state', state);
  }
  res.writeHead(302, { Location: url.toString() });
  res.end();
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { handleAuthorize, handleToken, handleRegister };
