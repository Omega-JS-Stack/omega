/**
 * Surface: the main window's renderer (the `import` entry)
 * Doc: node_modules/@omega.js/desktop/docs/ipc.md
 *
 * What it consumes, one of each: omega.request() against the backend's
 * /notes routes (its own function), FormManager for the composer, data-omega-bind for the
 * display name and the count, the .omega-signin / .omega-account classes (no
 * JS), omega.desktop.ipc (answers notes:focus and
 * notes:create from main, reports each count), omega.desktop.storage (the app
 * store, where main keeps the last count), omega.storage (the page store, the
 * settings window's notes.confirmDelete), and omega.auth.reload() after a create.
 */
import omega from '@omega.js/desktop/renderer';
import { FormManager } from '@omega.js/client/modules/form-manager.js';

const NOTES_ROUTE = '/notes';

// The GET schema's own ceiling, so one list covers every note the count shows
const LIST_LIMIT = 100;

omega.initialize()
  .then(async () => {
    const { desktop, bindings, storage, utilities, logger } = omega;
    const $form = document.getElementById('notes-form');
    const $text = document.getElementById('note-text');
    const $list = document.getElementById('notes-list');
    const $empty = document.getElementById('notes-empty');

    // The count is main's fact, kept in the app store: paint the last one now,
    // and follow every change (a report from this window, a sign-out's clear)
    const showCount = (count) => bindings.update({ notes: { count: count || 0 } });
    showCount(await desktop.storage.get('notes.count', 0));
    desktop.storage.onChange('notes.count', ({ value }) => showCount(value));

    const load = async () => {
      const { notes } = await omega.request(`${NOTES_ROUTE}?limit=${LIST_LIMIT}`);

      renderNotes({ omega, $list, $empty, notes });
      desktop.ipc.send('notes:report', { count: notes.length });
    };

    const create = async (text) => {
      if (!omega.auth.user.authenticated) {
        throw new Error('Sign in to save notes.');
      }

      await omega.request(NOTES_ROUTE, { method: 'POST', body: { text } });
      await load();

      // The one re-read of the account, beside the listen() below
      await omega.auth.reload();
    };

    // FormManager owns the submit lifecycle; a throw here is the error it shows
    const form = new FormManager(omega, $form, { resetOnSuccess: true, warnOnUnsavedChanges: false });
    form.on('submit', ({ data }) => create(data.text));

    // One delegated listener serves every delete button the list ever draws.
    // notes.confirmDelete is the settings window's page-store setting, on by default.
    $list.addEventListener('click', async (event) => {
      const $button = event.target.closest('[data-note-delete]');

      if (!$button) {
        return;
      }

      if (storage.get('notes.confirmDelete', true) && !window.confirm('Delete this note?')) {
        return;
      }

      $button.disabled = true;

      try {
        await omega.request(NOTES_ROUTE, { method: 'DELETE', body: { id: $button.dataset.noteDelete } });
        await load();
      } catch (error) {
        $button.disabled = false;
        utilities.showNotification(error.message, { type: 'danger' });
      }
    });

    // Main's messages: the menu's "New note", and the context menu's
    // "Save selection as note"
    desktop.ipc.on('notes:focus', () => $text.focus());
    desktop.ipc.on('notes:create', (payload) => {
      create(payload?.text)
        .catch((error) => utilities.showNotification(error.message, { type: 'danger' }));
    });

    // Every landed auth state: a signed-in user gets their list; a signed-out
    // one an empty list (the view's bindings show the sign-in prompt)
    omega.auth.listen(({ user }) => {
      if (!user.authenticated) {
        renderNotes({ omega, $list, $empty, notes: [] });
        return;
      }

      load().catch((error) => utilities.showNotification(error.message, { type: 'danger' }));
    });

    logger.log('Main window initialized!');
  });

/**
 * Draw a list of notes. Every stored value goes through escapeHTML: a note's
 * text is whatever its author typed.
 * @param {object} options - { omega, $list, $empty, notes }
 */
function renderNotes({ omega, $list, $empty, notes }) {
  const { escapeHTML } = omega.utilities;

  $list.innerHTML = notes.map((note) => `
    <li class="notes-list__item">
      <div>
        <div class="notes-list__text">${escapeHTML(note.text)}</div>
        <small class="notes-list__date">${escapeHTML(new Date(note.metadata.created.timestamp).toLocaleString())}</small>
      </div>
      <button type="button" class="btn btn-sm btn-outline-danger" data-note-delete="${escapeHTML(note.id)}">Delete</button>
    </li>
  `).join('');

  $empty.hidden = notes.length > 0;
}
