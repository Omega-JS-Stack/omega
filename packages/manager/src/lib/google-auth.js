/**
 * Google OAuth2 client — omega-manager's shared Google auth handler, ported.
 * Handles token storage, refresh, and the one-time browser authorization flow
 * (localhost callback server; interactive runs gate the browser open behind
 * Enter — the house rule — with the printed URL as the always-there fallback).
 *
 * ONE Google identity for the whole manager (legacy parity): every service
 * authorizes GOOGLE_SCOPES — the union of everything the manager touches —
 * against ONE token store, so the operator consents ONCE. The store records
 * which scopes it was granted; a cached token missing any requested scope
 * re-consents once instead of 403ing forever (adding a service = one re-ask).
 *
 * Credentials come from GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the brand
 * .env; tokens cache to the brand's gitignored .omega/auth/ directory.
 */
const { createServer } = require('node:http');
const { emitKeypressEvents } = require('node:readline');
const { dirname, join } = require('node:path');
const fs = require('node:fs');
const chalk = require('chalk').default;

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

// The manager's full Google surface. Firebase Management + Cloud Platform
// (IAM, Billing, Service Usage), userinfo.email (consent-screen supportEmail
// defaults to the AUTHORIZING user — #29), Search Console + site
// verification, GA4 admin, AdSense (read-only).
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/firebase',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/cloud-billing',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/webmasters',
  'https://www.googleapis.com/auth/siteverification',
  'https://www.googleapis.com/auth/analytics.edit',
  'https://www.googleapis.com/auth/adsense.readonly',
];

/** The ONE brand-local token store every Google service shares. */
function googleTokenStorePath(brandRoot) {
  return join(brandRoot, '.omega', 'auth', 'google-tokens.json');
}

