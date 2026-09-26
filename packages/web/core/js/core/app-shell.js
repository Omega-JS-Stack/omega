/**
 * App Shell Module
 * Drives the .omega-shell mechanics (core/css/shell/_index.scss): desktop
 * sidebar collapse (persisted) and the mobile drawer (scrim + Escape dismiss).
 * Controls are declarative — [data-shell-toggle="collapse|drawer"] and
 * [data-shell-dismiss] anywhere in the page. The API is `omega.shell`.
 */

// Constants
const STORAGE_KEY = 'shell.collapsed';

/**
 * Build the shell API for `omega.shell` and wire the page's shell controls.
 * @param {object} omega - the runtime instance (its storage holds the collapse state).
 * @returns {object} the shell API: isCollapsed, isOpen, setCollapsed, setOpen, toggleCollapsed, toggleOpen.
 */
export function createShell(omega) {
  const $shell = document.querySelector('[data-omega-shell]');

  // Create app shell API
  const shellAPI = {
    /**
     * Whether the desktop sidebar is collapsed to the icon rail
     * @returns {boolean}
     */
    isCollapsed: () => $shell?.getAttribute('data-shell-collapsed') === 'true',

    /**
     * Whether the mobile drawer is open
     * @returns {boolean}
     */
    isOpen: () => $shell?.getAttribute('data-shell-open') === 'true',

    /**
     * Collapse or expand the desktop sidebar (persisted)
     * @param {boolean} value
     */
    setCollapsed: (value) => {
      if (!$shell) {
        return;
      }

      $shell.setAttribute('data-shell-collapsed', value ? 'true' : 'false');
      omega.storage.set(STORAGE_KEY, !!value);
      syncControls(shellAPI);
    },

    /**
     * Open or close the mobile drawer (not persisted)
     * @param {boolean} value
     */
    setOpen: (value) => {
      if (!$shell) {
        return;
      }

      $shell.setAttribute('data-shell-open', value ? 'true' : 'false');
      syncControls(shellAPI);
    },

    /**
     * Toggle the desktop sidebar collapse state
     */
    toggleCollapsed() {
      this.setCollapsed(!this.isCollapsed());
    },

    /**
     * Toggle the mobile drawer
     */
    toggleOpen() {
      this.setOpen(!this.isOpen());
    },
  };

  // No shell on this page: the API is still returned, but inert
  if (!$shell) {
    return shellAPI;
  }

  // Restore the persisted collapse state
  if (String(omega.storage.get(STORAGE_KEY)) === 'true') {
    $shell.setAttribute('data-shell-collapsed', 'true');
  }

  // Delegated controls
  document.addEventListener('click', (event) => {
    const $control = event.target.closest('[data-shell-toggle], [data-shell-dismiss]');

    if (!$control) {
      return;
    }

    event.preventDefault();

    if ($control.hasAttribute('data-shell-dismiss')) {
      shellAPI.setOpen(false);
      return;
    }

    if ($control.getAttribute('data-shell-toggle') === 'collapse') {
      shellAPI.toggleCollapsed();
    } else {
      shellAPI.toggleOpen();
    }
  });

  // Escape closes the drawer
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && shellAPI.isOpen()) {
      shellAPI.setOpen(false);
    }
  });

  // Reflect the restored state onto the controls
  syncControls(shellAPI);

  console.log('App shell module loaded');

  return shellAPI;
}

/**
 * Sync aria-expanded on every shell control to the current state
 * @param {object} shellAPI - The shell API
 */
const syncControls = (shellAPI) => {
  document.querySelectorAll('[data-shell-toggle]').forEach(($el) => {
    const expanded = $el.getAttribute('data-shell-toggle') === 'collapse'
      ? !shellAPI.isCollapsed()
      : shellAPI.isOpen();

    $el.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  });
};
