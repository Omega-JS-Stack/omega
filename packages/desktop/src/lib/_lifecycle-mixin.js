// The main process's quit/relaunch pair: methods mixed into the `Omega` class
// (src/main.js) with `Object.assign(Omega.prototype, ...)`, so they stay
// `omega.quit()` and `omega.relaunch()` on the instance.

module.exports = {
  // Force a real quit, bypassing per-window `hideOnClose`. Use this anywhere the
  // app legitimately wants to exit (tray Quit, Cmd+Q from menu role:'quit',
  // auto-updater install). Without `{ force: true }`, the close events still get
  // trapped by hide-on-close handlers and the app stays running.
  quit(options) {
    options = options || {};

    if (options.force) {
      this._allowQuit = true;
    }

    try {
      require('electron').app.quit();
    } catch (e) { /* electron not available: no-op in test/headless */ }
  },

  // Force a relaunch: same gating as quit, but tells electron to start back up
  // after exit. If an update has been downloaded, prefers `quitAndInstall()` so
  // the user lands on the new version instead of the old one.
  relaunch(options) {
    options = options || {};

    if (options.force) {
      this._allowQuit = true;
    }

    const electron = require('electron');

    // If updater downloaded a fresh build, install + relaunch via electron-updater
    // (which calls `app.quit()` internally with the right post-quit script). Falls
    // back to plain relaunch if updater hasn't downloaded anything.
    const updaterStatus = this.autoUpdater.getStatus();
    if (updaterStatus.code === 'downloaded') {
      return this.autoUpdater.installNow();
    }

    electron.app.relaunch();
    electron.app.quit();
  },
};
