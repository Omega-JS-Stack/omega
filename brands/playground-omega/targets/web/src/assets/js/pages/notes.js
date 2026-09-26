/**
 * Surface: a page module, bound to /notes by its asset key (js/pages/notes.js)
 * Doc: node_modules/@omega.js/web/docs/index.md (The consumer entry)
 *
 * What it consumes, one of each: FormManager for the composer, omega.request()
 * against the backend's /notes routes (GET, POST, DELETE, its own function),
 * omega.auth.listen() to load the list once a user lands, omega.firestore for a
 * live read of the counter the backend's notes/on-create event keeps, and
 * omega.bindings to publish that counter into the section's data-omega-bind.
 */
import { FormManager } from '@omega.js/client/modules/form-manager.js';

export const NOTES_ROUTE = '/notes';

export default async ({ omega }) => {
  const elements = {
    $form: document.getElementById('notes-form'),
    $list: document.getElementById('notes-list'),
    $empty: document.getElementById('notes-empty'),
  };
  let stopCounter = null;

  // One delegated listener serves every delete button the list ever renders
  elements.$list.addEventListener('click', async (event) => {
    const $button = event.target.closest('[data-note-delete]');

    if (!$button) {
      return;
    }

    $button.disabled = true;

    try {
      await omega.request(NOTES_ROUTE, { method: 'DELETE', body: { id: $button.dataset.noteDelete } });
      await loadNotes({ omega, ...elements });
    } catch (error) {
      $button.disabled = false;
      omega.utilities.showNotification(error.message, { type: 'danger' });
    }
  });

  // FormManager owns the submit lifecycle (disable, spinner, error toast); a
  // throw from this handler is what it shows as the error
  const form = new FormManager(omega, elements.$form, { resetOnSuccess: true, warnOnUnsavedChanges: false });

  form.on('submit', async ({ data }) => {
    await omega.request(NOTES_ROUTE, { method: 'POST', body: { text: data.text } });
    await loadNotes({ omega, ...elements });
  });

  // Every landed auth state: load this user's notes and follow their counter.
  // The auth policy already keeps a signed-out visitor off this page, so the
  // signed-out branch only clears what a sign-out mid-session leaves behind.
  omega.auth.listen(({ user }) => {
    if (stopCounter) {
      stopCounter();
      stopCounter = null;
    }

    if (!user.authenticated) {
      renderNotes({ omega, ...elements, notes: [] });
      return;
    }

    loadNotes({ omega, ...elements })
      .catch((error) => omega.utilities.showNotification(error.message, { type: 'danger' }));

    // The counter is written by the backend event a moment after each create,
    // so it is followed live rather than read once
    stopCounter = omega.firestore.doc(`notes-stats/${user.uid}`).onSnapshot((snapshot) => {
      omega.bindings.update({ notes: { created: snapshot.data()?.created || 0 } });
    });
  });
};

/**
 * Fetch the signed-in user's notes and draw them.
 * @param {object} options - { omega, $list, $empty }
 * @returns {Promise<object[]>} the notes drawn
 */
export async function loadNotes({ omega, $list, $empty }) {
  const response = await omega.request(`${NOTES_ROUTE}?limit=20`);
  const notes = response.notes;

  renderNotes({ omega, $list, $empty, notes });

  return notes;
}

/**
 * Draw a list of notes. Every stored value goes through escapeHTML: a note's
 * text is whatever its author typed.
 * @param {object} options - { omega, $list, $empty, notes }
 */
export function renderNotes({ omega, $list, $empty, notes }) {
  const { escapeHTML } = omega.utilities;

  $list.innerHTML = notes.map((note) => `
    <li class="notes-list__item">
      <div>
        <span class="notes-list__text">${escapeHTML(note.text)}</span>
        <small class="notes-list__date">${escapeHTML(new Date(note.metadata.created.timestamp).toLocaleString())}</small>
      </div>
      <button type="button" class="btn btn-sm btn-outline-adaptive" data-note-delete="${escapeHTML(note.id)}">Delete</button>
    </li>
  `).join('');

  $empty.hidden = notes.length > 0;
}
