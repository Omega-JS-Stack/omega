/**
 * Surface: the content script (a light context, injected into the host page)
 * Doc: node_modules/@omega.js/extension/docs/components.md
 *
 * "Save selection as note": when the options page turned it on, selecting text
 * shows a small floating button that sends notes:create to background. The
 * manifest injects this script on the brand's own site only, and the setting
 * is off until the user turns it on, so no other page ever sees it.
 */
import omega from '@omega.js/extension/content';
import { askBackground, readAutoSave } from '../../lib/notes.js';

const LABEL = 'Save selection as note';

omega.initialize()
  .then(async () => {
    if (!(await readAutoSave(omega))) {
      return;
    }

    const $button = document.createElement('button');
    $button.type = 'button';
    $button.className = 'notes-save-selection';
    $button.textContent = LABEL;
    $button.hidden = true;
    document.body.appendChild($button);

    // Show the button while something is selected, hide it otherwise
    document.addEventListener('selectionchange', () => {
      $button.hidden = !window.getSelection().toString().trim();
    });

    // mousedown, not click: a click would clear the selection before it is read
    $button.addEventListener('mousedown', async (event) => {
      event.preventDefault();

      const text = window.getSelection().toString().trim();

      try {
        await askBackground(omega, 'notes:create', { text });
        $button.textContent = 'Saved';
      } catch (error) {
        $button.textContent = error.message;
      }

      setTimeout(() => {
        $button.textContent = LABEL;
      }, 2000);
    });

    omega.logger.log('Content script initialized!');
  });
