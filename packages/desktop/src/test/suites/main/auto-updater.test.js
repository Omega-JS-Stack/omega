// Main-process tests for lib/auto-updater.js — state machine, dev simulation,
// 30-day pending-update gate (first-download-wins).
//
// Each test resets the updater + clears storage so we get clean state.

const defineCases = require('@omega.js/devkit/test/define-cases');

const STORAGE_KEY = 'autoUpdater';

async function reinit(ctx, env) {
  const updater = ctx.manager.autoUpdater;
  updater.shutdown();
  ctx.manager.storage.set(STORAGE_KEY, null);

  // Snapshot + override env for this run.
  const saved = { OMEGA_DEV_UPDATE: process.env.OMEGA_DEV_UPDATE };
  for (const [k, v] of Object.entries(env || {})) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  await updater.initialize(ctx.manager);
  return async () => {
    updater.shutdown();
    for (const [k, v] of Object.entries(saved)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
    // Re-init with the original env so subsequent tests have a working updater + IPC handlers.
    await updater.initialize(ctx.manager);
  };
}

function waitFor(predicate, { timeout = 3000, step = 50 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (predicate()) return resolve();
      } catch (e) { /* keep polling */ }
      if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
      setTimeout(tick, step);
    };
    tick();
  });
}

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'auto-updater (main)',
  cleanup: async (ctx) => {
    ctx.manager.autoUpdater.shutdown();
    ctx.manager.storage.set(STORAGE_KEY, null);
    delete process.env.OMEGA_DEV_UPDATE;
    await ctx.manager.autoUpdater.initialize(ctx.manager);
  },
  tests: [
    {
      name: 'initialize ran during boot — initial status is idle',
      run: (ctx) => {
        const status = ctx.manager.autoUpdater.getStatus();
        ctx.expect(status.code).toBe('idle');
        ctx.expect(status.percent).toBe(0);
        ctx.expect(status.error).toBe(null);
      },
    },
    {
      name: 'dev simulation: available scenario walks state through downloaded',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: 'available' });
        try {
          await ctx.manager.autoUpdater.checkNow({ userInitiated: true });
          await waitFor(() => ctx.manager.autoUpdater.getStatus().code === 'downloaded', { timeout: 5000 });

          const s = ctx.manager.autoUpdater.getStatus();
          ctx.expect(s.code).toBe('downloaded');
          ctx.expect(s.version).toBe('999.0.0');
          ctx.expect(s.percent).toBe(100);
          ctx.expect(typeof s.downloadedAt).toBe('number');
        } finally { await restore(); }
      },
    },
    {
      name: 'dev simulation: unavailable scenario lands in not-available',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: 'unavailable' });
        try {
          await ctx.manager.autoUpdater.checkNow({ userInitiated: false });
          await waitFor(() => ctx.manager.autoUpdater.getStatus().code === 'not-available');

          const s = ctx.manager.autoUpdater.getStatus();
          ctx.expect(s.code).toBe('not-available');
          ctx.expect(s.error).toBe(null);
        } finally { await restore(); }
      },
    },
    {
      name: 'dev simulation: error scenario lands in error',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: 'error' });
        try {
          await ctx.manager.autoUpdater.checkNow({ userInitiated: false });
          await waitFor(() => ctx.manager.autoUpdater.getStatus().code === 'error');

          const s = ctx.manager.autoUpdater.getStatus();
          ctx.expect(s.code).toBe('error');
          ctx.expect(s.error).toBeDefined();
          ctx.expect(s.error.message).toMatch(/Simulated/);
        } finally { await restore(); }
      },
    },
    {
      name: 'simulate(): available scenario walks state through downloaded with no env var set',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: null });
        try {
          await ctx.manager.autoUpdater.simulate('available');
          await waitFor(() => ctx.manager.autoUpdater.getStatus().code === 'downloaded', { timeout: 5000 });

          const s = ctx.manager.autoUpdater.getStatus();
          ctx.expect(s.code).toBe('downloaded');
          ctx.expect(s.version).toBe('999.0.0');
          ctx.expect(s.percent).toBe(100);
        } finally { await restore(); }
      },
    },
    {
      name: 'simulate(): unavailable scenario lands in not-available',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: null });
        try {
          await ctx.manager.autoUpdater.simulate('unavailable');
          await waitFor(() => ctx.manager.autoUpdater.getStatus().code === 'not-available');

          ctx.expect(ctx.manager.autoUpdater.getStatus().error).toBe(null);
        } finally { await restore(); }
      },
    },
    {
      name: 'simulate(): error scenario lands in error',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: null });
        try {
          await ctx.manager.autoUpdater.simulate('error');
          await waitFor(() => ctx.manager.autoUpdater.getStatus().code === 'error');

          ctx.expect(ctx.manager.autoUpdater.getStatus().error.message).toMatch(/Simulated/);
        } finally { await restore(); }
      },
    },
    {
      name: 'simulate(): unknown scenario throws',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: null });
        try {
          await ctx.expect(() => ctx.manager.autoUpdater.simulate('sideways')).toThrow(/unknown scenario/i);
          await ctx.expect(() => ctx.manager.autoUpdater.simulate()).toThrow(/scenario required/i);
        } finally { await restore(); }
      },
    },
    {
      name: 'simulate(): refuses in a production build unless OMEGA_DEV_UPDATE is set',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: null });
        const origIsProduction = ctx.manager.isProduction;
        ctx.manager.isProduction = () => true;
        try {
          await ctx.expect(() => ctx.manager.autoUpdater.simulate('available')).toThrow(/production/i);
          ctx.expect(ctx.manager.autoUpdater.getStatus().code).toBe('idle');

          // ...but a packaged QA build launched with the env var set may still simulate.
          process.env.OMEGA_DEV_UPDATE = 'available';
          await ctx.manager.autoUpdater.simulate('unavailable');
          await waitFor(() => ctx.manager.autoUpdater.getStatus().code === 'not-available');
        } finally {
          delete process.env.OMEGA_DEV_UPDATE;
          ctx.manager.isProduction = origIsProduction;
          await restore();
        }
      },
    },
    {
      // The whole point of the session flag: simulate() leaves the synthetic library
      // wired, so every LATER trigger (the hourly feed tick) drives the simulator too.
      // Without _isSimulating() latching, that fake 'downloaded' walks into the real
      // install path and flips the manager's quit latch.
      name: 'simulate(): latches the session so a later feed tick cannot reach the real install path',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: null });
        const u = ctx.manager.autoUpdater;
        const origPrompt = u._promptToInstall;
        let promptCalls = 0;
        u._promptToInstall = async () => { promptCalls++; };
        try {
          await u.simulate('unavailable');
          await waitFor(() => u.getStatus().code === 'not-available');
          ctx.expect(u._isSimulating()).toBe(true);

          // The feed tick calls checkForUpdates() with no scenario: the simulator falls
          // back to 'available' and lands on a fake downloaded v999.0.0.
          await u._feedCheckTick();
          await waitFor(() => u.getStatus().code === 'downloaded', { timeout: 5000 });

          // User idle well past the threshold, background check: only the simulation
          // guard stands between this and a real install.
          u._userInitiated = false;
          u._lastActivityAt = Date.now() - (10 * 60 * 1000);
          u._evaluateIdleInstall();

          ctx.expect(ctx.manager._allowQuit).toBe(false);
          ctx.expect(promptCalls).toBe(0);
        } finally {
          u._promptToInstall = origPrompt;
          ctx.manager._allowQuit = false;
          await restore();
        }
      },
    },
    {
      name: 'simulate(): shutdown clears the session flag',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: null });
        const u = ctx.manager.autoUpdater;
        try {
          await u.simulate('unavailable');
          ctx.expect(u._isSimulating()).toBe(true);

          u.shutdown();
          ctx.expect(u._isSimulating()).toBe(false);
        } finally { await restore(); }
      },
    },
    {
      name: 'simulate(): refuses while a cascade is already running',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: null });
        const u = ctx.manager.autoUpdater;
        try {
          await u.simulate('available');
          ctx.expect(u._devSimulating).toBe(true);

          await ctx.expect(() => u.simulate('error')).toThrow(/already running/i);
          // The refused call must not have reset the running cascade's state.
          ctx.expect(u.getStatus().code).not.toBe('idle');
          await waitFor(() => u.getStatus().code === 'downloaded', { timeout: 5000 });
        } finally { await restore(); }
      },
    },
    {
      name: 'dev simulation: the env-var cascade never writes the pendingUpdate storage key',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: 'available' });
        try {
          await ctx.manager.autoUpdater.checkNow({ userInitiated: false });
          await waitFor(() => ctx.manager.autoUpdater.getStatus().code === 'downloaded', { timeout: 5000 });

          // The fake download stamps memory (the in-session UI flow reads the
          // same as a real one) but must leave the production record alone.
          ctx.expect(typeof ctx.manager.autoUpdater.getStatus().downloadedAt).toBe('number');
          ctx.expect(ctx.manager.storage.get(`${STORAGE_KEY}.pendingUpdate`)).toBeUndefined();
        } finally { await restore(); }
      },
    },
    {
      name: 'simulate(): the cascade never writes the pendingUpdate storage key',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: null });
        try {
          await ctx.manager.autoUpdater.simulate('available');
          await waitFor(() => ctx.manager.autoUpdater.getStatus().code === 'downloaded', { timeout: 5000 });

          ctx.expect(typeof ctx.manager.autoUpdater.getStatus().downloadedAt).toBe('number');
          ctx.expect(ctx.manager.storage.get(`${STORAGE_KEY}.pendingUpdate`)).toBeUndefined();
        } finally { await restore(); }
      },
    },
    {
      // Heals profiles an older build already polluted: a simulated record
      // whose version can never be applied would otherwise seed the 30-day
      // gate and force-install the first REAL download on the spot.
      name: 'a stale simulated pendingUpdate cannot seed a real download (30-day gate does not force install)',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: null });
        const updater = ctx.manager.autoUpdater;
        let quitCalled = false;
        let origQuit;
        try {
          // A 40-day-old simulator record, then a boot so the reconciler sees it.
          const staleTs = Date.now() - (40 * 24 * 60 * 60 * 1000);
          ctx.manager.storage.set(`${STORAGE_KEY}.pendingUpdate`, { version: '999.0.0', downloadedAt: staleTs });
          updater.shutdown();
          await updater.initialize(ctx.manager);

          ctx.expect(ctx.manager.storage.get(`${STORAGE_KEY}.pendingUpdate`)).toBe(null);
          ctx.expect(updater._state.downloadedAt).toBe(null);

          // A real update downloads: it starts its OWN 30-day clock.
          const before = Date.now();
          origQuit = updater._library.quitAndInstall;
          updater._library.quitAndInstall = () => { quitCalled = true; };
          updater._library.emit('update-downloaded', { version: '2.0.0' });

          const stored = ctx.manager.storage.get(`${STORAGE_KEY}.pendingUpdate`);
          ctx.expect(stored.version).toBe('2.0.0');
          ctx.expect(stored.downloadedAt).not.toBeLessThan(before);
          ctx.expect(updater._state.downloadedAt).toBe(stored.downloadedAt);
          ctx.expect(quitCalled).toBe(false);
        } finally {
          // The spy sat on the shared electron-updater singleton.
          if (origQuit) updater._library.quitAndInstall = origQuit;
          ctx.manager._allowQuit = false;
          await restore();
        }
      },
    },
    {
      // A REAL download, not the simulator: the simulator deliberately never
      // writes this key (see the two cases above).
      name: 'first download persists pendingUpdate to storage',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: null });
        const updater = ctx.manager.autoUpdater;
        try {
          updater._library.emit('update-downloaded', { version: '2.0.0' });
          ctx.expect(updater.getStatus().code).toBe('downloaded');

          const stored = ctx.manager.storage.get(`${STORAGE_KEY}.pendingUpdate`);
          ctx.expect(stored).toBeDefined();
          ctx.expect(stored.version).toBe('2.0.0');
          ctx.expect(typeof stored.downloadedAt).toBe('number');
        } finally { await restore(); }
      },
    },
    {
      name: 'subsequent download keeps downloadedAt but tracks the NEW version (first timer wins, clear-on-apply matches)',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: null });
        try {
          // Plant an older pending-update record manually.
          const oldTs = Date.now() - (10 * 24 * 60 * 60 * 1000);  // 10 days ago
          ctx.manager.storage.set(`${STORAGE_KEY}.pendingUpdate`, { version: '888.0.0', downloadedAt: oldTs });

          // Call _recordDownloadedAt for a "new" download.
          ctx.manager.autoUpdater._recordDownloadedAt('2.0.0');

          const stored = ctx.manager.storage.get(`${STORAGE_KEY}.pendingUpdate`);
          // Timer unchanged (first-download-wins) — but the version must track
          // the newest download: after installing 2.0.0, the clear-on-apply
          // check (pending.version === getVersion()) has to match, or the stale
          // flag would force-install every future download instantly forever.
          ctx.expect(stored.downloadedAt).toBe(oldTs);
          ctx.expect(stored.version).toBe('2.0.0');
        } finally { await restore(); }
      },
    },
    {
      name: '30-day gate: pending update older than maxAgeMs forces installNow',
      run: async (ctx) => {
        const restore = await reinit(ctx, {});
        let installCalled = false;
        try {
          // Override installNow to capture the trigger without actually quitting.
          const origInstall = ctx.manager.autoUpdater.installNow;
          ctx.manager.autoUpdater.installNow = async () => { installCalled = true; return true; };

          // Plant an old pending-update.
          const oldTs = Date.now() - (31 * 24 * 60 * 60 * 1000);
          ctx.manager.autoUpdater._state.downloadedAt = oldTs;
          ctx.manager.autoUpdater._options.maxAgeMs = 30 * 24 * 60 * 60 * 1000;

          const triggered = ctx.manager.autoUpdater._enforceMaxAgeGate();
          ctx.expect(triggered).toBe(true);
          ctx.expect(installCalled).toBe(true);

          ctx.manager.autoUpdater.installNow = origInstall;
        } finally { await restore(); }
      },
    },
    {
      // wave-5 F3: at reconcile the gate provably CANNOT install (state is
      // 'idle' and installNow requires 'downloaded') — the install must fire
      // when the startup re-download lands, via the update-downloaded handler.
      name: '30-day gate: carried-over stale pending installs when update-downloaded fires (real installNow state guard)',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: null });
        const updater = ctx.manager.autoUpdater;
        let quitCalled = false;
        let origQuit;
        try {
          // Plant a >30-day pending update, then reconcile like a fresh boot.
          const oldTs = Date.now() - (31 * 24 * 60 * 60 * 1000);
          ctx.manager.storage.set(`${STORAGE_KEY}.pendingUpdate`, { version: '777.0.0', downloadedAt: oldTs });
          updater._options.maxAgeMs = 30 * 24 * 60 * 60 * 1000;
          updater._reconcilePendingUpdate();

          // Reconcile alone cannot install — the REAL installNow refuses on 'idle'.
          ctx.expect(updater._state.code).toBe('idle');
          ctx.expect(await updater.installNow()).toBe(false);

          // The startup re-download lands: the wired update-downloaded handler
          // must enforce the gate against the restored ORIGINAL downloadedAt.
          origQuit = updater._library.quitAndInstall;
          updater._library.quitAndInstall = () => { quitCalled = true; };
          updater._library.emit('update-downloaded', { version: '777.0.0' });
          ctx.expect(updater._state.code).toBe('downloaded');
          ctx.expect(updater._state.downloadedAt).toBe(oldTs); // first-download-wins
          ctx.expect(quitCalled).toBe(true);
        } finally {
          // The spy sat on the shared electron-updater singleton; the install
          // path also flipped the manager's quit latch — undo both.
          if (origQuit) updater._library.quitAndInstall = origQuit;
          ctx.manager._allowQuit = false;
          await restore();
        }
      },
    },
    {
      name: '30-day gate: fresh pending update does NOT force install',
      run: async (ctx) => {
        const restore = await reinit(ctx, {});
        try {
          ctx.manager.autoUpdater._state.downloadedAt = Date.now() - (5 * 24 * 60 * 60 * 1000);
          ctx.manager.autoUpdater._options.maxAgeMs = 30 * 24 * 60 * 60 * 1000;

          const triggered = ctx.manager.autoUpdater._enforceMaxAgeGate();
          ctx.expect(triggered).toBe(false);
        } finally { await restore(); }
      },
    },
    {
      name: 'pendingUpdate cleared when current version matches (update was applied)',
      run: async (ctx) => {
        const restore = await reinit(ctx, {});
        try {
          // Stash a pending-update entry whose version matches our current package version.
          const currentVersion = ctx.manager.getVersion();
          ctx.expect(typeof currentVersion).toBe('string');

          ctx.manager.storage.set(`${STORAGE_KEY}.pendingUpdate`, {
            version: currentVersion,
            downloadedAt: Date.now() - (5 * 24 * 60 * 60 * 1000),
          });

          // Re-init triggers the reconciler.
          ctx.manager.autoUpdater.shutdown();
          await ctx.manager.autoUpdater.initialize(ctx.manager);

          const stillThere = ctx.manager.storage.get(`${STORAGE_KEY}.pendingUpdate`);
          ctx.expect(stillThere).toBe(null);
        } finally { await restore(); }
      },
    },
    {
      name: 'checkNow returns current status object',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: 'unavailable' });
        try {
          const result = await ctx.manager.autoUpdater.checkNow();
          ctx.expect(typeof result.code).toBe('string');
          ctx.expect('percent' in result).toBe(true);
        } finally { await restore(); }
      },
    },
    {
      name: 'IPC handler registered: desktop:auto-updater:status returns status',
      run: async (ctx) => {
        const result = await ctx.manager.ipc.invoke('desktop:auto-updater:status');
        ctx.expect(typeof result.code).toBe('string');
      },
    },
    {
      name: 'enabled=false: skip wiring, no library, no interval',
      run: async (ctx) => {
        ctx.manager.autoUpdater.shutdown();
        const cfg = ctx.manager.config;
        const orig = cfg.autoUpdate;
        cfg.autoUpdate = { enabled: false };
        try {
          await ctx.manager.autoUpdater.initialize(ctx.manager);
          ctx.expect(ctx.manager.autoUpdater._feedCheckIntervalId).toBe(null);
          ctx.expect(ctx.manager.autoUpdater._idleEvalIntervalId).toBe(null);
          ctx.expect(ctx.manager.autoUpdater._library).toBe(null);
        } finally {
          cfg.autoUpdate = orig;
          ctx.manager.autoUpdater.shutdown();
          await ctx.manager.autoUpdater.initialize(ctx.manager);
        }
      },
    },

    // ─── Idle-aware install (1.2.33 + 1.2.38 refactor) ───────────────────────────
    //
    // The post-download install path is now centralized in the periodic tick. Tests
    // exercise _evaluateIdleInstall() directly with stubbed installNow + _promptToInstall
    // so we don't need a real BrowserWindow/dialog and don't actually quit the test.

    {
      name: 'markActive() bumps _lastActivityAt to current time',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        u._lastActivityAt = 0;
        const before = Date.now();
        u.markActive();
        const after = Date.now();
        ctx.expect(u._lastActivityAt >= before).toBe(true);
        ctx.expect(u._lastActivityAt <= after).toBe(true);
      },
    },
    {
      name: '_onActivityIpc routes through to markActive',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        u._lastActivityAt = 0;
        u._onActivityIpc();
        ctx.expect(u._lastActivityAt > 0).toBe(true);
      },
    },
    {
      name: 'IPC channel desktop:auto-updater:activity is registered + bumps activity timestamp',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        // initialize() registered the listener — verify presence + simulate an inbound
        // renderer message by invoking each registered listener directly. In-process
        // this matches what `ipcMain.on(channel, ...)` does on a real `ipcRenderer.send`.
        const listeners = ctx.manager.ipc._listeners['desktop:auto-updater:activity'];
        ctx.expect(listeners).toBeDefined();
        ctx.expect(listeners.size > 0).toBe(true);
        u._lastActivityAt = 0;
        listeners.forEach((fn) => fn());
        ctx.expect(u._lastActivityAt > 0).toBe(true);
      },
    },
    {
      name: 'idle-install: when idle ≥ threshold + state=downloaded, installNow fires',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        const origInstall = u.installNow;
        let installCalled = false;
        u.installNow = async () => { installCalled = true; return true; };
        try {
          // Force state into "downloaded", non-user-initiated, with idle past threshold.
          u._state = { ...u._state, code: 'downloaded', version: '1.2.3' };
          u._userInitiated = false;
          u._promptedForVersion = null;
          // Simulate 16 minutes of idle.
          u._lastActivityAt = Date.now() - (16 * 60 * 1000);
          // Bypass dev-mode bail so we exercise the real path.
          const origIsSimulating = u._isSimulating;
          u._isSimulating = () => false;
          try {
            u._evaluateIdleInstall();
          } finally { u._isSimulating = origIsSimulating; }
          ctx.expect(installCalled).toBe(true);
        } finally { u.installNow = origInstall; }
      },
    },
    {
      name: 'idle-install: when active, prompt fires once per version (no install)',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        const origInstall = u.installNow;
        const origPrompt  = u._promptToInstall;
        let installCalled = false;
        let promptCalls   = 0;
        u.installNow = async () => { installCalled = true; return true; };
        u._promptToInstall = async (v) => { promptCalls++; };
        try {
          u._state = { ...u._state, code: 'downloaded', version: '1.2.3' };
          u._userInitiated = false;
          u._promptedForVersion = null;
          u._lastActivityAt = Date.now();   // active right now
          const origIsSimulating = u._isSimulating;
          u._isSimulating = () => false;
          try {
            u._evaluateIdleInstall();
            u._evaluateIdleInstall();
            u._evaluateIdleInstall();
          } finally { u._isSimulating = origIsSimulating; }
          ctx.expect(installCalled).toBe(false);     // user is active — no surprise install
          ctx.expect(promptCalls).toBe(1);           // dedup'd by _promptedForVersion
          ctx.expect(u._promptedForVersion).toBe('1.2.3');
        } finally {
          u.installNow = origInstall;
          u._promptToInstall = origPrompt;
        }
      },
    },
    {
      name: 'idle-install: a NEW downloaded version re-arms the prompt',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        const origPrompt = u._promptToInstall;
        let promptCalls  = 0;
        u._promptToInstall = async (v) => { promptCalls++; };
        try {
          u._userInitiated = false;
          u._promptedForVersion = null;
          u._lastActivityAt = Date.now();
          const origIsSimulating = u._isSimulating;
          u._isSimulating = () => false;
          try {
            u._state = { ...u._state, code: 'downloaded', version: '1.2.3' };
            u._evaluateIdleInstall();
            u._evaluateIdleInstall();
            ctx.expect(promptCalls).toBe(1);

            // Newer download — version flips. _promptedForVersion still 1.2.3, so 1.2.4 should re-prompt.
            u._state = { ...u._state, code: 'downloaded', version: '1.2.4' };
            u._evaluateIdleInstall();
            ctx.expect(promptCalls).toBe(2);
            ctx.expect(u._promptedForVersion).toBe('1.2.4');
          } finally { u._isSimulating = origIsSimulating; }
        } finally { u._promptToInstall = origPrompt; }
      },
    },
    {
      name: 'idle-install: skipped entirely when state !== downloaded',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        const origInstall = u.installNow;
        const origPrompt  = u._promptToInstall;
        let installCalled = false;
        let promptCalls   = 0;
        u.installNow = async () => { installCalled = true; return true; };
        u._promptToInstall = async () => { promptCalls++; };
        try {
          for (const code of ['idle', 'checking', 'available', 'downloading', 'not-available', 'error']) {
            u._state = { ...u._state, code, version: '1.2.3' };
            u._userInitiated = false;
            u._lastActivityAt = Date.now() - (16 * 60 * 1000);   // idle, but state isn't downloaded
            const origIsSimulating = u._isSimulating;
            u._isSimulating = () => false;
            try { u._evaluateIdleInstall(); } finally { u._isSimulating = origIsSimulating; }
          }
          ctx.expect(installCalled).toBe(false);
          ctx.expect(promptCalls).toBe(0);
        } finally {
          u.installNow = origInstall;
          u._promptToInstall = origPrompt;
        }
      },
    },
    {
      name: 'idle-install: skipped when _userInitiated=true (consumer UI owns the path)',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        const origInstall = u.installNow;
        const origPrompt  = u._promptToInstall;
        let installCalled = false;
        let promptCalls   = 0;
        u.installNow = async () => { installCalled = true; return true; };
        u._promptToInstall = async () => { promptCalls++; };
        try {
          u._state = { ...u._state, code: 'downloaded', version: '1.2.3' };
          u._userInitiated = true;
          u._promptedForVersion = null;
          u._lastActivityAt = Date.now() - (16 * 60 * 1000);   // idle
          const origIsSimulating = u._isSimulating;
          u._isSimulating = () => false;
          try { u._evaluateIdleInstall(); } finally { u._isSimulating = origIsSimulating; }
          ctx.expect(installCalled).toBe(false);
          ctx.expect(promptCalls).toBe(0);
        } finally {
          u.installNow = origInstall;
          u._promptToInstall = origPrompt;
        }
      },
    },
    {
      name: 'idle-install: dev mode bails out (no install, no prompt)',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        const origInstall = u.installNow;
        const origPrompt  = u._promptToInstall;
        let installCalled = false;
        let promptCalls   = 0;
        u.installNow = async () => { installCalled = true; return true; };
        u._promptToInstall = async () => { promptCalls++; };
        try {
          u._state = { ...u._state, code: 'downloaded', version: '1.2.3' };
          u._userInitiated = false;
          u._lastActivityAt = Date.now() - (16 * 60 * 1000);
          const origIsSimulating = u._isSimulating;
          u._isSimulating = () => true;   // simulate OMEGA_DEV_UPDATE set
          try { u._evaluateIdleInstall(); } finally { u._isSimulating = origIsSimulating; }
          ctx.expect(installCalled).toBe(false);
          ctx.expect(promptCalls).toBe(0);
        } finally {
          u.installNow = origInstall;
          u._promptToInstall = origPrompt;
        }
      },
    },

    // ─── checkNow() concurrency / dedup ──────────────────────────────────────────

    {
      name: 'checkNow: dedupes — second call while state=checking returns without re-checking',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        // Stub the underlying library so we can count calls.
        const origLib = u._library;
        let checkCalls = 0;
        u._library = {
          checkForUpdates: async () => { checkCalls++; },
          quitAndInstall: () => {},
          autoDownload: true,
          on: () => {},
        };
        try {
          // Force state to "checking" — _readyToCheck() should refuse new checks.
          u._state = { ...u._state, code: 'checking' };
          await u.checkNow({ userInitiated: false });
          await u.checkNow({ userInitiated: false });
          await u.checkNow({ userInitiated: false });
          ctx.expect(checkCalls).toBe(0);
        } finally { u._library = origLib; }
      },
    },
    {
      name: 'checkNow: dedupes from each non-ready state (downloading, available, downloaded)',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        const origLib = u._library;
        let checkCalls = 0;
        u._library = {
          checkForUpdates: async () => { checkCalls++; },
          quitAndInstall: () => {},
          autoDownload: true,
          on: () => {},
        };
        try {
          for (const code of ['available', 'downloading', 'downloaded']) {
            u._state = { ...u._state, code };
            await u.checkNow({ userInitiated: false });
          }
          ctx.expect(checkCalls).toBe(0);
        } finally { u._library = origLib; }
      },
    },
    {
      name: 'checkNow: _userInitiated does NOT leak when state is non-ready (1.2.39 fix)',
      run: async (ctx) => {
        // Repro: background periodic check sets _userInitiated=false and starts downloading.
        // User clicks "Check for Updates" — IPC invokes checkNow({userInitiated: true}).
        // Pre-fix: that flipped _userInitiated to true even though the second check was
        // skipped, breaking idle-install when the download completes.
        const u = ctx.manager.autoUpdater;
        u._state = { ...u._state, code: 'downloading' };   // mid-flight
        u._userInitiated = false;                          // initial periodic check

        await u.checkNow({ userInitiated: true });          // user clicks — should be ignored

        ctx.expect(u._userInitiated).toBe(false);          // still false — leak prevented
      },
    },
    {
      name: 'checkNow: _userInitiated DOES flip when the call actually performs a check',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        const origLib = u._library;
        u._library = {
          checkForUpdates: async () => {},   // no-op so the test runs synchronously
          quitAndInstall: () => {},
          autoDownload: true,
          on: () => {},
        };
        try {
          u._state = { ...u._state, code: 'idle' };
          u._userInitiated = false;
          await u.checkNow({ userInitiated: true });
          ctx.expect(u._userInitiated).toBe(true);
        } finally { u._library = origLib; }
      },
    },
    {
      name: 'checkNow: lastCheckedAt updates even when call is deduped',
      run: async (ctx) => {
        // Behavior contract: the timestamp tracks "we considered checking at this moment,"
        // not "we successfully checked." A user click that hits the dedup guard still updates
        // the timestamp so UI surfaces show fresh "checked just now" feedback.
        const u = ctx.manager.autoUpdater;
        u._state = { ...u._state, code: 'checking', lastCheckedAt: 0 };
        const before = Date.now();
        await u.checkNow({ userInitiated: true });
        const after = Date.now();
        ctx.expect(u._state.lastCheckedAt >= before).toBe(true);
        ctx.expect(u._state.lastCheckedAt <= after).toBe(true);
      },
    },

    // ─── Two-timer separation ────────────────────────────────────────────────────
    //
    // Feed-check (HTTP, expensive, hourly) and idle-eval (in-process, cheap, every
    // minute) MUST stay separate timers — running the feed-check at idle-eval cadence
    // hammers the GitHub release feed at 60× the necessary rate.

    {
      name: 'feed-check tick: hits the library + runs 30-day gate (no idle eval)',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        const origLib = u._library;
        const origGate = u._enforceMaxAgeGate;
        const origIdle = u._evaluateIdleInstall;
        const calls = [];
        u._library = {
          checkForUpdates: async () => { calls.push('check'); },
          quitAndInstall: () => {},
          autoDownload: true,
          on: () => {},
        };
        u._enforceMaxAgeGate    = () => { calls.push('gate'); return false; };
        u._evaluateIdleInstall  = () => { calls.push('idle'); };
        try {
          u._state = { ...u._state, code: 'idle' };
          await u._feedCheckTick();
          ctx.expect(calls).toEqual(['check', 'gate']);
        } finally {
          u._library = origLib;
          u._enforceMaxAgeGate = origGate;
          u._evaluateIdleInstall = origIdle;
        }
      },
    },
    {
      name: 'idle-eval tick: only runs idle eval (no HTTP, no gate)',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        const origLib = u._library;
        const origGate = u._enforceMaxAgeGate;
        const origIdle = u._evaluateIdleInstall;
        const calls = [];
        u._library = {
          checkForUpdates: async () => { calls.push('check'); },
          quitAndInstall: () => {},
          autoDownload: true,
          on: () => {},
        };
        u._enforceMaxAgeGate    = () => { calls.push('gate'); return false; };
        u._evaluateIdleInstall  = () => { calls.push('idle'); };
        try {
          u._idleEvalTick();
          ctx.expect(calls).toEqual(['idle']);
        } finally {
          u._library = origLib;
          u._enforceMaxAgeGate = origGate;
          u._evaluateIdleInstall = origIdle;
        }
      },
    },
    {
      name: 'feed-check default cadence is 1h (production), not 1m',
      run: (ctx) => {
        const u = ctx.manager.autoUpdater;
        // Sanity-guard: if someone re-merges the timers or drops the cadence to
        // 60s again, this test fails. Production builds must not hammer the feed.
        ctx.expect(u._options.feedCheckIntervalMs).toBe(60 * 60 * 1000);
        ctx.expect(u._options.idleEvalIntervalMs).toBe(1 * 60 * 1000);
      },
    },
    {
      name: 'full update sequence: download → idle wait → auto-install fires',
      run: async (ctx) => {
        // The whole point of the new system: drive a real update through the dev simulator,
        // then exercise the post-download decision path with stubbed installNow.
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: 'available' });
        const u = ctx.manager.autoUpdater;
        const origInstall = u.installNow;
        const origIsSimulating = u._isSimulating;
        let installCalled = false;
        u.installNow = async () => { installCalled = true; return true; };
        try {
          await u.checkNow({ userInitiated: false });
          await waitFor(() => u.getStatus().code === 'downloaded', { timeout: 5000 });

          // Now at "downloaded". Force user-idle past threshold + take dev-mode out of the picture.
          u._lastActivityAt = Date.now() - (16 * 60 * 1000);
          u._isSimulating = () => false;
          // Run the same evaluation the periodic tick would.
          u._evaluateIdleInstall();
          ctx.expect(installCalled).toBe(true);
        } finally {
          u.installNow = origInstall;
          u._isSimulating = origIsSimulating;
          await restore();
        }
      },
    },
    {
      name: 'full update sequence: download → user-active → prompt fires (no install)',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: 'available' });
        const u = ctx.manager.autoUpdater;
        const origInstall = u.installNow;
        const origPrompt  = u._promptToInstall;
        const origIsSimulating = u._isSimulating;
        let installCalled = false;
        let promptedVersion = null;
        u.installNow = async () => { installCalled = true; return true; };
        u._promptToInstall = async (v) => { promptedVersion = v; };
        try {
          await u.checkNow({ userInitiated: false });
          await waitFor(() => u.getStatus().code === 'downloaded', { timeout: 5000 });

          u._lastActivityAt = Date.now();   // active
          u._isSimulating = () => false;
          u._evaluateIdleInstall();

          ctx.expect(installCalled).toBe(false);
          ctx.expect(promptedVersion).toBe('999.0.0');
          ctx.expect(u._promptedForVersion).toBe('999.0.0');
        } finally {
          u.installNow = origInstall;
          u._promptToInstall = origPrompt;
          u._isSimulating = origIsSimulating;
          await restore();
        }
      },
    },

    // ─── Real-time integration test (drives the actual periodic tick) ───────────
    //
    // Where the unit tests above fake the clock + poke `_evaluateIdleInstall` directly,
    // this one drives a REAL update through the dev simulator AND lets the actual
    // periodic tick fire on its own. With `manager.isTesting() === true`, the tick
    // cadence drops to IDLE_TICK_MS_TESTING (500ms) and the idle threshold drops to
    // IDLE_INSTALL_THRESHOLD_MS_TESTING (3s) — so the full sequence completes inside
    // ~5s instead of ~15min.
    //
    // We stub `installNow` so the test process doesn't actually quit, and lift the
    // dev-mode bail in `_evaluateIdleInstall` so the simulated download exercises the
    // real install decision path.

    {
      name: 'real-time end-to-end: download fires, threshold elapses, install triggers via periodic tick',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: 'available' });
        const u = ctx.manager.autoUpdater;
        const origInstall   = u.installNow;
        const origIsSimulating = u._isSimulating;
        let installCalled = false;
        u.installNow  = async () => { installCalled = true; return true; };
        u._isSimulating  = () => false;   // pretend we're in production so the eval runs
        try {
          // Drive the dev simulator to "downloaded".
          await u.checkNow({ userInitiated: false });
          await waitFor(() => u.getStatus().code === 'downloaded', { timeout: 5000 });

          // Mark idle — _lastActivityAt was bumped by checkNow paths, push it back
          // past the testing threshold (3s + small margin).
          u._lastActivityAt = Date.now() - 4000;

          // Wait for the real periodic tick (500ms cadence in tests) to fire and
          // call our stubbed installNow. Bound at 3s to keep the test fast.
          await waitFor(() => installCalled, { timeout: 3000 });
          ctx.expect(installCalled).toBe(true);
        } finally {
          u.installNow  = origInstall;
          u._isSimulating  = origIsSimulating;
          await restore();
        }
      },
    },
    {
      name: 'real-time end-to-end: download fires while user-active → prompt fires, install does NOT',
      run: async (ctx) => {
        const restore = await reinit(ctx, { OMEGA_DEV_UPDATE: 'available' });
        const u = ctx.manager.autoUpdater;
        const origInstall   = u.installNow;
        const origPrompt    = u._promptToInstall;
        const origIsSimulating = u._isSimulating;
        let installCalled = false;
        let promptedVersion = null;
        u.installNow  = async () => { installCalled = true; return true; };
        u._promptToInstall = async (v) => { promptedVersion = v; };
        u._isSimulating  = () => false;
        // Keep "the user" active throughout — the dev simulator takes ~2s to download
        // (4 × 400ms ticks), and we want the activity timer to stay <3s old at all times.
        // Bump every 500ms; the 3s threshold can never elapse if we keep doing this.
        const keepActive = setInterval(() => u.markActive(), 500);
        try {
          await u.checkNow({ userInitiated: false });
          await waitFor(() => u.getStatus().code === 'downloaded', { timeout: 5000 });

          // Bump once explicitly the moment download lands — guarantees fresh activity
          // when the next periodic tick (500ms) evaluates.
          u.markActive();

          // Wait for the prompt to fire. The first periodic tick after download lands
          // sees "active + state=downloaded" → calls _promptToInstall.
          await waitFor(() => promptedVersion !== null, { timeout: 2500 });

          ctx.expect(promptedVersion).toBe('999.0.0');
          ctx.expect(installCalled).toBe(false);
          ctx.expect(u._promptedForVersion).toBe('999.0.0');
        } finally {
          clearInterval(keepActive);
          u.installNow  = origInstall;
          u._promptToInstall = origPrompt;
          u._isSimulating  = origIsSimulating;
          await restore();
        }
      },
    },

    // ─── Mode helpers (@omega.js/backend-pattern: isDevelopment / isProduction / isTesting) ────

    {
      name: 'manager.isTesting() returns true under OMEGA_TEST_MODE (set by test runner)',
      run: (ctx) => {
        ctx.expect(typeof ctx.manager.isTesting).toBe('function');
        ctx.expect(ctx.manager.isTesting()).toBe(true);
      },
    },
    {
      name: 'manager.isDevelopment() is false during tests (testing takes precedence)',
      run: (ctx) => {
        // The test runs unpackaged, but OMEGA_TEST_MODE=true → testing wins, so this is a
        // TEST environment, not development. isDevelopment() is therefore false.
        ctx.expect(typeof ctx.manager.isDevelopment).toBe('function');
        ctx.expect(ctx.manager.isDevelopment()).toBe(false);
        ctx.expect(ctx.manager.isTesting()).toBe(true);
      },
    },
    {
      name: 'manager environments are mutually exclusive (exactly one true)',
      run: (ctx) => {
        const flags = [ctx.manager.isDevelopment(), ctx.manager.isTesting(), ctx.manager.isProduction()];
        ctx.expect(flags.filter(Boolean).length).toBe(1);
        ctx.expect(ctx.manager.isProduction()).toBe(false);
      },
    },
    {
      name: 'auto-updater._idleThresholdMs() returns 3s in tests, 15min in prod',
      run: (ctx) => {
        const u = ctx.manager.autoUpdater;
        // Test mode currently active (manager.isTesting() === true).
        ctx.expect(u._idleThresholdMs()).toBe(3000);

        // Stub manager.isTesting() to simulate prod and verify the threshold flips.
        const origIsTesting = ctx.manager.isTesting;
        ctx.manager.isTesting = () => false;
        try {
          ctx.expect(u._idleThresholdMs()).toBe(15 * 60 * 1000);
        } finally { ctx.manager.isTesting = origIsTesting; }
      },
    },

    // ─── Misc internals ──────────────────────────────────────────────────────────

    {
      name: 'shutdown clears pending timers + interval + idle-install state',
      run: async (ctx) => {
        const restore = await reinit(ctx, {});
        const u = ctx.manager.autoUpdater;
        try {
          u._pendingTimers.push(setTimeout(() => {}, 1000000));
          u._promptedForVersion = '1.2.3';
          u.shutdown();
          ctx.expect(u._feedCheckIntervalId).toBe(null);
          ctx.expect(u._idleEvalIntervalId).toBe(null);
          ctx.expect(u._pendingTimers).toEqual([]);
          ctx.expect(u._initialized).toBe(false);
          ctx.expect(u._library).toBe(null);
          ctx.expect(u._userInitiated).toBe(false);
          ctx.expect(u._promptedForVersion).toBe(null);
          ctx.expect(u._activityHooksWired).toBe(false);
        } finally { await restore(); }
      },
    },
    {
      name: '_menuItemFieldsForState produces correct label per state',
      run: (ctx) => {
        const u = ctx.manager.autoUpdater;
        const cases = [
          ['idle',          'Check for Updates...',                                 true],
          ['error',         'Check for Updates...',                                 true],
          ['not-available', "You're up to date",                                    true],
          ['checking',      'Checking for Updates...',                              false],
        ];
        for (const [code, label, enabled] of cases) {
          u._state = { ...u._state, code, version: null, percent: 0 };
          const r = u._menuItemFieldsForState();
          ctx.expect(r.label).toBe(label);
          ctx.expect(r.enabled).toBe(enabled);
        }
        // version-bearing states
        u._state = { ...u._state, code: 'available', version: '2.0.0' };
        ctx.expect(u._menuItemFieldsForState().label).toBe('Downloading Update v2.0.0...');
        ctx.expect(u._menuItemFieldsForState().enabled).toBe(false);

        u._state = { ...u._state, code: 'downloaded', version: '2.0.0' };
        ctx.expect(u._menuItemFieldsForState().label).toBe('Restart to Update v2.0.0');
        ctx.expect(u._menuItemFieldsForState().enabled).toBe(true);

        u._state = { ...u._state, code: 'downloading', percent: 42 };
        ctx.expect(u._menuItemFieldsForState().label).toBe('Downloading Update (42%)');
        ctx.expect(u._menuItemFieldsForState().enabled).toBe(false);
      },
    },
    {
      name: 'IPC: desktop:auto-updater:check-now invokes checkNow with userInitiated=true',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        const origCheck = u.checkNow;
        let receivedOpts = null;
        u.checkNow = async (opts) => { receivedOpts = opts; return u.getStatus(); };
        try {
          await ctx.manager.ipc.invoke('desktop:auto-updater:check-now');
          ctx.expect(receivedOpts).toBeDefined();
          ctx.expect(receivedOpts.userInitiated).toBe(true);
        } finally { u.checkNow = origCheck; }
      },
    },
    {
      name: 'IPC: desktop:auto-updater:install-now invokes installNow',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        const origInstall = u.installNow;
        let installCalled = false;
        u.installNow = async () => { installCalled = true; return false; };
        try {
          await ctx.manager.ipc.invoke('desktop:auto-updater:install-now');
          ctx.expect(installCalled).toBe(true);
        } finally { u.installNow = origInstall; }
      },
    },
    {
      name: 'installNow: returns false when state is not "downloaded"',
      run: async (ctx) => {
        const u = ctx.manager.autoUpdater;
        u._state = { ...u._state, code: 'idle' };
        const r = await u.installNow();
        ctx.expect(r).toBe(false);
      },
    },
  ],
});
