/**
 * Google OAuth2 client — omega-manager's shared Google auth handler, ported.
 * Handles token storage, refresh, and the one-time browser authorization flow
 * (localhost callback server; the auth URL is printed for click-through — no
 * browser auto-open dependency).
 *
 * Credentials come from GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the brand
 * .env; tokens cache to the brand's gitignored .omega/auth/ directory.
 */
const { createServer } = require('node:http');
const { dirname } = require('node:path');
const fs = require('node:fs');
const chalk = require('chalk').default;

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

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
    fs.writeFileSync(this.tokenStorePath, JSON.stringify(tokens, null, 2));
  }

  /**
   * Get a valid access token (from cache, refresh, or new auth)
   */
  async getAccessToken() {
    const storedTokens = this.loadStoredTokens();

    if (storedTokens) {
      this.accessToken = storedTokens.access_token;
      this.refreshToken = storedTokens.refresh_token;
      this.tokenExpiry = storedTokens.expiry;
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
    return new Promise((resolve, reject) => {
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

        // Auto-open in interactive terminals (omega-manager convention) —
        // the printed URL stays the fallback. Kills the dead-link race
        // where a human reads the URL after its listener expired (#25).
        const { isInteractive, openInBrowser } = require('@omega.js/devkit/prompt');
        if (isInteractive() && openInBrowser(authUrl.toString())) {
          console.log(`  ${chalk.dim('→')} Opening your browser... (use the URL above if nothing appears)`);
        }
        console.log('');
      });

      // Timeout after 5 minutes (was 2 — humans relaying URLs need slack, #25)
      setTimeout(() => {
        server.close();
        reject(new Error('Authentication timed out'));
      }, 300000);
    });
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
      const error = new Error(`Google API Error: ${errorMessage}`);
      error.details = data.error?.details || null;
      error.status = data.error?.status || response.status;
      throw error;
    }

    return data;
  }
}

module.exports = { GoogleOAuth2Client };
