/**
 * Surface: a page context's notes UI (the sidepanel and the pages dashboard
 * both mount it): FormManager, omega.utilities.escapeHTML, and the messenger
 * round trip to background
 * Doc: node_modules/@omega.js/extension/docs/components.md
 */
import { FormManager } from '@omega.js/client/modules/form-manager.js';
import { askBackground } from './notes.js';

/**
 * Wire the notes list, its create form and its delete buttons.
 * @param {object} options - { omega, onCreated }: the page's instance, and an
 *   optional step to run after each create.
 * @returns {Function} the loader, to redraw the list on demand.
 */
export function mountNotes({ omega, onCreated }) {
  const $form = document.getElementById('notes-form');
  const $list = document.getElementById('notes-list');
  const $empty = document.getElementById('notes-empty');

  const load = async () => {
    const { notes } = await askBackground(omega, 'notes:list');

    renderNotes({ omega, $list, $empty, notes });
  };

  // One delegated listener serves every delete button the list ever draws
  $list.addEventListener('click', async (event) => {
    const $button = event.target.closest('[data-note-delete]');

    if (!$button) {
      return;
    }

    $button.disabled = true;

    try {
      await askBackground(omega, 'notes:delete', { id: $button.dataset.noteDelete });
      await load();
    } catch (error) {
      $button.disabled = false;
      omega.utilities.showNotification(error.message, { type: 'danger' });
    }
  });

  // FormManager owns the submit lifecycle; a throw here is the error it shows
  const form = new FormManager(omega, $form, { resetOnSuccess: true, warnOnUnsavedChanges: false });

  form.on('submit', async ({ data }) => {
    await askBackground(omega, 'notes:create', { text: data.text });
    await load();

    if (onCreated) {
      await onCreated();
    }
  });

  // Every landed auth state: a signed-in user gets their list, a signed-out
  // one an empty list (the view's bindings show the sign-in prompt)
  omega.auth.listen(({ user }) => {
    if (!user.authenticated) {
      renderNotes({ omega, $list, $empty, notes: [] });
      return;
    }

    load().catch((error) => omega.utilities.showNotification(error.message, { type: 'danger' }));
  });

  return load;
}

/**
 * Draw a list of notes. Every stored value goes through escapeHTML: a note's
 * text is whatever its author typed.
 * @param {object} options - { omega, $list, $empty, notes }
 */
function renderNotes({ omega, $list, $empty, notes }) {
  const { escapeHTML } = omega.utilities;

  $list.innerHTML = notes.map((note) => `
    <li class="notes-list__item d-flex justify-content-between align-items-start gap-2 py-2">
      <div>
        <div class="notes-list__text">${escapeHTML(note.text)}</div>
        <small class="text-muted">${escapeHTML(new Date(note.metadata.created.timestamp).toLocaleString())}</small>
      </div>
      <button type="button" class="btn btn-sm btn-outline-danger" data-note-delete="${escapeHTML(note.id)}">Delete</button>
    </li>
  `).join('');

  $empty.hidden = notes.length > 0;
}
