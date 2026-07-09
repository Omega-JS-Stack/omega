/**
 * Firebase / Google Cloud API client — omega-manager's FirebaseAPI ported.
 * One authenticated fetch wrapper (Google OAuth2) fronting the Firebase
 * Management, Service Usage, Cloud Resource Manager, IAM, Billing, IAP,
 * Identity Toolkit, Firestore, Realtime Database, Storage, and Hosting APIs.
 *
 * Every call handlers make is a named method here (nothing reaches into the
 * auth layer directly) — tests fake this surface method-for-method.
 *
 * Auth: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the brand .env; tokens
 * cache to the brand's .omega/auth/google-tokens.json.
 */
const { GoogleOAuth2Client } = require('../../../lib/google-auth.js');

const FIREBASE_API_BASE = 'https://firebase.googleapis.com/v1beta1';
const SERVICE_USAGE_API_BASE = 'https://serviceusage.googleapis.com/v1';
const IDENTITY_TOOLKIT_API_BASE = 'https://identitytoolkit.googleapis.com/v2';
const FIREBASE_HOSTING_API_BASE = 'https://firebasehosting.googleapis.com/v1beta1';
const RESOURCE_MANAGER_V1 = 'https://cloudresourcemanager.googleapis.com/v1';
const RESOURCE_MANAGER_V3 = 'https://cloudresourcemanager.googleapis.com/v3';
const FIRESTORE_API_BASE = 'https://firestore.googleapis.com/v1';

// Firebase Management + Cloud Platform (includes IAM, Billing, Service Usage)
const SCOPES = [
  'https://www.googleapis.com/auth/firebase',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/cloud-billing',
];

class FirebaseAPI {
  constructor(options = {}) {
    this.auth = new GoogleOAuth2Client({
      clientId: options.clientId || process.env.GOOGLE_CLIENT_ID,
      clientSecret: options.clientSecret || process.env.GOOGLE_CLIENT_SECRET,
      tokenStorePath: options.tokenStorePath || null,
      scopes: SCOPES,
    });
  }

  request(url, options = {}) {
    return this.auth.makeRequest(url, options);
  }

