/**
 * Boot-layer test: the notes feature in this project's REAL built bundle.
 *
 * test/main/notes-ipc.test.js proves src/lib/notes.js on the harness instance;
 * this proves src/main.js wired it, the three integrations carry their notes
 * items, and each crosses to the real main-window renderer and back over IPC.
 * The boot profile is signed out, so no step reaches the API.
 *
 * NOTE: `inspect` bodies are serialized to the spawned Electron process, so they
 * close over nothing from this module (every helper is inlined per test).
 * `require` and `process` are injected.
 */

module.exports = {
  type: 'group',
  layer: 'boot',
  description: 'notes: main, the integrations, and the main window (real bundle)',
  timeout: 30000,
  tests: [
    {
      description: 'notes:count answers over real IPC from the main window',
      inspect: async ({ omega, expect }) => {
        const poll = async (fn) => {
          for (let i = 0; i < 150; i++) {
            // A page mid-load can reject executeJavaScript: that is "not yet"
            const value = await Promise.resolve().then(fn).catch(() => null);
            if (value) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return null;
        };

        // The page is ready once FormManager owns the composer: the renderer's
        // notes code has run by then
        const win = await poll(() => omega.windows.get('main'));
        await poll(() => win.webContents.executeJavaScript('document.querySelector(\'#notes-form[data-form-state="ready"]\') !== null'));

        const answer = await win.webContents.executeJavaScript('window.desktop.ipc.invoke("notes:count")');

        expect(answer).toEqual({ count: 0 });
      },
    },

    {
      description: 'a report from the renderer moves the app store, the tray label and the page\'s count',
      inspect: async ({ omega, expect }) => {
        const poll = async (fn) => {
          for (let i = 0; i < 150; i++) {
            // A page mid-load can reject executeJavaScript: that is "not yet"
            const value = await Promise.resolve().then(fn).catch(() => null);
            if (value) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return null;
        };
        const win = omega.windows.get('main');
        const trayLabel = () => {
          const item = omega.tray.find('notes');
          return typeof item.label === 'function' ? item.label() : item.label;
        };

        expect(trayLabel()).toBe('Notes: 0');

        await win.webContents.executeJavaScript('window.desktop.ipc.send("notes:report", { count: 2 })');
        await poll(() => omega.storage.get('notes.count') === 2);

        expect(trayLabel()).toBe('Notes: 2');
        expect(await poll(() => win.webContents.executeJavaScript('document.getElementById("notes-count").textContent === "2"'))).toBe(true);

        omega.storage.delete('notes.count');
        expect(await poll(() => win.webContents.executeJavaScript('document.getElementById("notes-count").textContent === "0"'))).toBe(true);
      },
    },

    {
      description: 'the menu\'s Notes > New note focuses the main window\'s composer',
      inspect: async ({ omega, expect }) => {
        const poll = async (fn) => {
          for (let i = 0; i < 150; i++) {
            // A page mid-load can reject executeJavaScript: that is "not yet"
            const value = await Promise.resolve().then(fn).catch(() => null);
            if (value) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return null;
        };
        const win = omega.windows.get('main');

        omega.menu.find('notes/new').click();

        expect(await poll(() => win.webContents.executeJavaScript('document.activeElement && document.activeElement.id === "note-text"'))).toBe(true);
      },
    },

    {
      description: 'the context menu offers "Save selection as note", and its click reaches the renderer',
      inspect: async ({ omega, expect }) => {
        const poll = async (fn) => {
          for (let i = 0; i < 150; i++) {
            // A page mid-load can reject executeJavaScript: that is "not yet"
            const value = await Promise.resolve().then(fn).catch(() => null);
            if (value) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return null;
        };
        const win = omega.windows.get('main');

        // No selection, no item
        const plain = omega.contextMenu.buildItems({ selectionText: '', isEditable: false, editFlags: {} }, win.webContents);
        expect(plain.some((item) => item.id === 'save-note')).toBe(false);

        const items = omega.contextMenu.buildItems({ selectionText: 'from the boot test', isEditable: false, editFlags: {} }, win.webContents);
        const saveNote = items.find((item) => item.id === 'save-note');
        expect(Boolean(saveNote)).toBe(true);

        // Signed out, the renderer refuses before any request, and says so
        saveNote.click();
        const refused = await poll(() => win.webContents.executeJavaScript(
          '[...document.querySelectorAll(".alert-danger")].some((el) => el.textContent.includes("Sign in to save notes."))',
        ));

        expect(refused).toBe(true);
      },
    },

    {
      description: 'the notes panel\'s Sign in button runs main\'s sign-in flow over the open-flow channel',
      inspect: async ({ omega, expect }) => {
        const poll = async (fn) => {
          for (let i = 0; i < 150; i++) {
            // A page mid-load can reject executeJavaScript: that is "not yet"
            const value = await Promise.resolve().then(fn).catch(() => null);
            if (value) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return null;
        };
        const win = omega.windows.get('main');

        // The one stub: the real flow opens the user's browser
        let flows = 0;
        omega.openAuthFlow = async () => { flows++; return {}; };

        try {
          // Signed out, the prompt shows its button; a real click in the page
          // rides the renderer's `omega-signin` trigger to main
          expect(await poll(() => win.webContents.executeJavaScript('!document.getElementById("notes-signed-out").hidden'))).toBe(true);
          await win.webContents.executeJavaScript('document.querySelector("#notes-signed-out .omega-signin").click()');

          expect(await poll(() => flows === 1)).toBe(true);
        } finally {
          delete omega.openAuthFlow;
        }
      },
    },

    {
      description: 'the page\'s Sign out link signs main out over the sign-out channel',
      inspect: async ({ omega, expect }) => {
        const poll = async (fn) => {
          for (let i = 0; i < 150; i++) {
            // A page mid-load can reject executeJavaScript: that is "not yet"
            const value = await Promise.resolve().then(fn).catch(() => null);
            if (value) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return null;
        };
        const win = omega.windows.get('main');

        // Counted, then run for real: the profile is signed out, so main's
        // sign-out and its broadcast change nothing
        const signOut = omega.auth.signOut;
        let signOuts = 0;
        omega.auth.signOut = async () => { signOuts++; return signOut(); };

        try {
          // The client's `omega-signout` trigger asks confirm() first, a native
          // modal that would block the page, so the page answers yes; then a
          // real click in the page rides the trigger to main
          await win.webContents.executeJavaScript('window.confirm = () => true; document.querySelector("#notes-signed-in .omega-signout").click()');

          expect(await poll(() => signOuts === 1)).toBe(true);
        } finally {
          omega.auth.signOut = signOut;
        }
      },
    },

    {
      description: 'the <brand.id>://notes deep link brings the main window back',
      inspect: async ({ omega, expect }) => {
        const poll = async (fn) => {
          for (let i = 0; i < 150; i++) {
            // A page mid-load can reject executeJavaScript: that is "not yet"
            const value = await Promise.resolve().then(fn).catch(() => null);
            if (value) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return null;
        };
        const win = omega.windows.get('main');

        omega.windows.hide('main');
        expect(win.isVisible()).toBe(false);

        omega.deepLink.dispatch(`${omega.config.brand.id}://notes`);

        expect(await poll(() => win.isVisible())).toBe(true);
      },
    },

    {
      description: 'Preferences opens the settings window, and the setting it saves is the one the main window reads',
      inspect: async ({ omega, expect }) => {
        const poll = async (fn) => {
          for (let i = 0; i < 150; i++) {
            // A page mid-load can reject executeJavaScript: that is "not yet"
            const value = await Promise.resolve().then(fn).catch(() => null);
            if (value) return value;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return null;
        };
        const preferences = process.platform === 'darwin' ? 'main/preferences' : 'file/preferences';

        omega.menu.find(preferences).click();

        const settings = await poll(() => omega.windows.get('settings'));
        const toggle = 'document.getElementById("confirm-delete")';

        // On by default. The view ships it unchecked and the renderer checks it
        // in the same turn it attaches the change listener, so checked = ready.
        expect(await poll(() => settings.webContents.executeJavaScript(`${toggle}.checked`))).toBe(true);

        // A real click turns it off and saves
        await settings.webContents.executeJavaScript(`${toggle}.click()`);
        expect(await poll(() => settings.webContents.executeJavaScript('document.getElementById("confirm-delete-status").textContent === "Saved."'))).toBe(true);

        // The page store is the window's localStorage under the client's one
        // key (_manager, @omega.js/client's modules/storage.js): the main
        // window, a separate page, reads the value the settings window wrote
        const main = omega.windows.get('main');
        const read = await main.webContents.executeJavaScript('JSON.parse(localStorage.getItem("_manager") || "{}").notes');

        expect(read.confirmDelete).toBe(false);

        omega.windows.close('settings');
      },
    },
  ],
};
