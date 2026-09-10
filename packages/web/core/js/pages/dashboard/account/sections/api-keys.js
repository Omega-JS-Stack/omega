/**
 * API & MCP Section JavaScript
 */

// Libraries
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import omega from '@omega.js/client';

// Initialize section
export function init() {
  setupResetApiKeyForm();
  setupMcp();
}

// Load data
export function loadData(account) {
  if (!account) {
    return;
  }

  updateApiKey(account.api?.privateKey);
}

// Update API key display
function updateApiKey(apiKey) {
  const $apiKeyInput = document.getElementById('api-key-input');

  if ($apiKeyInput) {
    $apiKeyInput.value = apiKey || 'No API key generated';
  }
}

// Setup MCP integration URLs
function setupMcp() {
  const apiUrl = omega.getApiUrl();
  const mcpUrl = `${apiUrl}/mcp`;
  const $mcpCard = document.getElementById('mcp-card');
  const brandName = ($mcpCard?.dataset?.brandId || 'backend').toLowerCase().replace(/\s+/g, '-');

  const $mcpUrlInput = document.getElementById('mcp-url-input');
  if ($mcpUrlInput) {
    $mcpUrlInput.value = mcpUrl;
  }

  const cmds = {
    'mcp-cmd-claude': `claude mcp add ${brandName} --transport http ${mcpUrl}`,
    'mcp-cmd-codex': `codex mcp add ${brandName} -- npx -y mcp-remote@latest ${mcpUrl}`,
    'mcp-cmd-gemini-auth': `/mcp auth ${brandName}`,
    'mcp-cmd-opencode-auth': `opencode mcp auth ${brandName}`,
  };

  const snippets = {
    'mcp-cmd-cursor': {
      mcpServers: {
        [brandName]: { url: mcpUrl },
      },
    },
    'mcp-cmd-vscode': {
      mcp: {
        servers: {
          [brandName]: { url: mcpUrl },
        },
      },
    },
    'mcp-cmd-gemini': {
      mcpServers: {
        [brandName]: { url: mcpUrl },
      },
    },
    'mcp-cmd-opencode': {
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        [brandName]: {
          type: 'remote',
          url: mcpUrl,
          oauth: {},
        },
      },
    },
    'mcp-cmd-windsurf': {
      mcpServers: {
        [brandName]: {
          command: 'npx',
          args: ['-y', 'mcp-remote@latest', mcpUrl],
        },
      },
    },
    'mcp-cmd-zed': {
      context_servers: {
        [brandName]: {
          command: 'npx',
          args: ['-y', 'mcp-remote@latest', mcpUrl],
          settings: {},
        },
      },
    },
  };

  for (const [id, value] of Object.entries(cmds)) {
    const $el = document.getElementById(id);
    if ($el) {
      $el.value = value;
    }
  }

  for (const [id, config] of Object.entries(snippets)) {
    const $el = document.getElementById(id);
    if ($el) {
      $el.textContent = JSON.stringify(config, null, 2);
    }
  }

  const $detailUrl = document.getElementById('mcp-detail-url');
  if ($detailUrl) {
    $detailUrl.textContent = mcpUrl;
  }
}

// Setup reset API key form
function setupResetApiKeyForm() {
  const formManager = new FormManager('#reset-api-key-form', {
    allowResubmit: false,
    submittingText: 'Resetting...',
    submittedText: 'Reset!',
  });

  formManager.on('submit', async () => {
    await new Promise(resolve => setTimeout(resolve, 1));

    if (!confirm('Are you sure you want to reset your API key? This will invalidate your current key and any applications using it will stop working.')) {
      throw new Error('API key reset cancelled.');
    }

    const serverApiURL = `${omega.getApiUrl()}/omega/user/api-keys`;

    const response = await omega.request(serverApiURL, {
      method: 'POST',
      timeout: 30000,
      tries: 2,
    });

    if (!response.privateKey) {
      throw new Error(response.message || 'Failed to reset API key');
    }

    updateApiKey(response.privateKey);
    formManager.showSuccess('API key has been reset successfully!');
  });
}
