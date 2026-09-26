/**
 * Surface: the main process's side of the notes feature: ipc.handle and
 * ipc.on, the app store (omega.storage), omega.auth.listen, a deep link, and
 * the tray refresh
 * Doc: node_modules/@omega.js/desktop/docs/ipc.md
 *
 * The main window's renderer owns the notes themselves (it calls the API);
 * main keeps the one fact the rest of the app shows, the last count, in the
 * app store. src/main.js calls initialize(); the tray, menu and context-menu
 * definitions under src/integrations/ call the helpers below.
 */

// The app-store key the renderer reads through omega.desktop.storage
const COUNT_KEY = 'notes.count';

/**
 * Wire main's half of the notes feature.
 * @param {object} omega - the main-process instance.
 * @returns {Function} the teardown: unregisters every handler this wired.
 */
function initialize(omega) {
  // The renderer reports every count it draws. Its payload is untrusted input
  // (docs/ipc.md, zero-trust payloads): a count is a non-negative integer.
  const report = (payload) => {
    const count = payload?.count;

    if (!Number.isInteger(count) || count < 0) {
      omega.logger.warn('notes:report ignored a payload with no valid count:', payload);
      return;
    }

    omega.storage.set(COUNT_KEY, count);
    omega.tray.refresh();
  };

  omega.ipc.handle('notes:count', async () => ({ count: readCount(omega) }));
  omega.ipc.on('notes:report', report);

  // Only a real sign-out clears the count. listen() also catches up with the
  // current state, and at boot main is signed out until a renderer pushes the
  // account, so a plain "signed out" is not a sign-out.
  let signedIn = false;
  const stopAuth = omega.auth.listen(({ user }) => {
    if (signedIn && !user.authenticated) {
      omega.storage.delete(COUNT_KEY);
      omega.tray.refresh();
    }

    signedIn = user.authenticated;
  });

  // <brand.id>://notes brings the notes window forward
  const stopLink = omega.deepLink.on('notes', () => omega.windows.show('main'));

  return () => {
    omega.ipc.unhandle('notes:count');
    omega.ipc.off('notes:report', report);
    stopAuth();
    stopLink();
  };
}

/**
 * The last count the renderer reported, 0 before the first.
 * @param {object} omega - the main-process instance.
 * @returns {number} the count.
 */
function readCount(omega) {
  return omega.storage.get(COUNT_KEY, 0);
}

/**
 * The tray item's label, re-read on every tray refresh.
 * @param {object} omega - the main-process instance.
 * @returns {string} the label.
 */
function trayLabel(omega) {
  return `Notes: ${readCount(omega)}`;
}

/**
 * Bring the main window forward and hand its renderer one notes message.
 * @param {object} omega - the main-process instance.
 * @param {string} channel - notes:focus or notes:create.
 * @param {object} [payload] - the message's input.
 */
function sendToNotes(omega, channel, payload) {
  omega.windows.show('main');

  // src/main.js creates `main` at boot and it hides instead of closing, so it
  // exists here; ipc.send is a no-op for a missing one all the same
  omega.ipc.send(omega.windows.get('main')?.webContents, channel, payload);
}

module.exports = { initialize, readCount, trayLabel, sendToNotes };
