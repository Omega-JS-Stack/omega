/**
 * @omega.js/backend HTTP Client
 *
 * Makes authenticated HTTP calls to a running @omega.js/backend server (local or production).
 * Supports admin key auth (the omega-admin-key header) and user token auth
 * (API key from OAuth flow, via Authorization: Bearer).
 */
const fetch = require('wonderful-fetch');

class BEMClient {
  constructor(options) {
    options = options || {};

    this.baseUrl = (options.baseUrl || '').replace(/\/+$/, '');
    this.adminKey = options.adminKey || '';
    this.userToken = options.userToken || '';
  }

  /**
   * Call a @omega.js/backend route
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
   * @param {string} path - The HTTP path as served (e.g. "/omega/admin/firestore", "/notes")
   * @param {object} params - Request parameters
   * @returns {object} - Parsed response
   */
  async call(method, path, params) {
    // The path is taken as served, so a relative one would silently glue onto the host
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new Error(`[@omega.js/backend:mcp] client.call(): path "${path}" must be the HTTP path as served, starting with "/"`);
    }

    params = params || {};
    method = method.toUpperCase();

    const url = new URL(`${this.baseUrl}${path}`);

    const fetchOptions = {
      method: method,
      response: 'json',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    };

    if (this.adminKey) {
      // Admin key auth — the omega-admin-key header on every method (never
      // the query string or body)
      fetchOptions.headers['omega-admin-key'] = this.adminKey;

      if (method === 'GET') {
        for (const [key, value] of Object.entries(params)) {
          if (value === undefined || value === null) {
            continue;
          }

          url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
        }
      } else {
        fetchOptions.body = JSON.stringify(params);
      }
    } else if (this.userToken) {
      // User token auth — Bearer header + authenticationToken param
      fetchOptions.headers['Authorization'] = `Bearer ${this.userToken}`;

      if (method === 'GET') {
        url.searchParams.set('authenticationToken', this.userToken);

        for (const [key, value] of Object.entries(params)) {
          if (value === undefined || value === null) {
            continue;
          }

          url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
        }
      } else {
        fetchOptions.body = JSON.stringify({
          authenticationToken: this.userToken,
          ...params,
        });
      }
    } else {
      // Unauthenticated
      if (method === 'GET') {
        for (const [key, value] of Object.entries(params)) {
          if (value === undefined || value === null) {
            continue;
          }

          url.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
        }
      } else {
        fetchOptions.body = JSON.stringify(params);
      }
    }

    const response = await fetch(url.toString(), fetchOptions);

    return response;
  }
}

module.exports = BEMClient;
