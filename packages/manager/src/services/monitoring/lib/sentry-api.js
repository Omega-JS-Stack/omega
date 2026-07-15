/**
 * Sentry API client (api/0) — organizations, teams, projects, client keys.
 * Named-method surface so tests can fake it method-for-method.
 *
 * Auth: SENTRY_AUTH_TOKEN in the brand .env (an ORGANIZATION auth token —
 * it lists exactly the org it belongs to). Multi-region SaaS: every org
 * carries links.regionUrl; setRegionUrl() repoints the client so all
 * org-scoped calls hit the org's home region.
 */
const SENTRY_API_BASE = 'https://sentry.io/api/0';

class SentryAPI {
  constructor(options = {}) {
    this.authToken = options.authToken || process.env.SENTRY_AUTH_TOKEN;
    this.apiBase = SENTRY_API_BASE;
  }

  /** Repoint org-scoped calls at the org's home region (multi-region SaaS). */
  setRegionUrl(regionUrl) {
    if (regionUrl) {
      this.apiBase = `${regionUrl.replace(/\/$/, '')}/api/0`;
    }
  }

  async makeRequest(endpoint, options = {}) {
    const response = await fetch(`${this.apiBase}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.authToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (response.status === 204) {
      return null;
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const message = data?.detail
        || data?.message
        || response.statusText;
      throw new Error(`Sentry API error (${response.status}): ${message}`);
    }

    return data;
  }

  /** Organizations the token can see (an org token sees exactly one). */
  async getOrganizations() {
    return this.makeRequest('/organizations/');
  }

  /** Teams in the organization. */
  async getTeams(orgSlug) {
    return this.makeRequest(`/organizations/${orgSlug}/teams/`);
  }

  async createTeam(orgSlug, slug) {
    return this.makeRequest(`/organizations/${orgSlug}/teams/`, {
      method: 'POST',
      body: JSON.stringify({ slug }),
    });
  }

  /**
   * Projects in the organization (first 100 — slugs are matched exactly,
   * and a colliding create on a beyond-page project 409s honestly).
   */
  async getProjects(orgSlug) {
    return this.makeRequest(`/organizations/${orgSlug}/projects/?per_page=100`);
  }

  async createProject(orgSlug, teamSlug, { name, slug, platform }) {
    return this.makeRequest(`/teams/${orgSlug}/${teamSlug}/projects/`, {
      method: 'POST',
      body: JSON.stringify({ name, slug, platform }),
    });
  }

  /** Client keys for a project (a fresh project always has one). */
  async getProjectKeys(orgSlug, projectSlug) {
    return this.makeRequest(`/projects/${orgSlug}/${projectSlug}/keys/`);
  }
}

module.exports = { SentryAPI, SENTRY_API_BASE };
