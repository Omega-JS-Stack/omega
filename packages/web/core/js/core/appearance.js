/**
 * Appearance Module
 * Handles theme appearance switching (dark, light, system)
 */
import webManager from 'web-manager';

// Constants
const STORAGE_KEY = 'appearance.preference';
const VALID_VALUES = ['dark', 'light', 'system'];

// Module state
let mediaQuery = null;

// Module
export default () => {

  // Create appearance API
  const appearanceAPI = {
    /**
     * Get the current saved preference
     * @returns {string|null} 'dark', 'light', 'system', or null if not set
     */
    get: () => webManager.storage().get(STORAGE_KEY) || null,

    /**
     * Get the resolved (actual) theme being displayed
     * @returns {string} 'dark' or 'light'
     */
    getResolved: () => document.documentElement.getAttribute('data-bs-theme') || 'dark',

    /**
     * Set the appearance preference
     * @param {string} value - 'dark', 'light', or 'system'
     */
    set: (value) => {
      // Validate
      if (!VALID_VALUES.includes(value)) {
        console.warn(`Invalid appearance value: ${value}. Must be one of: ${VALID_VALUES.join(', ')}`);
        return;
      }

      // Save preference
      webManager.storage().set(STORAGE_KEY, value);

      // Apply theme
      applyTheme(value);

      // Update UI elements
      updateUI(value);

      // Setup or teardown system preference listener
      setupSystemListener(value === 'system');
    },

    /**
     * Toggle between dark and light (skips system)
     */
    toggle() {
      const current = this.getResolved();
      const next = current === 'dark' ? 'light' : 'dark';
      this.set(next);
    },

    /**
     * Cycle through all three modes: dark → light → system → dark
     */
    cycle() {
      const current = this.get() || this.getResolved();
      const order = ['dark', 'light', 'system'];
      const currentIndex = order.indexOf(current);
      const nextIndex = (currentIndex + 1) % order.length;
      this.set(order[nextIndex]);
    },

    /**
     * Clear saved preference (revert to site default)
     */
    clear: () => {
      webManager.storage().remove(STORAGE_KEY);
      updateUI(null);
      setupSystemListener(false);
    }
  };

  // Register on UJ library
  webManager._ujLibrary.appearance = appearanceAPI;

  // Initialize UI event listeners
  initializeUI();

  // Setup system listener if current preference is 'system'
  const currentPreference = appearanceAPI.get();
  if (currentPreference === 'system') {
    setupSystemListener(true);
  }

  // Update UI with current state
  updateUI(currentPreference);

  console.log('Appearance module loaded');
};

/**
 * Apply theme to the document
 * @param {string} preference - 'dark', 'light', or 'system'
 */
const applyTheme = (preference) => {
  let theme = preference;

  // Resolve system preference
  if (preference === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // Apply to document
  document.documentElement.setAttribute('data-bs-theme', theme);
};

/**
 * Setup or teardown the system preference change listener
 * @param {boolean} enable - Whether to enable the listener
 */
const setupSystemListener = (enable) => {
  // Clean up existing listener
  if (mediaQuery) {
    mediaQuery.removeEventListener('change', handleSystemChange);
    mediaQuery = null;
  }

  // Setup new listener if needed
  if (enable) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', handleSystemChange);
  }
};

/**
 * Handle system preference change
 * @param {MediaQueryListEvent} event
 */
const handleSystemChange = (event) => {
  const theme = event.matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-bs-theme', theme);
  updateUI('system');
};

/**
 * Initialize UI event listeners
 */
const initializeUI = () => {
  // Use event delegation for appearance controls
  document.addEventListener('click', (event) => {
    const $target = event.target.closest('[data-appearance-set]');

    if (!$target) {
      return;
    }

    event.preventDefault();

    const value = $target.getAttribute('data-appearance-set');
    webManager.uj().appearance.set(value);
  });
};

/**
 * Update UI elements to reflect current state
 * @param {string|null} preference - Current preference
 */
const updateUI = (preference) => {
  const resolved = document.documentElement.getAttribute('data-bs-theme');
  const displayValue = preference || resolved;

  // Update [data-appearance-current] elements with the preference
  document.querySelectorAll('[data-appearance-current]').forEach(($el) => {
    const format = $el.getAttribute('data-appearance-current') || 'preference';
    $el.textContent = format === 'resolved' ? resolved : displayValue;
  });

  // Update [data-appearance-icon] elements - show/hide based on current mode
  // Icons should have data-appearance-icon="light|dark|system" attribute
  document.querySelectorAll('[data-appearance-icon]').forEach(($el) => {
    const iconMode = $el.getAttribute('data-appearance-icon');
    $el.hidden = iconMode !== displayValue;
  });

  // Update active state on [data-appearance-set] elements
  document.querySelectorAll('[data-appearance-set]').forEach(($el) => {
    const value = $el.getAttribute('data-appearance-set');
    const isActive = value === preference || (!preference && value === resolved);

    $el.classList.toggle('active', isActive);
    $el.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
};
