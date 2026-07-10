// Auth Flow — the framework-owned sign-in round trip: `manager.openAuthFlow()`.
//
// Opens the user's REAL default browser on manager.getAuthUrl()'s /signin → /token
// chain — never an embedded window, so sign-in rides the user's own browser session
// (SSO with whatever they're already logged into). What differs per environment is
// only the RETURN CHANNEL for the minted token:
//
//   production — the packaged app owns `<brand.id>://` with the OS (lib/protocol.js
//                registers it), so the chain's default final hop
//                (`<brand.id>://auth/token?authToken=…`) deep-links straight back
//                into lib/deep-link.js's built-in auth/token route.
//   dev/test   — the scheme is NOT OS-registered (protocol.js registers only in
//                production, and macOS can't runtime-register schemes missing from
//                the bundle's Info.plist at all), so the flow returns to a ONE-SHOT
//                loopback HTTP listener instead (RFC 8252 §7.3): bind an ephemeral
//                port on 127.0.0.1, pass `http://127.0.0.1:<port>/auth/token?state=
//                <nonce>` as the chain's final hop, and on the browser's redirect
//                validate the nonce + feed the token into the SAME deep-link pipeline
//                (synthesized `<brand.id>://` URL) — downstream code is byte-identical
//                across environments. Requires @omega.js/client ≥ 4.3.4 on the website
//                (isValidRedirectUrl accepts loopback hosts while the SITE runs in dev).
//
// Listener hygiene: loopback-bound, single-flight (a new open() supersedes the last),
// nonce-checked (mismatched/missing state → 400, listener stays up for the real
// return), and self-expiring (default 5 min). The browser tab gets a tiny
// "return to the app" page on success.
//
// Public API (via manager):
//   manager.openAuthFlow(options?)  → Promise<{ url, port? }> — resolves once the flow
//                                     is LAUNCHED; completion arrives later through
//                                     auth/token → omega.handleAuthToken →
//                                     the desktop:auth:sign-in-with-token broadcast.
//   manager.authFlow.cancel()       → tear down a pending dev listener (idempotent).

const crypto = require('crypto');
const http = require('http');
const LoggerLite = require('./logger-lite.js');

const logger = new LoggerLite('auth-flow');

// Generous — the user may be typing credentials in the browser.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const authFlow = {
  _initialized: false,
  _manager:     null,
  _pending:     null,   // { server, nonce, timer, port } — the one in-flight dev listener

  initialize(manager) {
    if (authFlow._initialized) {
      return;
    }
    authFlow._manager = manager;
    authFlow._initialized = true;
  },

  // Open the sign-in flow in the user's default browser. Resolves once the flow is
  // launched — NOT when the user finishes signing in.
  async open(options) {
    const manager = authFlow._manager;
    options = options || {};

    // Production: the OS routes the custom scheme back to us — plain external open.
    if (manager.isProduction()) {
      const url = manager.getAuthUrl();
      require('electron').shell.openExternal(url);
      logger.log(`production — opened ${url}`);
      return { url };
    }

    // Dev/test: loopback return channel. One flow at a time.
    authFlow.cancel();

    const nonce = crypto.randomBytes(16).toString('hex');
    const server = http.createServer((req, res) => authFlow._handleRequest(req, res));

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;

    const timer = setTimeout(() => {
      logger.warn('loopback listener timed out waiting for the browser return — closing.');
      authFlow.cancel();
    }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    if (timer.unref) timer.unref();

    authFlow._pending = { server, nonce, timer, port };

    const returnUrl = `http://127.0.0.1:${port}/auth/token?state=${nonce}`;
    const url = manager.getAuthUrl(null, returnUrl);
    require('electron').shell.openExternal(url);
    logger.log(`dev — loopback listener on 127.0.0.1:${port}, opened ${url}`);
    return { url, port };
  },

  // Tear down the pending dev listener (idempotent).
  cancel() {
    const pending = authFlow._pending;
    if (!pending) {
      return;
    }
    authFlow._pending = null;
    clearTimeout(pending.timer);
    try {
      pending.server.close();
      // close() alone leaves kept-alive sockets serving requests on a dead listener —
      // drop the idle ones so teardown is real (every response also sends
      // Connection: close, so nothing stays active past its reply).
      if (pending.server.closeIdleConnections) pending.server.closeIdleConnections();
    } catch (e) { /* already closed */ }
  },

  _handleRequest(req, res) {
    const manager = authFlow._manager;
    const pending = authFlow._pending;
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname !== '/auth/token') {
      res.writeHead(404, { Connection: 'close' });
      res.end();
      return;
    }

    const state = url.searchParams.get('state');
    const token = url.searchParams.get('authToken');

    // Nonce mismatch or missing token → reject, but KEEP the listener up: the
    // legitimate browser return may still be coming.
    if (!pending || state !== pending.nonce || !token) {
      logger.warn('loopback return rejected (bad state or missing authToken).');
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
      res.end(authFlow._page('Sign-in failed', 'The sign-in response was invalid. Return to the app and try again.'));
      return;
    }

    // Valid return: reply, tear down, then feed the SAME pipeline production uses.
    const appName = manager.config?.brand?.name || 'the app';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
    res.end(authFlow._page('Signed in', `You can close this tab and return to ${appName}.`));
    authFlow.cancel();

    const brandId = manager.config.brand.id;
    manager.deepLink.dispatch(`${brandId}://auth/token?authToken=${encodeURIComponent(token)}`);

    // The browser held focus during sign-in — bring the app back to the front,
    // mirroring what a real OS deep-link arrival does. windows.show is the
    // stealth-aware surface (raw win.show() would flash windows during tests).
    manager.windows.show('main');
  },

  _page(title, message) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>`
      + '<style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#111;color:#eee}main{text-align:center}h1{font-size:1.4rem}p{color:#aaa}</style>'
      + `</head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
  },
};

module.exports = authFlow;
