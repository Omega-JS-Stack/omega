// Build-layer tests for lib/restart-manager/protocol.js — the protocol v1 SSOT
// both @omegajs/desktop and the Restart Manager app import. Pure functions, plain Node.

const path = require('path');
const protocol = require('../../../lib/restart-manager/protocol.js');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'restart-manager protocol SSOT (build)',
  tests: [
    {
      name: 'constants: PROTOCOL_VERSION=1, endpoints complete and /v1/-prefixed',
      run: (ctx) => {
        ctx.expect(protocol.PROTOCOL_VERSION).toBe(1);
        const endpoints = ['health', 'register', 'deregister', 'apps'];
        for (const key of endpoints) {
          ctx.expect(typeof protocol.ENDPOINTS[key]).toBe('string');
          ctx.expect(protocol.ENDPOINTS[key].startsWith('/v1/')).toBe(true);
        }
        // No /v1/quit — RM self-updates via @omegajs/desktop's autoUpdater; nothing external quits it.
        ctx.expect(Object.keys(protocol.ENDPOINTS).length).toBe(endpoints.length);
      },
    },
    {
      name: 'resolveSharedRoot: default under appData, EM_RM_ROOT override wins',
      run: (ctx) => {
        const def = protocol.resolveSharedRoot('/x/appData', {});
        ctx.expect(def).toBe(path.join('/x/appData', 'restart-manager'));

        const overridden = protocol.resolveSharedRoot('/x/appData', { EM_RM_ROOT: '/tmp/rm-isolated' });
        ctx.expect(overridden).toBe('/tmp/rm-isolated');
      },
    },
    {
      name: 'path derivations hang off the shared root',
      run: (ctx) => {
        const root = '/x/appData/restart-manager';
        ctx.expect(protocol.getRuntimePath(root)).toBe(path.join(root, 'runtime.json'));
        ctx.expect(protocol.getAppDir(root)).toBe(path.join(root, 'app'));
        ctx.expect(protocol.getLockPath(root)).toBe(path.join(root, 'install.lock'));
      },
    },
    {
      name: 'getInstalledAppPath: mac/linux in app/, win in LOCALAPPDATA Programs; unknown throws',
      run: (ctx) => {
        const root = '/r';
        ctx.expect(protocol.getInstalledAppPath(root, 'darwin')).toBe(path.join(root, 'app', 'Restart Manager.app'));
        ctx.expect(protocol.getInstalledAppPath(root, 'linux')).toBe(path.join(root, 'app', 'Restart-Manager.AppImage'));

        // Windows: the NSIS per-user install location (self-updatable by
        // electron-updater) — NOT the shared root.
        const win = protocol.getInstalledAppPath(root, 'win32', { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' });
        ctx.expect(win).toBe(path.join('C:\\Users\\x\\AppData\\Local', 'Programs', 'Restart Manager', 'Restart Manager.exe'));
        ctx.expect(() => protocol.getInstalledAppPath(root, 'win32', {})).toThrow();
        ctx.expect(() => protocol.getInstalledAppPath(root, 'freebsd')).toThrow();
      },
    },
    {
      name: 'validateRuntime: accepts the contract example',
      run: (ctx) => {
        const result = protocol.validateRuntime({
          protocolVersion: 1,
          port: 41234,
          pid: 4242,
          version: '1.0.0',
          environment: 'production',
          startedAt: new Date().toISOString(),
        });
        ctx.expect(result.valid).toBe(true);
        ctx.expect(result.errors.length).toBe(0);
      },
    },
    {
      name: 'validateRuntime: rejects wrong version / bad port / bad pid / non-object',
      run: (ctx) => {
        const base = { protocolVersion: 1, port: 4000, pid: 1, version: '1.0.0', environment: 'production', startedAt: 'x' };

        ctx.expect(protocol.validateRuntime({ ...base, protocolVersion: 2 }).valid).toBe(false);
        ctx.expect(protocol.validateRuntime({ ...base, port: 0 }).valid).toBe(false);
        ctx.expect(protocol.validateRuntime({ ...base, port: 70000 }).valid).toBe(false);
        ctx.expect(protocol.validateRuntime({ ...base, port: '80' }).valid).toBe(false);
        ctx.expect(protocol.validateRuntime({ ...base, pid: undefined }).valid).toBe(false);
        ctx.expect(protocol.validateRuntime(null).valid).toBe(false);
        ctx.expect(protocol.validateRuntime([]).valid).toBe(false);

        // Errors carry field names so callers can log precisely.
        const bad = protocol.validateRuntime({ ...base, port: 0, pid: -1 });
        const fields = bad.errors.map((e) => e.field);
        ctx.expect(fields).toContain('port');
        ctx.expect(fields).toContain('pid');
      },
    },
    {
      name: 'validateRegisterPayload: accepts a wire-ready payload',
      run: (ctx) => {
        const result = protocol.validateRegisterPayload({
          protocolVersion: 1,
          id: 'somiibo',
          name: 'Somiibo',
          pid: 1234,
          path: '/Applications/Somiibo.app/Contents/MacOS/Somiibo',
          version: '2.0.0',
          environment: 'production',
        });
        ctx.expect(result.valid).toBe(true);
      },
    },
    {
      name: 'validateRegisterPayload: rejects each bad field with a named error',
      run: (ctx) => {
        const good = {
          protocolVersion: 1, id: 'app', name: 'App', pid: 1,
          path: '/abs/path', version: '1.0.0', environment: 'production',
        };
        const cases = [
          [{ ...good, protocolVersion: 99 }, 'protocolVersion'],
          [{ ...good, id: '' },              'id'],
          [{ ...good, name: 7 },             'name'],
          [{ ...good, pid: 1.5 },            'pid'],
          [{ ...good, path: 'relative/x' },  'path'],
          [{ ...good, version: '' },         'version'],
          [{ ...good, environment: 'prod' }, 'environment'],
        ];
        for (const [payload, field] of cases) {
          const result = protocol.validateRegisterPayload(payload);
          ctx.expect(result.valid).toBe(false);
          ctx.expect(result.errors.map((e) => e.field)).toContain(field);
        }
      },
    },
    {
      name: 'validateDeregisterPayload: id + pid required',
      run: (ctx) => {
        ctx.expect(protocol.validateDeregisterPayload({ id: 'app', pid: 12 }).valid).toBe(true);
        ctx.expect(protocol.validateDeregisterPayload({ id: '', pid: 12 }).valid).toBe(false);
        ctx.expect(protocol.validateDeregisterPayload({ id: 'app' }).valid).toBe(false);
        ctx.expect(protocol.validateDeregisterPayload(null).valid).toBe(false);
      },
    },
    {
      name: 'buildRegisterPayload stamps protocolVersion and round-trips validation',
      run: (ctx) => {
        const payload = protocol.buildRegisterPayload({
          id: 'somiibo',
          name: 'Somiibo',
          pid: 999,
          path: '/Applications/Somiibo.app/Contents/MacOS/Somiibo',
          version: '2.0.0',
          environment: 'development',
        });
        ctx.expect(payload.protocolVersion).toBe(protocol.PROTOCOL_VERSION);
        ctx.expect(protocol.validateRegisterPayload(payload).valid).toBe(true);
      },
    },
  ],
};
