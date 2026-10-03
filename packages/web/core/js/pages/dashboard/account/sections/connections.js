/**
 * Connections Section JavaScript - third-party account linking
 */

// Libraries
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import omega from '@omega.js/web/runtime';
import { createLogger } from '__main_assets__/js/libs/logger.js';

const logger = createLogger('account:connections');

let connectionsConfig = null;
let accountData = null;
const connectionForms = new Map();

// The account cards drawn so far: provider id → (identity id → card element)
const accountCards = new Map();

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
  if (!account.authenticated) {
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
      initializeProviderForm(providerId);

      renderAccountCards(providerId);
      updateConnectCard(providerId, providerSettings);
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
          <h6 class="mb-0">${omega.utilities.escapeHTML(providerName)}</h6>
          <small class="text-warning d-block">Unsupported connection: "${omega.utilities.escapeHTML(providerId)}". ${omega.utilities.escapeHTML(reason)}</small>
        </div>
      </div>
      <div class="text-start text-sm-end flex-shrink-0">
        <button class="btn btn-sm btn-outline-secondary" disabled>Unavailable</button>
      </div>
    </div>
  `;

  document.getElementById('connections-list').appendChild($warning);
}

// The user's linked accounts of one provider, keyed by identity id. An account
// holds a `token` object, the backend's rule: an old one-level record's own keys
// and a lease left with no token are never accounts
function linkedAccounts(providerId) {
  const entries = Object.entries(accountData?.connections?.[providerId] || {});

  return Object.fromEntries(entries.filter(([, entry]) => entry?.token && typeof entry.token === 'object'));
}

// The most accounts of a provider one user may link. 1 is the config schema's
// default, which a brand's own provider reads when its entry names no `max`
function connectionLimit(providerSettings) {
  return providerSettings?.max ?? 1;
}

// The provider's own card is the Connect control: shown while the user holds
// fewer accounts than `max`, hidden at it. Each linked account is its own card
function updateConnectCard(providerId, providerSettings) {
  const $card = document.getElementById(`connection-${providerId}`);
  const $status = document.getElementById(`${providerId}-connection-status`);
  const $description = document.getElementById(`${providerId}-connection-description`);
  const $form = document.getElementById(`connection-form-${providerId}`);
  const $connectButton = $form?.querySelector('button[data-action="connect"]');
  const $disconnectButton = $form?.querySelector('button[data-action="disconnect"]');

  const canConnect = Object.keys(linkedAccounts(providerId)).length < connectionLimit(providerSettings);

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

  if ($status) {
    $status.textContent = '';
    $status.classList.add('d-none');
  }

  if ($connectButton && $disconnectButton) {
    if (canConnect) {
      $connectButton.classList.remove('d-none');
    } else {
      $connectButton.classList.add('d-none');
    }

    $disconnectButton.classList.add('d-none');
  }

  if (canConnect) {
    $card.classList.remove('d-none');
  } else {
    $card.classList.add('d-none');
  }
}

// One card per linked account, each a copy of the provider's card with its ids
// suffixed by the account's identity id, placed right below the provider's card
function renderAccountCards(providerId) {
  const accounts = linkedAccounts(providerId);
  const drawn = accountCards.get(providerId) || new Map();
  const $providerCard = document.getElementById(`connection-${providerId}`);
  let $anchor = $providerCard;

  accountCards.set(providerId, drawn);

  drawn.forEach(($card, accountId) => {
    if (!Object.prototype.hasOwnProperty.call(accounts, accountId)) {
      $card.remove();
      drawn.delete(accountId);
    }
  });

  Object.entries(accounts).forEach(([accountId, connection]) => {
    const suffix = `${providerId}-${accountId}`;

    if (!drawn.has(accountId)) {
      const $card = buildAccountCard($providerCard, providerId, accountId);

      $anchor.after($card);
      drawn.set(accountId, $card);
      initializeAccountForm(document.getElementById(`connection-form-${suffix}`));
    }

    $anchor = drawn.get(accountId);
    fillAccountCard(suffix, connection);
  });
}

// A copy of the provider's card for one account: its own ids, its own
// Disconnect (which passes the account's id), and no Connect
function buildAccountCard($providerCard, providerId, accountId) {
  const suffix = `${providerId}-${accountId}`;
  const $card = $providerCard.cloneNode(true);
  const byId = (id) => $card.querySelector(`[id="${id}"]`);

  $card.id = `connection-${suffix}`;
  $card.classList.add('border-top');
  $card.classList.remove('d-none');

  byId(`${providerId}-connection-description`).id = `${suffix}-connection-description`;
  byId(`${providerId}-connection-status`).id = `${suffix}-connection-status`;

  const $form = byId(`connection-form-${providerId}`);
  const $id = document.createElement('input');

  $form.id = `connection-form-${suffix}`;
  $form.setAttribute('data-form-state', 'initializing');
  $id.type = 'hidden';
  $id.name = 'id';
  $id.value = accountId;
  $form.prepend($id);
  $form.querySelector('button[data-action="connect"]').remove();
  $form.querySelector('button[data-action="disconnect"]').classList.remove('d-none');

  return $card;
}

// The account's display name under the provider's, and when it was linked
function fillAccountCard(suffix, connection) {
  const $description = document.getElementById(`${suffix}-connection-description`);
  const $status = document.getElementById(`${suffix}-connection-status`);

  $description.textContent = getConnectionDisplayName(connection);
  $description.classList.remove('d-none');

  if (!connection?.updated?.timestamp) {
    $status.textContent = '';
    $status.classList.add('d-none');
    return;
  }

  const dateStr = new Date(connection.updated.timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  $status.textContent = `Connected ${dateStr}`;
  $status.classList.remove('d-none');
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

  const formManager = new FormManager(omega, `#${formId}`, {
    submittingText: 'Connecting...',
  });

  connectionForms.set(providerId, formManager);

  formManager.on('statechange', ({ state }) => {
    if (state === 'ready') {
      updateConnectCard(providerId, connectionsConfig?.[providerId]);
    }
  });

  // The provider's card only connects: each account card carries its own Disconnect
  formManager.on('submit', async ({ data }) => {
    await handleConnect(data.provider);
  });
}

// Initialize FormManager for one account card's Disconnect
function initializeAccountForm($form) {
  const formManager = new FormManager(omega, $form, {
    submittingText: 'Disconnecting...',
  });

  formManager.on('submit', async ({ data }) => {
    await handleDisconnect(data.provider, data.id);

    renderAccountCards(data.provider);
    updateConnectCard(data.provider, connectionsConfig?.[data.provider]);
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

// Handle disconnect action: one account, named by its identity id
async function handleDisconnect(providerId, accountId) {
  const providerName = providerId.charAt(0).toUpperCase() + providerId.slice(1);
  const displayName = getConnectionDisplayName(linkedAccounts(providerId)[accountId]);

  await new Promise(resolve => setTimeout(resolve, 1));

  if (!confirm(`Are you sure you want to disconnect your ${providerName} account ${displayName}?`)) {
    throw new Error('Disconnection cancelled');
  }

  // Build URL with query params for DELETE request
  const url = new URL(getApiUrl());
  url.searchParams.set('provider', providerId);
  url.searchParams.set('id', accountId);

  const response = await omega.request(url.toString(), {
    method: 'DELETE',
    timeout: 30000,
    tries: 2,
  });

  if (response.success) {
    // From the stored map itself: linkedAccounts() answers a filtered copy
    delete accountData.connections[providerId][accountId];

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
