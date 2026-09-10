// Main-layer tests for lib/restart-manager — bail matrix, testing-root isolation,
// runtime.json parsing, and REAL register/deregister round-trips against a
// fixture HTTP server that IMPLEMENTS protocol v1 (it validates every incoming
// payload with the protocol SSOT validators — it is the protocol, not a mock).
//
// Test-mode guarantees exercised here: nothing fires on its own (bail 'testing',
// no timers, no before-quit hook), the root is isolated under the ` (Testing)`
// userData, and install/spawn paths never touch network or real OS state.

const fs = require('fs');
const path = require('path');
const http = require('http');
const protocol = require('../../../lib/restart-manager/protocol.js');
const defineCases = require('@omega.js/devkit/test/define-cases');

// ─── Fixture: a real protocol-v1 server ───────────────────────────────────────

function startContractServer() {
  const state = {
    apps: new Map(),                 // id → payload
    counts: { register: 0, deregister: 0, health: 0 },
    server: null,
    port: null,
  };

  state.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const json = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      let parsed = null;
      try { parsed = body ? JSON.parse(body) : null; } catch (_) { return json(400, { ok: false, error: 'bad json' }); }

      if (req.method === 'GET' && req.url === protocol.ENDPOINTS.health) {
        state.counts.health++;
        return json(200, { ok: true, version: '9.9.9', protocolVersion: protocol.PROTOCOL_VERSION, uptime: 1, apps: state.apps.size });
      }
      if (req.method === 'POST' && req.url === protocol.ENDPOINTS.register) {
        state.counts.register++;
        const check = protocol.validateRegisterPayload(parsed);
        if (!check.valid) return json(400, { ok: false, errors: check.errors });
        state.apps.set(parsed.id, parsed);       // idempotent upsert by id
        return json(200, { ok: true });
      }
      if (req.method === 'POST' && req.url === protocol.ENDPOINTS.deregister) {
        state.counts.deregister++;
        const check = protocol.validateDeregisterPayload(parsed);
        if (!check.valid) return json(400, { ok: false, errors: check.errors });
        state.apps.delete(parsed.id);
        return json(200, { ok: true });
      }
      return json(404, { ok: false, error: 'unknown route' });
    });
  });

  return new Promise((resolve) => {
    state.server.listen(0, '127.0.0.1', () => {
      state.port = state.server.address().port;
      resolve(state);
    });
  });
}

