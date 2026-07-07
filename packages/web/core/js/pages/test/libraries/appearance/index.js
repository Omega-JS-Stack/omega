/**
 * Appearance Test Page JavaScript
 */

// Libraries
import webManager from 'web-manager';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await webManager.dom().ready();

    // Initialize debug panel
    initDebugPanel();

    // Initialize programmatic controls
    initControls();

    // Initialize event logging
    initEventLog();

    // Resolve after initialization
    return resolve();
  });
};

/**
 * Initialize debug panel with live values
 */
function initDebugPanel() {
  const $debugSaved = document.getElementById('debug-saved');
  const $debugResolved = document.getElementById('debug-resolved');
  const $debugAttr = document.getElementById('debug-attr');
  const $debugLocalStorage = document.getElementById('debug-localstorage');
  const $debugSystem = document.getElementById('debug-system');
  const $btnRefresh = document.getElementById('btn-refresh');

  // Update function
  function updateDebug() {
    const appearance = webManager.uj().appearance;

    // Saved preference via API
    const saved = appearance.get();
    $debugSaved.textContent = saved !== null ? `"${saved}"` : 'null (not set)';

    // Resolved theme via API
    const resolved = appearance.getResolved();
    $debugResolved.textContent = `"${resolved}"`;

    // Raw HTML attribute
    const attr = document.documentElement.getAttribute('data-bs-theme');
    $debugAttr.textContent = `"${attr}"`;

    // Raw localStorage value (stored under _manager.appearance.preference)
    let rawStorage = null;
    try {
      const managerData = localStorage.getItem('_manager');
      const parsedData = managerData ? JSON.parse(managerData) : null;
      rawStorage = parsedData?.appearance?.preference || null;
    } catch (e) {
      rawStorage = '(error reading)';
    }
    $debugLocalStorage.textContent = rawStorage !== null ? `"${rawStorage}"` : 'null';

    // System preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const systemPref = prefersDark ? 'dark' : 'light';
    $debugSystem.textContent = `"${systemPref}" (prefers-color-scheme: ${prefersDark ? 'dark' : 'light'})`;

    console.log('[Appearance Test] Debug updated:', {
      saved,
      resolved,
      attr,
      rawStorage,
      systemPref,
    });
  }

  // Initial update
  updateDebug();

  // Refresh button
  $btnRefresh.addEventListener('click', updateDebug);

  // Auto-update when theme changes (observe attribute changes)
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'data-bs-theme') {
        updateDebug();
      }
    });
  });
  observer.observe(document.documentElement, { attributes: true });

  // Also listen for system preference changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', updateDebug);

  // Export for console access
  window.updateAppearanceDebug = updateDebug;
}

/**
 * Initialize programmatic control buttons
 */
function initControls() {
  const appearance = webManager.uj().appearance;

  // Toggle button
  document.getElementById('btn-toggle').addEventListener('click', () => {
    console.log('[Appearance Test] Toggle clicked');
    appearance.toggle();
  });

  // Cycle button
  document.getElementById('btn-cycle').addEventListener('click', () => {
    console.log('[Appearance Test] Cycle clicked');
    appearance.cycle();
  });

  // Clear button
  document.getElementById('btn-clear').addEventListener('click', () => {
    console.log('[Appearance Test] Clear clicked');
    appearance.clear();
    // Trigger debug update
    window.updateAppearanceDebug?.();
  });

  // Quick set buttons
  document.getElementById('btn-set-light').addEventListener('click', () => {
    console.log('[Appearance Test] set("light") clicked');
    appearance.set('light');
  });

  document.getElementById('btn-set-dark').addEventListener('click', () => {
    console.log('[Appearance Test] set("dark") clicked');
    appearance.set('dark');
  });

  document.getElementById('btn-set-system').addEventListener('click', () => {
    console.log('[Appearance Test] set("system") clicked');
    appearance.set('system');
  });
}

/**
 * Initialize event logging
 */
function initEventLog() {
  const $log = document.getElementById('event-log');
  const $clearBtn = document.getElementById('btn-clear-log');
  let logLines = [];

  function addLogEntry(message) {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `[${timestamp}] ${message}`;
    logLines.push(entry);

    // Keep last 50 entries
    if (logLines.length > 50) {
      logLines = logLines.slice(-50);
    }

    $log.textContent = logLines.join('\n');
    $log.scrollTop = $log.scrollHeight;
  }

  // Clear log button
  $clearBtn.addEventListener('click', () => {
    logLines = [];
    $log.textContent = 'Log cleared...';
  });

  // Observe data-bs-theme changes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'data-bs-theme') {
        const oldValue = mutation.oldValue;
        const newValue = document.documentElement.getAttribute('data-bs-theme');
        addLogEntry(`Theme changed: "${oldValue}" -> "${newValue}"`);
      }
    });
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['data-bs-theme'],
  });

  // Log system preference changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', (event) => {
    const systemPref = event.matches ? 'dark' : 'light';
    addLogEntry(`System preference changed: "${systemPref}"`);
  });

  // Log click events on appearance controls
  document.addEventListener('click', (event) => {
    const $target = event.target.closest('[data-appearance-set]');
    if ($target) {
      const value = $target.getAttribute('data-appearance-set');
      addLogEntry(`User clicked: set("${value}")`);
    }
  });

  // Initial log entry
  addLogEntry('Appearance test page loaded');
  addLogEntry(`Initial theme: "${document.documentElement.getAttribute('data-bs-theme')}"`);
  addLogEntry(`Saved preference: ${webManager.uj().appearance.get() || '(none)'}`);
}
