/**
 * Debugger Session Manager
 *
 * Manages chrome.debugger attach/detach lifecycle and provides
 * a wrapper for sending CDP commands.
 */

import * as cursor from './cursor.js';

const CDP_VERSION = '1.3';

// Active sessions: Map<tabId, { tabId, attached }>
const sessions = new Map();

/**
 * Attach debugger to a tab and enable required CDP domains
 */
export async function attach(tabId) {
  if (sessions.has(tabId)) {
    return;
  }

  await chrome.debugger.attach({ tabId }, CDP_VERSION);
  sessions.set(tabId, { tabId, attached: true });

  // Enable required CDP domains
  await Promise.all([
    sendCommand(tabId, 'Page.enable'),
    sendCommand(tabId, 'DOM.enable'),
    sendCommand(tabId, 'Runtime.enable'),
  ]);

  // Inject visual cursor overlay
  await cursor.inject(tabId);
}

/**
 * Detach debugger from a tab
 */
export async function detach(tabId) {
  if (!sessions.has(tabId)) {
    return;
  }

  await cursor.remove(tabId);

  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Tab may already be closed
  }

  sessions.delete(tabId);
}

/**
 * Detach all active sessions
 */
export async function detachAll() {
  const tabIds = [...sessions.keys()];

  for (const tabId of tabIds) {
    await detach(tabId);
  }
}

/**
 * Attach if not already attached (idempotent)
 */
export async function ensureAttached(tabId) {
  if (!sessions.has(tabId)) {
    await attach(tabId);
  }
}

/**
 * Check if a tab has an active session
 */
export function isAttached(tabId) {
  return sessions.has(tabId);
}

/**
 * List all active sessions
 */
export function listSessions() {
  return [...sessions.values()];
}

/**
 * Send a CDP command to a tab.
 *
 * Automatically moves the visual cursor overlay on mouse events.
 */
export function sendCommand(tabId, method, params = {}) {
  // Track cursor position on mouse events
  if (method === 'Input.dispatchMouseEvent' && params.x !== undefined) {
    cursor.move(tabId, params.x, params.y).catch(() => {});

    if (params.type === 'mousePressed') {
      cursor.pulse(tabId).catch(() => {});
    }
  }

  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

/**
 * Resolve a target spec to a tabId
 *
 * Priority: tabId > url (find matching) > create new > active tab
 */
export async function resolveTarget(target = {}) {
  // Direct tabId
  if (target.tabId) {
    return target.tabId;
  }

  // Find by URL
  if (target.url) {
    const tabs = await chrome.tabs.query({ url: `${target.url}*` });

    if (tabs.length > 0) {
      return tabs[0].id;
    }

    // Create new tab if requested
    if (target.create) {
      const tab = await chrome.tabs.create({ url: target.url });
      // Wait for tab to load
      await new Promise((resolve) => {
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
      return tab.id;
    }
  }

  // Fall back to active tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab) {
    throw new Error('No active tab found');
  }

  return activeTab.id;
}

// Clean up when debugger is forcefully detached (user closed DevTools, tab closed, etc.)
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId) {
    sessions.delete(source.tabId);
    console.log(`Automation: Debugger detached from tab ${source.tabId} (${reason})`);
  }
});

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (sessions.has(tabId)) {
    sessions.delete(tabId);
    console.log(`Automation: Tab ${tabId} closed, session removed`);
  }
});
