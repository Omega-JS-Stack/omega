/**
 * API & MCP Section JavaScript
 */

// Libraries
import { FormManager } from '__main_assets__/js/libs/form-manager.js';
import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';
import webManager from 'web-manager';

// Initialize section
export function init() {
  setupButtons();
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

// Setup button handlers
function setupButtons() {
  const $copyBtn = document.getElementById('copy-api-key-btn');
  if ($copyBtn) {
    $copyBtn.addEventListener('click', handleCopyApiKey);
  }

  const $copyMcpBtn = document.getElementById('copy-mcp-url-btn');
  if ($copyMcpBtn) {
    $copyMcpBtn.addEventListener('click', () => handleCopyInput('mcp-url-input', $copyMcpBtn));
  }

  document.querySelectorAll('[data-copy-target]').forEach(($btn) => {
    $btn.addEventListener('click', () => {
      const targetId = $btn.getAttribute('data-copy-target');
      const $target = document.getElementById(targetId);

      if (!$target) {
        return;
      }

      const text = $target.tagName === 'PRE' ? $target.textContent : $target.value;

      navigator.clipboard.writeText(text).then(() => {
        webManager.utilities().showNotification('Copied!', 'success');
      }).catch(() => {
        webManager.utilities().showNotification('Failed to copy', 'danger');
      });
    });
  });
}

// Setup MCP integration URLs
function setupMcp() {
  const apiUrl = webManager.getApiUrl();
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

    const serverApiURL = `${webManager.getApiUrl()}/backend-manager/user/api-keys`;

    const response = await authorizedFetch(serverApiURL, {
      method: 'POST',
      timeout: 30000,
      response: 'json',
      tries: 2,
    });

    if (!response.privateKey) {
      throw new Error(response.message || 'Failed to reset API key');
    }

    updateApiKey(response.privateKey);
    formManager.showSuccess('API key has been reset successfully!');
  });
}

// Handle copy API key
async function handleCopyApiKey() {
  const $apiKeyInput = document.getElementById('api-key-input');
  const $copyBtn = document.getElementById('copy-api-key-btn');

  handleCopyInput('api-key-input', $copyBtn);
}

// Generic copy handler for input elements
async function handleCopyInput(inputId, $btn) {
  const $input = document.getElementById(inputId);

  if (!$input || !$input.value || $input.value === 'Loading...') {
    webManager.utilities().showNotification('Nothing to copy', 'warning');
    return;
  }

  try {
    await webManager.utilities().clipboardCopy($input);

    const $text = $btn.querySelector('.button-text');
    if ($text) {
      const originalText = $text.textContent;
      $text.textContent = 'Copied!';
      $btn.classList.remove('btn-outline-adaptive');
      $btn.classList.add('btn-success');

      setTimeout(() => {
        $text.textContent = originalText;
        $btn.classList.remove('btn-success');
        $btn.classList.add('btn-outline-adaptive');
      }, 2000);
    } else {
      webManager.utilities().showNotification('Copied!', 'success');
    }
  } catch (err) {
    console.error('Failed to copy:', err);
    webManager.utilities().showNotification('Failed to copy', 'danger');
  }
}
