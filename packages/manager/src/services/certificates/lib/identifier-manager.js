/**
 * Bundle ID CRUD + capability management against the App Store Connect
 * API. Apple's `platform` field on the bundle ID record is decorative — a
 * single IOS-platform bundle ID works for all Apple platforms; the
 * provisioning profile's profileType selects the actual platform.
 */
const { API_BASE } = require('./apple-api.js');

/**
 * List all bundle IDs (paginated).
 */
async function listBundleIds(client) {
  return client.paginate(`${API_BASE}/bundleIds?limit=200`);
}

/**
 * List the capabilities currently enabled on a bundle ID.
 */
async function listBundleIdCapabilities(client, bundleIdId) {
  return client.paginate(`${API_BASE}/bundleIds/${bundleIdId}/bundleIdCapabilities`);
}

/**
 * Create a bundle ID and enable the requested capabilities.
 */
async function createBundleId(client, identifier, name, platform = 'IOS', capabilities = []) {
  const data = await client.request(`${API_BASE}/bundleIds`, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'bundleIds',
        attributes: { identifier, name, platform },
      },
    }),
  });
  const bundleId = data.data;

  if (capabilities.length > 0) {
    await enableCapabilities(client, bundleId.id, capabilities);
  }

  return bundleId;
}

/**
 * Enable each capability on a bundle ID, tolerating per-capability
 * failures (some capabilities reject benignly depending on account
 * entitlements — the caller logs each result).
 *
 * APPLE_ID_AUTH (Sign in with Apple) requires a `settings` block marking
 * the app as the primary consent app — Apple rejects it otherwise.
 *
 * @returns {Array<{ capability, success, error? }>}
 */
async function enableCapabilities(client, bundleIdId, capabilities) {
  if (!capabilities?.length) {
    return [];
  }

  const results = [];
  for (const capabilityType of capabilities) {
    const body = {
      data: {
        type: 'bundleIdCapabilities',
        attributes: { capabilityType },
        relationships: {
          bundleId: { data: { type: 'bundleIds', id: bundleIdId } },
        },
      },
    };

    if (capabilityType === 'APPLE_ID_AUTH') {
      body.data.attributes.settings = [
        {
          key: 'APPLE_ID_AUTH_APP_CONSENT',
          options: [{ key: 'PRIMARY_APP_CONSENT', enabled: true }],
        },
      ];
    }

    try {
      await client.request(`${API_BASE}/bundleIdCapabilities`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      results.push({ capability: capabilityType, success: true });
    } catch (error) {
      results.push({ capability: capabilityType, success: false, error: error.message });
    }
  }
  return results;
}

/**
 * Find an existing bundle ID matching `identifier` (case-sensitive).
 */
function findBundleId(existingBundleIds, identifier) {
  return existingBundleIds.find((b) => b.attributes.identifier === identifier) || null;
}

module.exports = {
  listBundleIds,
  listBundleIdCapabilities,
  createBundleId,
  enableCapabilities,
  findBundleId,
};
