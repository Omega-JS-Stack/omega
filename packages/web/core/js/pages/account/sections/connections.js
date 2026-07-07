/**
 * Connections Section JavaScript - OAuth account linking
 */

// Libraries
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import webManager from 'web-manager';

let oauth2Config = null;
let accountData = null;
let connectionForms = new Map();

// Supported providers (must match IDs in HTML)
const supportedProviders = ['google', 'discord', 'github', 'twitter', 'facebook', 'spotify', 'apple', 'microsoft', 'linkedin', 'twitch', 'slack'];

// Get API URL helper
function getApiUrl() {
  return `${webManager.getApiUrl()}/backend-manager/user/oauth2`;
}

// Initialize connections section
export async function init() {
}

// Load connections data
export async function loadData(account, sharedOAuth2Config) {
  if (!account) {
    return;
  }

  accountData = account;
  oauth2Config = sharedOAuth2Config;

  displayConnections();
}

// Display available and connected OAuth providers
function displayConnections() {
  const $loading = document.getElementById('connections-loading');

  if ($loading) {
    $loading.classList.add('d-none');
  }

  if (!oauth2Config) {
    if ($loading) {
      $loading.classList.remove('d-none');
    }
    return;
  }

  const availableProviders = oauth2Config;
  const userConnections = accountData?.oauth2 || {};

  let hasEnabledProviders = false;

  supportedProviders.forEach(providerId => {
    const providerSettings = availableProviders[providerId];
    const $providerElement = document.getElementById(`connection-${providerId}`);

    if (!$providerElement) {
      return;
    }

    const isEnabled = providerSettings && providerSettings.enabled !== false;

    if (isEnabled) {
      hasEnabledProviders = true;
      $providerElement.classList.remove('d-none');

      initializeProviderForm(providerId);

      const userConnection = userConnections[providerId];
      updateProviderStatus(providerId, userConnection, providerSettings);
    } else {
      $providerElement.classList.add('d-none');
    }
  });

  // Show warning cards for enabled API providers missing from the HTML template
  const $connectionsList = document.getElementById('connections-list');
  Object.keys(availableProviders).forEach(providerId => {
    const providerSettings = availableProviders[providerId];
    const isEnabled = providerSettings && providerSettings.enabled !== false;

    if (!isEnabled) {
      return;
    }

    const $existing = document.getElementById(`connection-${providerId}`);
    if ($existing) {
      return;
    }

    // Provider is enabled in API but has no HTML element — create a warning card
    hasEnabledProviders = true;
    console.warn(`[Connections] Provider "${providerId}" is enabled in brand config but missing from the account page template. Add it to the connections frontmatter list.`);

    const warningId = `connection-${providerId}-unconfigured`;
    if (document.getElementById(warningId)) {
      return;
    }

    const providerName = providerId.charAt(0).toUpperCase() + providerId.slice(1);
    const $warning = document.createElement('div');
    $warning.id = warningId;
    $warning.className = 'border-top px-0 py-3';
    $warning.innerHTML = `
      <div class="d-flex flex-column flex-sm-row align-items-stretch align-items-sm-center justify-content-between gap-3">
        <div class="d-flex align-items-center">
          <div class="d-flex align-items-center justify-content-center me-3 flex-shrink-0" style="width: 1.875em; font-size: 1.5rem;">
            &#9888;
          </div>
          <div>
            <h6 class="mb-0">${webManager.utilities().escapeHTML(providerName)}</h6>
            <small class="text-warning d-block">Unsupported connection: "${webManager.utilities().escapeHTML(providerId)}". Update Ultimate Jekyll Manager to enable this provider.</small>
          </div>
        </div>
        <div class="text-start text-sm-end flex-shrink-0">
          <button class="btn btn-sm btn-outline-secondary" disabled>Unavailable</button>
        </div>
      </div>
    `;

    $connectionsList.appendChild($warning);
  });

  const $empty = document.getElementById('connections-empty');

  if ($empty) {
    if (hasEnabledProviders) {
      $empty.classList.add('d-none');
    } else {
      $empty.classList.remove('d-none');
    }
  }
}

