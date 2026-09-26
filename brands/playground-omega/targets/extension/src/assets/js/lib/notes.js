/**
 * Surface: the sending side of the messenger (omega.messenger.send to
 * background), shared by every context that asks for notes
 * Doc: node_modules/@omega.js/extension/docs/contexts.md
 */

// The one setting the options page writes and the content script reads. It
// lives in the extension's own store (omega.extension.storage), the one store
// a content script can read: a page context's omega.storage is that page's
// localStorage, out of reach of the host page a content script runs in. The
// wrapper hands back the whole storage namespace, so the area is named: sync,
// which follows the user's browser sign-in.
export const AUTO_SAVE_KEY = 'notes.autoSaveSelection';

/**
 * Send one notes command to background and unwrap its envelope.
 * @param {object} omega - this context's instance.
 * @param {string} command - notes:list, notes:create, notes:delete or notes:count.
 * @param {object} [payload] - the command's input.
 * @returns {Promise<object>} the answer (its `ok` is true).
 */
export async function askBackground(omega, command, payload) {
  const answer = await omega.messenger.send({ destination: 'background', command, payload });

  // The messenger resolves undefined when no receiver answered at all
  if (!answer) {
    throw new Error(`Background did not answer ${command}.`);
  }

  if (!answer.ok) {
    throw new Error(answer.error);
  }

  return answer;
}

/**
 * Whether the user turned on "save selection as note" in the options page.
 * @param {object} omega - this context's instance.
 * @returns {Promise<boolean>} the setting, false until the user sets it.
 */
export async function readAutoSave(omega) {
  const stored = await omega.extension.storage.sync.get(AUTO_SAVE_KEY);

  return stored[AUTO_SAVE_KEY] === true;
}
