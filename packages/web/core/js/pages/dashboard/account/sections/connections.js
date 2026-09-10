/**
 * Connections Section JavaScript - third-party account linking
 */

// Libraries
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import omega from '@omega.js/client';
import { createLogger } from '__main_assets__/js/libs/logger.js';

const logger = createLogger('account:connections');

let connectionsConfig = null;
let accountData = null;
const connectionForms = new Map();

// What a provider id may be — the same rule the backend's confined provider
// loader enforces (`libraries/load-provider.js`). A key outside it can never
// resolve to a provider, so its card would only ever fail on connect.
const PROVIDER_ID_PATTERN = /^[a-z0-9-]+$/;

// Get API URL helper
function getApiUrl() {
  return `${omega.getApiUrl()}/omega/user/connections`;
}

// Initialize connections section
export async function init() {
}

// Load connections data
export async function loadData(account, sharedConnectionsConfig) {
  if (!account) {
    return;
  }

  accountData = account;
  connectionsConfig = sharedConnectionsConfig;

  displayConnections();
}

// Display available and connected providers
function displayConnections() {
  const $loading = document.getElementById('connections-loading');

  if ($loading) {
    $loading.classList.add('d-none');
  }

  if (!connectionsConfig) {
    if ($loading) {
      $loading.classList.remove('d-none');
    }
    return;
  }

  const availableProviders = connectionsConfig;
  const userConnections = accountData?.connections || {};

  let hasEnabledProviders = false;

  // The CONFIG is the list (#771): every provider a brand enables gets a card
  // — the one the page template rendered for it, or the warning card below
  // saying what its config entry is missing.
  Object.keys(availableProviders).forEach(providerId => {
    const providerSettings = availableProviders[providerId];
    const isEnabled = providerSettings && providerSettings.enabled !== false;
    const $providerElement = document.getElementById(`connection-${providerId}`);

    if (!isEnabled) {
      if ($providerElement) {
        $providerElement.classList.add('d-none');
      }
      return;
    }

    hasEnabledProviders = true;

    // A name the backend cannot load is never offered as a live connection
    if (!PROVIDER_ID_PATTERN.test(providerId)) {
      if ($providerElement) {
        $providerElement.classList.add('d-none');
      }

      renderUnconfiguredCard(providerId, 'A provider id must be lowercase letters, digits, and dashes.');
      return;
    }

    if ($providerElement) {
      $providerElement.classList.remove('d-none');

      initializeProviderForm(providerId);

      updateProviderStatus(providerId, userConnections[providerId], providerSettings);
      return;
    }

    renderUnconfiguredCard(providerId, 'Add a "name" and a "logo" to its connections entry in the brand config to show this connection.');
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

// An enabled provider that cannot be offered: either the page rendered no card
// for it (its config entry carries no `name`/`logo`, and the framework has no
// packaged default for that provider), or its key is not a legal provider id.
// The card says which, since the fix differs.
function renderUnconfiguredCard(providerId, reason) {
  const warningId = `connection-${providerId}-unconfigured`;

  if (document.getElementById(warningId)) {
    return;
  }

  logger.warn(`Provider "${providerId}" is enabled in the brand config but cannot be offered: ${reason}`);

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
          <h6 class="mb-0">${omega.utilities().escapeHTML(providerName)}</h6>
          <small class="text-warning d-block">Unsupported connection: "${omega.utilities().escapeHTML(providerId)}". ${omega.utilities().escapeHTML(reason)}</small>
        </div>
      </div>
      <div class="text-start text-sm-end flex-shrink-0">
        <button class="btn btn-sm btn-outline-secondary" disabled>Unavailable</button>
      </div>
    </div>
  `;

  document.getElementById('connections-list').appendChild($warning);
}

// Update provider status display
function updateProviderStatus(providerId, userConnection, providerSettings) {
  const $status = document.getElementById(`${providerId}-connection-status`);
  const $description = document.getElementById(`${providerId}-connection-description`);
  const $form = document.getElementById(`connection-form-${providerId}`);
  const $connectButton = $form?.querySelector('button[data-action="connect"]');
  const $disconnectButton = $form?.querySelector('button[data-action="disconnect"]');

  const isConnected = userConnection && userConnection.identity;

  // Set description. The CONFIG is the only source
  // ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)): the framework's
  // config defaults carry one for every packaged provider, a brand's own entry
  // carries its own, and a provider with neither gets the generic line
  if ($description) {
    const descriptionText = providerSettings?.description
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
      const userConnection = accountData?.connections?.[providerId];
      const providerSettings = connectionsConfig?.[providerId];
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
        const providerSettings = connectionsConfig?.[provider];
        updateProviderStatus(provider, null, providerSettings);
      }
    }
  });
}

// Handle connect action
async function handleConnect(providerId) {
  const provider = connectionsConfig?.[providerId];

  if (!provider || provider.enabled === false) {
    throw new Error('This connection service is not available.');
  }

  // Build URL with query params for GET request
  // Don't send scope - let the backend use the provider's default scopes
  const url = new URL(getApiUrl());
  url.searchParams.set('provider', providerId);
  url.searchParams.set('action', 'authorize');
  url.searchParams.set('redirect', 'false');

  const response = await omega.request(url.toString(), {
    method: 'GET',
    timeout: 30000,
    tries: 2,
  });

  if (response.url && /^https?:\/\//i.test(response.url)) {
    window.location.href = response.url;

    // The page is leaving. Never resolve: the form stays `submitting` until the
    // browser unloads it, so the card never redraws a second Connect button.
    await new Promise(() => {});
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

  const response = await omega.request(url.toString(), {
    method: 'DELETE',
    timeout: 30000,
    tries: 2,
  });

  if (response.success) {
    if (accountData.connections && accountData.connections[providerId]) {
      delete accountData.connections[providerId];
    }

    return true;
  }

  throw new Error(response.message || 'Failed to disconnect');
}

// Called when section is shown
export function onShow() {
  if (accountData && connectionsConfig) {
    displayConnections();
  }
}