// Update provider status display
function updateProviderStatus(providerId, userConnection, providerSettings) {
  const $status = document.getElementById(`${providerId}-connection-status`);
  const $description = document.getElementById(`${providerId}-connection-description`);
  const $form = document.getElementById(`connection-form-${providerId}`);
  const $connectButton = $form?.querySelector('button[data-action="connect"]');
  const $disconnectButton = $form?.querySelector('button[data-action="disconnect"]');

  const isConnected = userConnection && userConnection.identity;

  // Set description
  if ($description) {
    const defaultDescriptions = {
      google: 'Enable single sign-on with your Google account',
      discord: 'Connect to access Discord community features',
      github: 'Link your GitHub account for repository access',
      twitter: 'Share updates and connect with Twitter',
      facebook: 'Connect your Facebook account for social features',
    };

    const descriptionText = providerSettings?.description
      || defaultDescriptions[providerId]
      || `Connect your ${providerId.charAt(0).toUpperCase() + providerId.slice(1)} account`;

    $description.textContent = descriptionText;
    $description.classList.remove('d-none');
  }

  // Set status
  if ($status) {
    if (isConnected) {
      const displayName = getConnectionDisplayName(userConnection);
      let statusText = `Connected: ${displayName}`;

      if (userConnection.updated && userConnection.updated.timestamp) {
        const date = new Date(userConnection.updated.timestamp);
        const dateStr = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        statusText = `${displayName} • ${dateStr}`;
      }

      $status.textContent = statusText;
      $status.classList.remove('d-none');
    } else {
      $status.textContent = '';
      $status.classList.add('d-none');
    }
  }

  // Toggle buttons
  if ($connectButton && $disconnectButton) {
    if (isConnected) {
      $connectButton.classList.add('d-none');
      $disconnectButton.classList.remove('d-none');
    } else {
      $connectButton.classList.remove('d-none');
      $disconnectButton.classList.add('d-none');
    }
  }
}

// Get display name for connection
function getConnectionDisplayName(connection) {
  if (!connection || !connection.identity) {
    return 'Unknown';
  }

  return connection.identity.global_name
    || connection.identity.username
    || connection.identity.name
    || connection.identity.email
    || connection.identity.id
    || 'Connected';
}

// Initialize FormManager for a provider
function initializeProviderForm(providerId) {
  const formId = `connection-form-${providerId}`;
  const $form = document.getElementById(formId);

  if (!$form) {
    return;
  }

  if (connectionForms.has(providerId)) {
    return;
  }

  const formManager = new FormManager(`#${formId}`, {
    submittingText: 'Connecting...',
  });

  connectionForms.set(providerId, formManager);

  formManager.on('statechange', ({ state }) => {
    if (state === 'ready') {
      const userConnection = accountData?.oauth2?.[providerId];
      const providerSettings = oauth2Config?.[providerId];
      updateProviderStatus(providerId, userConnection, providerSettings);
    }
  });

  formManager.on('submit', async ({ data, $submitButton }) => {
    const provider = data.provider;
    const action = $submitButton?.getAttribute('data-action');

    if (action === 'connect') {
      await handleConnect(provider);
    } else if (action === 'disconnect') {
      const success = await handleDisconnect(provider);

      if (success) {
        const providerSettings = oauth2Config?.[provider];
        updateProviderStatus(provider, null, providerSettings);
      }
    }
  });
}

// Handle connect action
async function handleConnect(providerId) {
  const provider = oauth2Config?.[providerId];

  if (!provider || provider.enabled === false) {
    throw new Error('This connection service is not available.');
  }

  // Build URL with query params for GET request
  // Don't send scope - let the backend use the provider's default scopes
  const url = new URL(getApiUrl());
  url.searchParams.set('provider', providerId);
  url.searchParams.set('action', 'authorize');
  url.searchParams.set('redirect', 'false');

  const response = await authorizedFetch(url.toString(), {
    method: 'GET',
    timeout: 30000,
    response: 'json',
    tries: 2,
  });

  if (response.url && /^https?:\/\//i.test(response.url)) {
    window.location.href = response.url;
  } else {
    throw new Error(response.message || 'Failed to get authorization URL');
  }
}

// Handle disconnect action
async function handleDisconnect(providerId) {
  const providerName = providerId.charAt(0).toUpperCase() + providerId.slice(1);

  await new Promise(resolve => setTimeout(resolve, 1));

  if (!confirm(`Are you sure you want to disconnect your ${providerName} account?`)) {
    throw new Error('Disconnection cancelled');
  }

  // Build URL with query params for DELETE request
  const url = new URL(getApiUrl());
  url.searchParams.set('provider', providerId);

  const response = await authorizedFetch(url.toString(), {
    method: 'DELETE',
    timeout: 30000,
    response: 'json',
    tries: 2,
  });

  if (response.success) {
    if (accountData.oauth2 && accountData.oauth2[providerId]) {
      delete accountData.oauth2[providerId];
    }

    return true;
  }

  throw new Error(response.message || 'Failed to disconnect');
}

// Called when section is shown
export function onShow() {
  if (accountData && oauth2Config) {
    displayConnections();
  }
}