class GoogleOAuth2Client {
  constructor(options = {}) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.scopes = options.scopes || [];
    this.tokenStorePath = options.tokenStorePath || null;

    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
  }

  loadStoredTokens() {
    if (!this.tokenStorePath || !fs.existsSync(this.tokenStorePath)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(this.tokenStorePath, 'utf8'));
    } catch {
      return null;
    }
  }

  saveTokens(tokens) {
    if (!this.tokenStorePath) {
      return;
    }

    fs.mkdirSync(dirname(this.tokenStorePath), { recursive: true });
    // Record the granted scopes — getAccessToken() uses them to decide
    // whether a cached token can serve a client or needs one re-consent.
    // MERGE over the existing store: refresh-path saves carry only the token
    // triple and must not drop sidecar fields (account_email).
    const existing = this.loadStoredTokens() || {};
    fs.writeFileSync(this.tokenStorePath, JSON.stringify({ ...existing, ...tokens, scopes: this.scopes }, null, 2));
  }

  /**
   * Best-effort: which Google account these tokens act as. Cached in the
   * token store (account_email) after the first userinfo lookup — the
   * userinfo.email scope is part of GOOGLE_SCOPES. Returns null when
   * unknowable; diagnostics must never throw over the error they decorate.
   */
  async getAccountEmail() {
    const stored = this.loadStoredTokens();
    if (stored?.account_email) {
      return stored.account_email;
    }
    try {
      const token = this.accessToken || await this.getAccessToken();
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.email) {
        this.saveTokens({ account_email: data.email });
      }
      return data.email || null;
    } catch {
      return null;
    }
  }

  /**
   * Get a valid access token (from cache, refresh, or new auth)
   */
  async getAccessToken() {
    const storedTokens = this.loadStoredTokens();

    // A cached token only counts when it was granted every scope this client
    // needs — otherwise API calls 403 with no re-consent trigger. Stores from
    // before scope tracking (no `scopes` array) are treated as insufficient:
    // one union re-consent upgrades them.
    const grantedScopes = Array.isArray(storedTokens?.scopes) ? storedTokens.scopes : [];
    const scopesSufficient = this.scopes.every((scope) => grantedScopes.includes(scope));

    if (storedTokens && scopesSufficient) {
      this.accessToken = storedTokens.access_token;
      this.refreshToken = storedTokens.refresh_token;
      this.tokenExpiry = storedTokens.expiry;
    } else if (storedTokens) {
      console.log(`  ${chalk.dim('→')} Cached Google token is missing newly required scopes — one re-consent upgrades it`);
    }

    // Return cached token if still valid (with 5 min buffer)
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 300000) {
      return this.accessToken;
    }

    if (this.refreshToken) {
      try {
        return await this.refreshAccessToken();
      } catch {
        console.log(`  ${chalk.yellow('⚠')} ${chalk.yellow('Token refresh failed, need to re-authenticate')}`);
      }
    }

    return await this.performOAuth2Flow();
  }

  async refreshAccessToken() {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
    }

    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000);

    this.saveTokens({
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      expiry: this.tokenExpiry,
    });

    return this.accessToken;
  }

  /**
   * Perform the full OAuth2 authorization flow: print the auth URL, receive
   * the callback on a temporary localhost server, exchange the code.
   */
  async performOAuth2Flow() {
    // Headless runs (pipeline, cron, background shells) must never open a
    // consent flow or camp on the 5-minute callback wait — fail fast with
    // the seeding instruction instead. stdout-TTY still counts as "a human
    // is watching" (#25), but OMEGA_NON_INTERACTIVE=1 beats everything.
    const { isInteractive } = require('@omega.js/devkit/prompt');
    if (process.env.OMEGA_NON_INTERACTIVE === '1' || (!isInteractive() && !process.stdout.isTTY)) {
      throw new Error(`Google consent required (scopes: ${this.scopes.join(', ')}) — run the service once interactively to grant it; headless runs work from the cached token after that`);
    }

    // The Enter-gate keypress listener must tear down however the flow
    // settles (Enter pressed, URL clicked directly, timeout, error) — a
    // pending listener holds stdin and zombies the process at exit.
    let disarm = null;

    const flow = new Promise((resolve, reject) => {
      // RFC 8252 §7.3 loopback: bind an EPHEMERAL port (listen(0)) and read
      // the real one at listen time — Google's desktop-app client type
      // accepts any localhost port, so nothing pins 9876 (which anything
      // else could be holding; N7 removes fixed dev ports). `redirectUri`
      // is assigned in the listen callback, before the server is reachable,
      // so the request handler never sees it null.
      let redirectUri = null;

      const server = createServer(async (req, res) => {
        const reqUrl = new URL(req.url, 'http://localhost');

        if (reqUrl.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');

        if (error) {
          res.writeHead(400);
          res.end(`Authorization failed: ${error}`);
          server.close();
          reject(new Error(`Authorization failed: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400);
          res.end('No authorization code received');
          server.close();
          reject(new Error('No authorization code received'));
          return;
        }

        try {
          const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              client_id: this.clientId,
              client_secret: this.clientSecret,
              code,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri,
            }),
          });

          const tokenData = await tokenResponse.json();

          if (tokenData.error) {
            throw new Error(`Token exchange failed: ${tokenData.error_description || tokenData.error}`);
          }

          this.accessToken = tokenData.access_token;
          this.refreshToken = tokenData.refresh_token;
          this.tokenExpiry = Date.now() + (tokenData.expires_in * 1000);

          this.saveTokens({
            access_token: this.accessToken,
            refresh_token: this.refreshToken,
            expiry: this.tokenExpiry,
            // A full re-consent may be a DIFFERENT Google account — the
            // cached identity is unknown until the next userinfo lookup
            account_email: null,
          });

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Authentication successful!</h1><p>You can close this window.</p></body></html>');
          server.close();
          resolve(this.accessToken);
        } catch (err) {
          res.writeHead(500);
          res.end(`Error: ${err.message}`);
          server.close();
          reject(err);
        }
      });

      server.listen(0, () => {
        const port = server.address().port;
        redirectUri = `http://localhost:${port}/callback`;

        const authUrl = new URL(GOOGLE_AUTH_URL);
        authUrl.searchParams.set('client_id', this.clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', this.scopes.join(' '));
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');

        console.log('');
        console.log(`  ${chalk.dim('→')} Google authentication required:`);
        console.log(`  ${chalk.cyan(authUrl.toString())}`);

        const { isInteractive: interactiveNow, openInBrowser } = require('@omega.js/devkit/prompt');
        if (interactiveNow()) {
          // House rule (cp101d): browser opens are gated behind Enter. Raw
          // keypress instead of a prompt — the consent can also complete via
          // a clicked URL, and the listener tears down on settle.
          disarm = this._armEnterToOpen(authUrl.toString());
        } else if (process.stdout.isTTY && openInBrowser(authUrl.toString())) {
          // stdout-TTY with piped stdin (npu wrapper, tee — #25): a human is
          // watching but nobody can press Enter, so auto-open remains.
          console.log(`  ${chalk.dim('→')} Opening your browser... (use the URL above if nothing appears)`);
        }
        console.log('');
      });

      // Timeout after 5 minutes (was 2 — humans relaying URLs need slack,
      // #25). unref + clear on settle: a finished flow must never hold the
      // event loop (a live run idled minutes after its summary — the zombie
      // timer from a SUCCESSFUL auth).
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error('Authentication timed out'));
      }, 300000);
      timeout.unref();
      server.on('close', () => clearTimeout(timeout));
    });

    return flow.finally(() => {
      if (disarm) {
        disarm();
      }
    });
  }

  /**
   * "Press Enter to open" on a raw keypress listener rather than a prompt:
   * the consent flow can settle without Enter ever being pressed (clicked
   * URL, timeout, error), and an abandoned prompt would pin stdin open.
   *
   * @returns {Function} disarm - Restores the input stream; call on settle.
   */
  _armEnterToOpen(url) {
    const { getPromptStreams, openInBrowser } = require('@omega.js/devkit/prompt');
    const { input, output } = getPromptStreams();
    output.write(`  ${chalk.dim('→')} Press ${chalk.bold('Enter')} to open the Google consent page in your browser...\n`);

    emitKeypressEvents(input);
    input.setRawMode?.(true);
    input.resume();

    let opened = false;
    const handler = (ch, key) => {
      if (key?.ctrl && key?.name === 'c') {
        process.exit();
      }
      if (key?.name === 'return' && !opened) {
        opened = true;
        openInBrowser(url);
        output.write(`  ${chalk.dim('→')} Opening your browser... (use the URL above if nothing appears)\n`);
      }
    };
    input.on('keypress', handler);

    return () => {
      input.removeListener('keypress', handler);
      input.setRawMode?.(false);
      input.pause();
    };
  }

  /**
   * Make an authenticated request to any Google API
   */
  async makeRequest(url, options = {}) {
    const token = await this.getAccessToken();

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // Some endpoints return empty body on success (204)
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return { success: true };
    }

    const data = await response.json();

    if (!response.ok) {
      const errorMessage = data.error?.message || JSON.stringify(data);
      let message = `Google API Error: ${errorMessage}`;
      // Permission failures are an IDENTITY seam, not a transient fault
      // (found live 2026-07-19: the manage identity had no role on a
      // hand-minted project and the raw 403 diagnosed nothing) — name the
      // acting account and both remedies right in the error.
      if (response.status === 403 || data.error?.status === 'PERMISSION_DENIED') {
        const email = await this.getAccountEmail();
        const project = url.match(/\/projects\/([a-zA-Z0-9-]+)/)?.[1];
        message += `\n      → acting Google identity: ${email || 'unknown'}${this.tokenStorePath ? ` (token store: ${this.tokenStorePath})` : ''}`;
        message += `\n      → grant it access${project ? ` — a project owner runs: gcloud projects add-iam-policy-binding ${project} --member=user:${email || '<email>'} --role=roles/owner` : ''} — or delete the token store and rerun interactively to consent as an owning account`;
      }
      const error = new Error(message);
      error.details = data.error?.details || null;
      error.status = data.error?.status || response.status;
      throw error;
    }

    return data;
  }
}

module.exports = { GoogleOAuth2Client, GOOGLE_SCOPES, googleTokenStorePath };