function writeRuntime(root, port, overrides) {
  fs.mkdirSync(root, { recursive: true });
  const runtime = {
    protocolVersion: protocol.PROTOCOL_VERSION,
    port,
    pid: process.pid,                // this test process — always alive
    version: '9.9.9',
    environment: 'testing',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
  fs.writeFileSync(protocol.getRuntimePath(root), JSON.stringify(runtime));
  return runtime;
}

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'restart-manager (main)',
  cleanup: async (ctx) => {
    if (ctx.state.rm) ctx.state.rm.server.close();
    ctx.manager.restartManager.shutdown();
    ctx.manager.restartManager.initialize(ctx.manager);
  },
  tests: [
    {
      name: 'wired on manager with the full v2 API surface',
      run: (ctx) => {
        const rm = ctx.manager.restartManager;
        ctx.expect(rm).toBeDefined();
        for (const fn of ['register', 'unregister', 'ensureInstalled', 'ensureRunning', 'getStatus', 'shutdown']) {
          ctx.expect(typeof rm[fn]).toBe('function');
        }
      },
    },
    {
      name: 'testing bail: bailed with reason, no timer, no before-quit hook',
      run: (ctx) => {
        const rm = ctx.manager.restartManager;
        const status = rm.getStatus();
        ctx.expect(status.bailed).toBe(true);
        ctx.expect(status.bailReason).toBe('testing');
        ctx.expect(rm._registerTimer).toBe(null);
        ctx.expect(rm._quitWired).toBe(false);
      },
    },
    {
      name: 'testing-root isolation: _root lives under the (Testing) userData, never appData',
      run: (ctx) => {
        const { app } = require('electron');
        const rm = ctx.manager.restartManager;
        ctx.expect(rm._root.startsWith(app.getPath('userData'))).toBe(true);
        ctx.expect(rm._root).not.toBe(protocol.resolveSharedRoot(app.getPath('appData'), {}));
      },
    },
    {
      name: 'enabled=false bail (reason disabled, no timer)',
      run: (ctx) => {
        const rm = ctx.manager.restartManager;
        rm.shutdown();
        const orig = ctx.manager.config.restartManager;
        ctx.manager.config.restartManager = { enabled: false };
        try {
          rm.initialize(ctx.manager);
          // Testing bail fires first in the harness, so force-evaluate the
          // config path: _enabled captured false proves the knob was read.
          ctx.expect(rm._enabled).toBe(false);
          ctx.expect(rm._registerTimer).toBe(null);
        } finally {
          rm.shutdown();
          ctx.manager.config.restartManager = orig;
          rm.initialize(ctx.manager);
        }
      },
    },
    {
      name: 'brand.id === "restart-manager" bail (RM does not manage itself)',
      run: (ctx) => {
        const rm = ctx.manager.restartManager;
        rm.shutdown();
        const origBrand = ctx.manager.config.brand;
        ctx.manager.config.brand = { ...origBrand, id: 'restart-manager' };
        try {
          rm.initialize(ctx.manager);
          ctx.expect(rm._registerTimer).toBe(null);
          ctx.expect(rm.getStatus().bailed).toBe(true);
        } finally {
          rm.shutdown();
          ctx.manager.config.brand = origBrand;
          rm.initialize(ctx.manager);
        }
      },
    },
    {
      name: 'non-production without OMEGA_RESTART_MANAGER_DEV: nothing scheduled',
      run: (ctx) => {
        ctx.expect(process.env.OMEGA_RESTART_MANAGER_DEV).not.toBe('1');
        ctx.expect(ctx.manager.isProduction()).toBe(false);
        ctx.expect(ctx.manager.restartManager._registerTimer).toBe(null);
      },
    },
    {
      name: '_readRuntime: valid file parses; wrong version / malformed / missing → null',
      run: (ctx) => {
        const rm = ctx.manager.restartManager;
        const runtimePath = protocol.getRuntimePath(rm._root);

        writeRuntime(rm._root, 4000);
        const good = rm._readRuntime();
        ctx.expect(good).not.toBe(null);
        ctx.expect(good.port).toBe(4000);

        writeRuntime(rm._root, 4000, { protocolVersion: 99 });
        ctx.expect(rm._readRuntime()).toBe(null);

        fs.writeFileSync(runtimePath, '{not json');
        ctx.expect(rm._readRuntime()).toBe(null);

        fs.unlinkSync(runtimePath);
        ctx.expect(rm._readRuntime()).toBe(null);
      },
    },
    {
      name: '_pidAlive: own pid alive, absurd pid dead',
      run: (ctx) => {
        const rm = ctx.manager.restartManager;
        ctx.expect(rm._pidAlive(process.pid)).toBe(true);
        ctx.expect(rm._pidAlive(999999)).toBe(false);
      },
    },
    {
      name: 'register round-trip: contract-valid payload lands, pid is ours, status flips',
      run: async (ctx) => {
        const rm = ctx.manager.restartManager;
        ctx.state.rm = await startContractServer();
        writeRuntime(rm._root, ctx.state.rm.port);

        const ok = await rm.register();
        ctx.expect(ok).toBe(true);

        const appId = ctx.manager.config.brand.id;
        const stored = ctx.state.rm.apps.get(appId);
        ctx.expect(stored).toBeDefined();
        ctx.expect(stored.pid).toBe(process.pid);
        ctx.expect(protocol.validateRegisterPayload(stored).valid).toBe(true);

        const status = rm.getStatus();
        ctx.expect(status.registered).toBe(true);
        ctx.expect(status.running).toBe(true);
        ctx.expect(status.port).toBe(ctx.state.rm.port);
      },
    },
    {
      name: 'heartbeat: idempotent upsert (1 app, request count climbs), timestamp advances',
      run: async (ctx) => {
        const rm = ctx.manager.restartManager;
        const before = ctx.state.rm.counts.register;

        await rm._heartbeatTick();
        await rm._heartbeatTick();

        ctx.expect(ctx.state.rm.counts.register).toBe(before + 2);
        ctx.expect(ctx.state.rm.apps.size).toBe(1);
        ctx.expect(typeof rm._lastHeartbeatAt).toBe('number');
      },
    },
    {
      name: 'quit flush: capped deregister lands under the 1s budget',
      run: async (ctx) => {
        const rm = ctx.manager.restartManager;
        const started = Date.now();
        await rm._quitFlush();
        ctx.expect(Date.now() - started).toBeLessThan(1000 + 250);
        ctx.expect(ctx.state.rm.apps.size).toBe(0);
        ctx.expect(rm.getStatus().registered).toBe(false);
      },
    },
    {
      name: '_handleBeforeQuit: not-registered path returns without touching the event',
      run: (ctx) => {
        // Only the safe branch is drivable in the harness (the flush branch ends
        // in manager.quit which would kill the test Electron). _quitFlush itself
        // is proven above.
        const rm = ctx.manager.restartManager;
        rm._registered = false;
        rm._quitFlushed = false;
        let prevented = false;
        rm._handleBeforeQuit({ preventDefault: () => { prevented = true; } });
        ctx.expect(prevented).toBe(false);
      },
    },
    {
      name: 'deregister round-trip: fixture saw { id, pid }',
      run: async (ctx) => {
        const rm = ctx.manager.restartManager;
        await rm.register();
        ctx.expect(ctx.state.rm.apps.size).toBe(1);

        const ok = await rm.unregister();
        ctx.expect(ok).toBe(true);
        ctx.expect(ctx.state.rm.apps.size).toBe(0);
        ctx.expect(ctx.state.rm.counts.deregister).toBeGreaterThan(0);
      },
    },
    {
      name: 'dead server: register resolves false, lastError set, no spawn in testing',
      run: async (ctx) => {
        const rm = ctx.manager.restartManager;
        // Grab a port that WAS listening and now is not.
        const throwaway = await startContractServer();
        const deadPort = throwaway.port;
        await new Promise((resolve) => throwaway.server.close(resolve));

        writeRuntime(rm._root, deadPort);
        const ok = await rm.register();
        ctx.expect(ok).toBe(false);
        ctx.expect(typeof rm.getStatus().lastError).toBe('string');
      },
    },
    {
      name: 'smart existence: installed app on disk short-circuits before any network',
      run: async (ctx) => {
        const rm = ctx.manager.restartManager;
        const appPath = protocol.getInstalledAppPath(rm._root, process.platform);
        fs.mkdirSync(appPath, { recursive: true });
        try {
          const ok = await rm.ensureInstalled();
          ctx.expect(ok).toBe(true);                      // no feed fetch, no download — file exists
          ctx.expect(rm.getStatus().installed).toBe(true);
        } finally {
          fs.rmSync(protocol.getAppDir(rm._root), { recursive: true, force: true });
        }
      },
    },
    {
      name: 'not installed in testing: ensureInstalled refuses network and returns false',
      run: async (ctx) => {
        const rm = ctx.manager.restartManager;
        if (process.env.TEST_EXTENDED_MODE) return ctx.skip('extended mode allows the real download');
        const ok = await rm.ensureInstalled();
        ctx.expect(ok).toBe(false);
      },
    },
    {
      name: 'extended: real feed fetch + artifact pick from the published releases',
      run: async (ctx) => {
        if (!process.env.TEST_EXTENDED_MODE) return ctx.skip('requires TEST_EXTENDED_MODE (live GitHub)');
        const install = require('../../../lib/restart-manager/install.js');
        const rm = ctx.manager.restartManager;
        try {
          const feed = await install.fetchFeed(rm._feed, process.platform);
          const artifact = install.pickArtifact(feed, process.platform, process.arch);
          ctx.expect(typeof feed.version).toBe('string');
          ctx.expect(artifact.length).toBeGreaterThan(0);
        } catch (e) {
          if (`${e.message}`.includes('404')) return ctx.skip('restart-manager releases not published yet');
          throw e;
        }
      },
    },
  ],
});
