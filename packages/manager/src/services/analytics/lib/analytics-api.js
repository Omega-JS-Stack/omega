/**
 * Google Analytics Admin API client (v1beta, plus the v1alpha enhanced-
 * measurement endpoints that never made it into beta). Named-method surface
 * over the shared GoogleOAuth2Client so tests can fake it method-for-method.
 *
 * Auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the brand .env; the ONE
 * shared token store (GOOGLE_SCOPES union — one consent covers everything).
 */
const { GoogleOAuth2Client, GOOGLE_SCOPES } = require('../../../lib/google-auth.js');

const API_BASE = 'https://analyticsadmin.googleapis.com/v1beta';
const API_BASE_ALPHA = 'https://analyticsadmin.googleapis.com/v1alpha';

class GoogleAnalyticsAPI {
  constructor(options = {}) {
    this.auth = new GoogleOAuth2Client({
      clientId: options.clientId || process.env.GOOGLE_CLIENT_ID,
      clientSecret: options.clientSecret || process.env.GOOGLE_CLIENT_SECRET,
      tokenStorePath: options.tokenStorePath,
      scopes: GOOGLE_SCOPES,
    });
  }

  async makeRequest(endpoint, options = {}) {
    return this.auth.makeRequest(`${API_BASE}${endpoint}`, options);
  }

  // ========== Accounts / properties ==========

  async listAccounts() {
    const data = await this.makeRequest('/accounts');
    return data.accounts || [];
  }

  async listProperties(accountId) {
    const data = await this.makeRequest(`/properties?filter=parent:accounts/${accountId}`);
    return data.properties || [];
  }

  /** Create a GA4 property under an account; returns the property resource */
  async createProperty(accountId, { displayName, timeZone, currencyCode }) {
    return this.makeRequest('/properties', {
      method: 'POST',
      body: JSON.stringify({
        parent: `accounts/${accountId}`,
        displayName,
        timeZone,
        currencyCode,
      }),
    });
  }

  async getProperty(propertyId) {
    try {
      return await this.makeRequest(`/properties/${propertyId}`);
    } catch (error) {
      if (error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  // ========== Data streams ==========

  async listDataStreams(propertyId) {
    const data = await this.makeRequest(`/properties/${propertyId}/dataStreams`);
    return data.dataStreams || [];
  }

  async createWebDataStream(propertyId, { defaultUri, displayName }) {
    return await this.makeRequest(`/properties/${propertyId}/dataStreams`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'WEB_DATA_STREAM',
        webStreamData: { defaultUri },
        displayName: displayName || 'Web Stream',
      }),
    });
  }

  /**
   * Update a data stream. Nested paths (e.g. 'webStreamData.defaultUri') need
   * an explicit update mask — Object.keys would produce just 'webStreamData'.
   */
  async updateDataStream(propertyId, dataStreamId, updates, updateMaskFields) {
    const updateMask = (updateMaskFields || Object.keys(updates)).join(',');
    return await this.makeRequest(
      `/properties/${propertyId}/dataStreams/${dataStreamId}?updateMask=${updateMask}`,
      { method: 'PATCH', body: JSON.stringify(updates) },
    );
  }

  // ========== Enhanced measurement (v1alpha only) ==========

  async getEnhancedMeasurementSettings(propertyId, dataStreamId) {
    return this.auth.makeRequest(
      `${API_BASE_ALPHA}/properties/${propertyId}/dataStreams/${dataStreamId}/enhancedMeasurementSettings`,
    );
  }

  async updateEnhancedMeasurementSettings(propertyId, dataStreamId, settings) {
    const updateMask = Object.keys(settings).join(',');
    return this.auth.makeRequest(
      `${API_BASE_ALPHA}/properties/${propertyId}/dataStreams/${dataStreamId}/enhancedMeasurementSettings?updateMask=${updateMask}`,
      { method: 'PATCH', body: JSON.stringify(settings) },
    );
  }

  // ========== Measurement Protocol secrets ==========

  async listMeasurementProtocolSecrets(propertyId, dataStreamId) {
    const data = await this.makeRequest(
      `/properties/${propertyId}/dataStreams/${dataStreamId}/measurementProtocolSecrets`,
    );
    return data.measurementProtocolSecrets || [];
  }

  async createMeasurementProtocolSecret(propertyId, dataStreamId, displayName) {
    return await this.makeRequest(
      `/properties/${propertyId}/dataStreams/${dataStreamId}/measurementProtocolSecrets`,
      { method: 'POST', body: JSON.stringify({ displayName }) },
    );
  }

  async deleteMeasurementProtocolSecret(propertyId, dataStreamId, secretId) {
    await this.makeRequest(
      `/properties/${propertyId}/dataStreams/${dataStreamId}/measurementProtocolSecrets/${secretId}`,
      { method: 'DELETE' },
    );
    return { deleted: true };
  }

  // ========== Firebase links ==========

  async listFirebaseLinks(propertyId) {
    const data = await this.makeRequest(`/properties/${propertyId}/firebaseLinks`);
    return data.firebaseLinks || [];
  }

  async createFirebaseLink(propertyId, firebaseProjectId) {
    return await this.makeRequest(`/properties/${propertyId}/firebaseLinks`, {
      method: 'POST',
      body: JSON.stringify({ project: `projects/${firebaseProjectId}` }),
    });
  }

  async deleteFirebaseLink(propertyId, firebaseLinkId) {
    await this.makeRequest(`/properties/${propertyId}/firebaseLinks/${firebaseLinkId}`, {
      method: 'DELETE',
    });
    return { deleted: true };
  }
}

module.exports = { GoogleAnalyticsAPI };
