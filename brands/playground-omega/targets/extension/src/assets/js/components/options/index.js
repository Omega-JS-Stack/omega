/**
 * Surface: the options page (a page context)
 * Doc: node_modules/@omega.js/extension/docs/extension.md
 *
 * One setting, notes.autoSaveSelection, written to omega.extension.storage:
 * the store the content script reads on load (../../lib/notes.js says why it
 * is not this page's omega.storage).
 */
import omega from '@omega.js/extension/options';
import { AUTO_SAVE_KEY, readAutoSave } from '../../lib/notes.js';

omega.initialize()
  .then(async () => {
    const { extension, logger } = omega;
    const $toggle = document.getElementById('auto-save-selection');
    const $status = document.getElementById('auto-save-status');

    $toggle.checked = await readAutoSave(omega);

    $toggle.addEventListener('change', async () => {
      await extension.storage.sync.set({ [AUTO_SAVE_KEY]: $toggle.checked });

      $status.textContent = 'Saved. Reload the site to apply it.';
    });

    // The view ships the switch disabled until it shows the stored value
    $toggle.disabled = false;

    logger.log('Options initialized!');
  });
