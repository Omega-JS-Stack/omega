/**
 * Surface: the settings window's renderer (opened from the Preferences menu item)
 * Doc: node_modules/@omega.js/desktop/docs/storage.md
 *
 * One setting, notes.confirmDelete, in omega.storage: the PAGE store, which
 * every window of this app shares and the main window reads at delete time.
 * The main window's count lives in the other one, the app store
 * (omega.desktop.storage), which main itself reads and writes.
 */
import omega from '@omega.js/desktop/renderer';

const CONFIRM_KEY = 'notes.confirmDelete';

omega.initialize()
  .then(() => {
    const { storage, logger } = omega;
    const $toggle = document.getElementById('confirm-delete');
    const $status = document.getElementById('confirm-delete-status');

    $toggle.checked = storage.get(CONFIRM_KEY, true);

    $toggle.addEventListener('change', () => {
      storage.set(CONFIRM_KEY, $toggle.checked);
      $status.textContent = 'Saved.';
    });

    logger.log('Settings window initialized!');
  });
