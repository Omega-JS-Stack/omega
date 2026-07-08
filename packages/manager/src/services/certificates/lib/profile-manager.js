/**
 * Provisioning profile CRUD + the cert-type → profile-type mapping.
 * Profiles bind a bundle ID + certificate (+ devices for development
 * profiles), so they're per-brand even though certificates are one set
 * per Apple Developer account.
 */
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const { API_BASE } = require('./apple-api.js');

/**
 * Cert type → the provisioning profile type that consumes it. Installer
 * cert types need no profile (null). Both G1 and G2 Developer ID
 * Application certs use MAC_APP_DIRECT — Apple distinguishes them by the
 * underlying cert chain.
 */
const CERT_TYPE_TO_PROFILE_TYPE = {
  DEVELOPMENT: 'IOS_APP_DEVELOPMENT',
  IOS_DISTRIBUTION: 'IOS_APP_STORE',
  MAC_INSTALLER_DISTRIBUTION: null,
  MAC_APP_DISTRIBUTION: 'MAC_APP_STORE',
  DEVELOPER_ID_APPLICATION: 'MAC_APP_DIRECT',
  DEVELOPER_ID_APPLICATION_G2: 'MAC_APP_DIRECT',
  DEVELOPER_ID_INSTALLER: null,
  DEVELOPER_ID_INSTALLER_G2: null,
};

function getProfileTypeForCertType(certType) {
  return CERT_TYPE_TO_PROFILE_TYPE[certType];
}

/**
 * Whether a cert type applies to a platform: IOS_DISTRIBUTION → IOS only;
 * MAC_* and DEVELOPER_ID_* → MACOS only; DEVELOPMENT → both.
 */
function certAppliesToPlatform(certType, platform) {
  if (platform === 'IOS') return certType.includes('IOS') || certType === 'DEVELOPMENT';
  if (platform === 'MACOS') return certType.includes('MAC') || certType.includes('DEVELOPER_ID') || certType === 'DEVELOPMENT';
  return false;
}

async function listProfiles(client) {
  return client.paginate(`${API_BASE}/profiles?limit=200`);
}

async function listDevices(client) {
  return client.paginate(`${API_BASE}/devices?limit=200`);
}

/**
 * Download a provisioning profile's content to disk as .mobileprovision.
 */
async function downloadProfile(client, profileId, outputPath) {
  const data = await client.request(`${API_BASE}/profiles/${profileId}`);
  const profileContent = data?.data?.attributes?.profileContent;
  if (!profileContent) {
    throw new Error(`Profile ${profileId} has no profileContent`);
  }
  jetpack.write(outputPath, Buffer.from(profileContent, 'base64'));
  console.log(`        ${chalk.green('✓')} Downloaded ${chalk.gray(outputPath)}`);
}

/**
 * Create a provisioning profile linking a bundle ID + cert (+ devices for
 * development profiles).
 */
async function createProfile(client, name, profileType, bundleIdId, certificateIds, deviceIds = []) {
  const body = {
    data: {
      type: 'profiles',
      attributes: { name, profileType },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundleIdId } },
        certificates: {
          data: certificateIds.map((id) => ({ type: 'certificates', id })),
        },
      },
    },
  };

  if (deviceIds.length > 0) {
    body.data.relationships.devices = {
      data: deviceIds.map((id) => ({ type: 'devices', id })),
    };
  }

  const data = await client.request(`${API_BASE}/profiles`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return data.data;
}

/**
 * Find a non-expired profile matching the exact name + type.
 */
function findValidProfile(existingProfiles, profileType, profileName) {
  const now = new Date();
  return existingProfiles.find((profile) => {
    return profile.attributes.profileType === profileType
      && profile.attributes.name === profileName
      && new Date(profile.attributes.expirationDate) > now;
  }) || null;
}

module.exports = {
  getProfileTypeForCertType,
  certAppliesToPlatform,
  listProfiles,
  listDevices,
  downloadProfile,
  createProfile,
  findValidProfile,
};