  /**
   * Poll a long-running operation until it completes
   */
  async waitForOperation(operationName, apiBase, options = {}) {
    const maxAttempts = options.maxAttempts || 30;
    const delayMs = options.delayMs || 2000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const operation = await this.request(`${apiBase}/${operationName}`);

      if (operation.done) {
        if (operation.error) {
          throw new Error(`Operation failed: ${operation.error.message}`);
        }
        return operation.response;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error('Operation timed out');
  }

  // ===========================================================================
  // FIREBASE MANAGEMENT — projects + web apps
  // ===========================================================================

  /** Firebase project details (null if inaccessible) */
  async getProject(projectId) {
    try {
      return await this.request(`${FIREBASE_API_BASE}/projects/${projectId}`);
    } catch {
      return null;
    }
  }

  /** All Firebase projects visible to the authed user */
  async listProjects() {
    const response = await this.request(`${FIREBASE_API_BASE}/projects`);
    return response.results || [];
  }

  /**
   * Create a GCP project (inside the organization when configured — that's
   * what gives the compute service account its default roles) and add
   * Firebase to it. Both are long-running operations, awaited.
   */
  async createProject(projectId, displayName, organizationId = null) {
    const payload = { projectId, name: displayName };
    if (organizationId) {
      payload.parent = { type: 'organization', id: organizationId };
    }

    const gcpResponse = await this.request(`${RESOURCE_MANAGER_V1}/projects`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (gcpResponse.name) {
      await this.waitForOperation(gcpResponse.name, RESOURCE_MANAGER_V1);
    }

    const firebaseResponse = await this.request(`${FIREBASE_API_BASE}/projects/${projectId}:addFirebase`, {
      method: 'POST',
    });
    if (firebaseResponse.name) {
      await this.waitForOperation(firebaseResponse.name, FIREBASE_API_BASE);
    }

    return { projectId, displayName };
  }

  async listWebApps(projectId) {
    const response = await this.request(`${FIREBASE_API_BASE}/projects/${projectId}/webApps`);
    return response.apps || [];
  }

  /** Create a web app; waits for the operation and returns the appId */
  async createWebApp(projectId, displayName) {
    const response = await this.request(`${FIREBASE_API_BASE}/projects/${projectId}/webApps`, {
      method: 'POST',
      body: JSON.stringify({ displayName }),
    });

    if (response.name) {
      const result = await this.waitForOperation(response.name, FIREBASE_API_BASE);
      return result?.appId;
    }

    return response.appId;
  }

  async updateWebAppDisplayName(projectId, appId, displayName) {
    return this.request(`${FIREBASE_API_BASE}/projects/${projectId}/webApps/${appId}?updateMask=displayName`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName }),
    });
  }

  /** SDK config for an existing web app */
  async getWebAppConfig(projectId, appId) {
    return this.request(`${FIREBASE_API_BASE}/projects/${projectId}/webApps/${appId}/config`);
  }

  // ===========================================================================
  // CLOUD RESOURCE MANAGER — GCP project identity + IAM policy
  // ===========================================================================

  /** GCP project (v3 — carries the editable displayName) */
  async getGcpProject(projectId) {
    try {
      return await this.request(`${RESOURCE_MANAGER_V3}/projects/${projectId}`);
    } catch {
      return null;
    }
  }

  async updateProjectName(projectId, displayName) {
    return this.request(`${RESOURCE_MANAGER_V3}/projects/${projectId}?updateMask=displayName`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName }),
    });
  }

  /** Project number (required by the Service Usage API) */
  async getProjectNumber(projectId) {
    if (this._projectNumbers?.[projectId]) {
      return this._projectNumbers[projectId];
    }
    const response = await this.request(`${RESOURCE_MANAGER_V1}/projects/${projectId}`);
    this._projectNumbers = this._projectNumbers || {};
    this._projectNumbers[projectId] = response.projectNumber;
    return response.projectNumber;
  }

  async getIamPolicy(projectId) {
    return this.request(`${RESOURCE_MANAGER_V1}/projects/${projectId}:getIamPolicy`, {
      method: 'POST',
      body: JSON.stringify({ options: { requestedPolicyVersion: 3 } }),
    });
  }

  async setIamPolicy(projectId, policy) {
    return this.request(`${RESOURCE_MANAGER_V1}/projects/${projectId}:setIamPolicy`, {
      method: 'POST',
      body: JSON.stringify({ policy }),
    });
  }

  // ===========================================================================
  // SERVICE USAGE — Google Cloud API enablement
  // ===========================================================================

  /** Names (e.g. 'firebase.googleapis.com') of all ENABLED services */
  async listEnabledServices(projectId) {
    const projectNumber = await this.getProjectNumber(projectId);
    const enabled = [];
    let pageToken = '';

    do {
      const url = `${SERVICE_USAGE_API_BASE}/projects/${projectNumber}/services?filter=state:ENABLED&pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const response = await this.request(url);
      for (const service of response.services || []) {
        // name is 'projects/{n}/services/{serviceName}'
        enabled.push(service.name.split('/').pop());
      }
      pageToken = response.nextPageToken || '';
    } while (pageToken);

    return enabled;
  }

  async isServiceEnabled(projectId, serviceName) {
    const projectNumber = await this.getProjectNumber(projectId);
    try {
      const response = await this.request(`${SERVICE_USAGE_API_BASE}/projects/${projectNumber}/services/${serviceName}`);
      return response.state === 'ENABLED';
    } catch {
      return false;
    }
  }

  async enableService(projectId, serviceName) {
    const projectNumber = await this.getProjectNumber(projectId);
    const response = await this.request(`${SERVICE_USAGE_API_BASE}/projects/${projectNumber}/services/${serviceName}:enable`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    if (response.name) {
      await this.waitForOperation(response.name, SERVICE_USAGE_API_BASE);
    }

    return { enabled: true, service: serviceName };
  }

  async enableServices(projectId, serviceNames) {
    const projectNumber = await this.getProjectNumber(projectId);
    const response = await this.request(`${SERVICE_USAGE_API_BASE}/projects/${projectNumber}/services:batchEnable`, {
      method: 'POST',
      body: JSON.stringify({ serviceIds: serviceNames }),
    });

    if (response.name) {
      await this.waitForOperation(response.name, SERVICE_USAGE_API_BASE);
    }

    return { enabled: true, services: serviceNames };
  }

  // ===========================================================================
  // IAM — service accounts
  // ===========================================================================

  async listServiceAccounts(projectId) {
    try {
      const response = await this.request(`https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts`);
      return response.accounts || [];
    } catch {
      return [];
    }
  }

  async createServiceAccount(projectId, accountId, displayName) {
    return this.request(`https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts`, {
      method: 'POST',
      body: JSON.stringify({
        accountId,
        serviceAccount: { displayName },
      }),
    });
  }

  /**
   * Create and download a service account key — returned decoded (Google
   * only shows keys ONCE at creation; they cannot be re-downloaded)
   */
  async createServiceAccountKey(projectId, serviceAccountEmail) {
    const response = await this.request(`https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts/${serviceAccountEmail}/keys`, {
      method: 'POST',
      body: JSON.stringify({ privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE' }),
    });

    if (response.privateKeyData) {
      return JSON.parse(Buffer.from(response.privateKeyData, 'base64').toString('utf8'));
    }

    return response;
  }

  // ===========================================================================
  // BILLING — Blaze plan
  // ===========================================================================

  async getProjectBillingInfo(projectId) {
    try {
      return await this.request(`https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`);
    } catch {
      return null;
    }
  }

  async linkBillingAccount(projectId, billingAccountName) {
    return this.request(`https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`, {
      method: 'PUT',
      body: JSON.stringify({ billingAccountName }),
    });
  }

  // ===========================================================================
  // IAP — OAuth consent screen (brand)
  // ===========================================================================

  async listBrands(projectId) {
    try {
      const response = await this.request(`https://iap.googleapis.com/v1/projects/${projectId}/brands`);
      return response.brands || [];
    } catch {
      return [];
    }
  }

  /** supportEmail must be the caller's email or a Google Group they own */
  async createBrand(projectId, applicationTitle, supportEmail) {
    return this.request(`https://iap.googleapis.com/v1/projects/${projectId}/brands`, {
      method: 'POST',
      body: JSON.stringify({ applicationTitle, supportEmail }),
    });
  }

  // ===========================================================================
  // IDENTITY TOOLKIT — authentication configuration
  // ===========================================================================

  /** Upgrade Firebase Auth to Identity Platform (requires Blaze) */
  async initializeIdentityPlatform(projectId) {
    return this.request(`${IDENTITY_TOOLKIT_API_BASE}/projects/${projectId}/identityPlatform:initializeAuth`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async getIdentityConfig(projectId) {
    try {
      return await this.request(`${IDENTITY_TOOLKIT_API_BASE}/projects/${projectId}/config`);
    } catch {
      return null;
    }
  }

  async updateIdentityConfig(projectId, config) {
    const updateMask = Object.keys(config).join(',');
    return this.request(`${IDENTITY_TOOLKIT_API_BASE}/projects/${projectId}/config?updateMask=${updateMask}`, {
      method: 'PATCH',
      body: JSON.stringify(config),
    });
  }

  async getIdpConfig(projectId, idpId) {
    try {
      return await this.request(`${IDENTITY_TOOLKIT_API_BASE}/projects/${projectId}/defaultSupportedIdpConfigs/${idpId}`);
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // FIRESTORE
  // ===========================================================================

  async getFirestoreDatabase(projectId, databaseId = '(default)') {
    try {
      return await this.request(`${FIRESTORE_API_BASE}/projects/${projectId}/databases/${databaseId}`);
    } catch {
      return null;
    }
  }

  async createFirestoreDatabase(projectId, locationId = 'nam5') {
    const response = await this.request(`${FIRESTORE_API_BASE}/projects/${projectId}/databases?databaseId=(default)`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'FIRESTORE_NATIVE',
        locationId,
      }),
    });

    if (response.name) {
      await this.waitForOperation(response.name, FIRESTORE_API_BASE);
    }

    return response;
  }

  /** Enable Point-in-Time Recovery (7-day disaster recovery) */
  async enableFirestorePITR(projectId, databaseId = '(default)') {
    const response = await this.request(`${FIRESTORE_API_BASE}/projects/${projectId}/databases/${databaseId}?updateMask=pointInTimeRecoveryEnablement`, {
      method: 'PATCH',
      body: JSON.stringify({
        pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_ENABLED',
      }),
    });

    if (response.name?.includes('operations')) {
      await this.waitForOperation(response.name, FIRESTORE_API_BASE);
    }

    return response;
  }

  // ===========================================================================
  // REALTIME DATABASE
  // ===========================================================================

  async listRealtimeDatabases(projectId) {
    try {
      const response = await this.request(`https://firebasedatabase.googleapis.com/v1beta/projects/${projectId}/locations/-/instances`);
      return response.instances || [];
    } catch {
      return [];
    }
  }

  /** The default instance must be named {projectId}-default-rtdb */
  async createRealtimeDatabase(projectId, locationId = 'us-central1') {
    const databaseId = `${projectId}-default-rtdb`;
    return this.request(`https://firebasedatabase.googleapis.com/v1beta/projects/${projectId}/locations/${locationId}/instances?databaseId=${databaseId}`, {
      method: 'POST',
      body: JSON.stringify({ type: 'DEFAULT_DATABASE' }),
    });
  }

  // ===========================================================================
  // STORAGE
  // ===========================================================================

  async getStorageBucket(projectId) {
    try {
      const response = await this.request(`https://firebasestorage.googleapis.com/v1beta/projects/${projectId}/defaultBucket`);
      return response?.bucket || null;
    } catch {
      return null;
    }
  }

  /**
   * Create the default bucket via the Firebase Storage API (new buckets are
   * {projectId}.firebasestorage.app; pre-Oct-2024 ones {projectId}.appspot.com)
   */
  async createDefaultStorageBucket(projectId, location = 'us-central1') {
    const existing = await this.getStorageBucket(projectId);
    if (existing?.name) {
      return { alreadyLinked: true, bucket: existing.name };
    }

    try {
      const response = await this.request(`https://firebasestorage.googleapis.com/v1beta/projects/${projectId}/defaultBucket`, {
        method: 'POST',
        body: JSON.stringify({
          location,
          storageClass: 'STANDARD',
        }),
      });

      const bucketName = response?.bucket?.name || response?.name;
      return { created: true, bucket: bucketName };
    } catch (error) {
      if (error.message?.includes('already') || error.message?.includes('409')) {
        const bucket = await this.getStorageBucket(projectId);
        return { alreadyLinked: true, bucket: bucket?.name };
      }

      throw error;
    }
  }

  // ===========================================================================
  // HOSTING — sites + custom domains
  // ===========================================================================

  async listHostingSites(projectId) {
    const response = await this.request(`${FIREBASE_HOSTING_API_BASE}/projects/${projectId}/sites`);
    return response.sites || [];
  }

  async createHostingSite(projectId, siteId) {
    return this.request(`${FIREBASE_HOSTING_API_BASE}/projects/${projectId}/sites?siteId=${siteId}`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async getCustomDomain(projectId, siteId, domainName) {
    const encodedDomain = encodeURIComponent(domainName);
    try {
      return await this.request(`${FIREBASE_HOSTING_API_BASE}/projects/${projectId}/sites/${siteId}/customDomains/${encodedDomain}`);
    } catch {
      return null;
    }
  }

  async createCustomDomain(projectId, siteId, domainName) {
    const encodedDomain = encodeURIComponent(domainName);
    const response = await this.request(`${FIREBASE_HOSTING_API_BASE}/projects/${projectId}/sites/${siteId}/customDomains?customDomainId=${encodedDomain}`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    if (response.name?.includes('operations')) {
      await this.waitForOperation(response.name, FIREBASE_HOSTING_API_BASE);
    }

    return response;
  }

  async undeleteCustomDomain(projectId, siteId, domainName) {
    const encodedDomain = encodeURIComponent(domainName);
    const response = await this.request(`${FIREBASE_HOSTING_API_BASE}/projects/${projectId}/sites/${siteId}/customDomains/${encodedDomain}:undelete`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    if (response.name?.includes('operations')) {
      await this.waitForOperation(response.name, FIREBASE_HOSTING_API_BASE);
    }

    return response;
  }

  /**
   * Domain verification status:
   * { exists, verified, deleted?, ownershipState, hostState, certState, requiredDnsUpdates }
   */
  async checkDomainStatus(projectId, siteId, domainName) {
    const domain = await this.getCustomDomain(projectId, siteId, domainName);

    if (!domain) {
      return { verified: false, exists: false };
    }

    if (domain.deleteTime) {
      return { verified: false, exists: false, deleted: true };
    }

    const ownershipActive = domain.ownershipState === 'OWNERSHIP_ACTIVE';
    const hostActive = domain.hostState === 'HOST_ACTIVE';
    const verified = ownershipActive && hostActive;

    // requiredDnsUpdates: { discovered: [...], desired: [...] } — we want desired
    let dnsUpdates = [];
    if (domain.requiredDnsUpdates) {
      if (Array.isArray(domain.requiredDnsUpdates.desired)) {
        dnsUpdates = domain.requiredDnsUpdates.desired;
      } else if (Array.isArray(domain.requiredDnsUpdates)) {
        dnsUpdates = domain.requiredDnsUpdates;
      }
    }

    // ACME challenge for SSL rides in cert.verification.dns.desired
    if (Array.isArray(domain.cert?.verification?.dns?.desired)) {
      dnsUpdates = [...dnsUpdates, ...domain.cert.verification.dns.desired];
    }

    return {
      exists: true,
      verified,
      ownershipState: domain.ownershipState,
      certState: domain.certState,
      hostState: domain.hostState,
      requiredDnsUpdates: dnsUpdates,
    };
  }
}

module.exports = { FirebaseAPI };
