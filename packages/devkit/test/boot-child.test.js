// Unit tests for src/test/boot-child.js — the e2e lanes' child boot/stop.
//
// Real execution only: every case spawns a REAL node child that prints real
// lines on real pipes, because everything this module owns (marker matching
// across chunk boundaries, the log tee, early exit, the group stop) only
// exists at that boundary. A stubbed spawn would prove none of it.

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const { startChild, stopChild } = require('../src/test/boot-child.js');

function scratch() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'boot-child-')));
}

/** A child that prints `lines` (each after `delay` ms) and then runs forever. */
function foreverScript(lines, delay = 30) {
  return `${lines.map((line, index) => `setTimeout(() => process.stdout.write(${JSON.stringify(`${line}\n`)}), ${delay * (index + 1)});`).join('')}setInterval(() => {}, 1000);`;
}

module.exports = defineCases({
  type: 'group',
  description: 'boot-child',
  tests: [
    {
      name: 'startChild resolves the marker capture group and tees the output to its log',
      run: async (ctx) => {
        const dir = scratch();
        const logFile = path.join(dir, 'logs', 'dev.log');

        const { child, ready } = startChild({
          bin: process.execPath,
          args: ['-e', foreverScript(['booting the fixture', 'Dev server: http://localhost:41234'])],
          cwd: dir,
          logFile,
          marker: /Dev server: (https?:\/\/localhost:\d+)/,
          timeout: 20000,
          relativeTo: dir,
        });

        try {
          ctx.expect(await ready).toBe('http://localhost:41234');
          const contents = fs.readFileSync(logFile, 'utf8');
          ctx.expect(contents, 'the pre-marker output landed in the log too').toMatch(/booting the fixture/);
          ctx.expect(contents).toMatch(/Dev server: http:\/\/localhost:41234/);
        } finally {
          await stopChild(child);
        }
      },
    },

    {
      name: 'a child booted inside a brand target runs on the caller\'s env as given, with no marker added',
      run: async (ctx) => {
        const brandRoot = scratch();
        const targetDir = path.join(brandRoot, 'targets', 'backend');
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(brandRoot, 'package.json'), '{"name":"acme","workspaces":["targets/*"]}');
        fs.writeFileSync(path.join(targetDir, 'package.json'), '{"name":"acme-backend"}');

        const { child, ready } = startChild({
          bin: process.execPath,
          args: ['-e', "process.stdout.write('env=' + process.env.LANE_WORD + ':' + process.env.OMEGA_ROOT_DISPATCH + '\\n'); setInterval(() => {}, 1000);"],
          cwd: targetDir,
          env: { PATH: process.env.PATH, LANE_WORD: 'kept' },
          logFile: path.join(brandRoot, 'child.log'),
          marker: /env=(\S+)/,
          timeout: 20000,
        });
        try {
          ctx.expect(await ready).toBe('kept:undefined');
        } finally {
          await stopChild(child);
        }
      },
    },

    {
      name: 'a marker with no capture group resolves null',
      run: async (ctx) => {
        const dir = scratch();
        const { child, ready } = startChild({
          bin: process.execPath,
          args: ['-e', foreverScript(['Emulator ready. Press Ctrl+C to exit'])],
          cwd: dir,
          logFile: path.join(dir, 'emulator.log'),
          marker: /Emulator ready\. Press Ctrl\+C/i,
          timeout: 20000,
        });

        try {
          ctx.expect(await ready).toBe(null);
        } finally {
          await stopChild(child);
        }
      },
    },

    {
      name: 'a marker split across two reads still matches (the buffer, not the chunk)',
      run: async (ctx) => {
        const dir = scratch();
        // Two writes, no newline between them: the marker only exists across both.
        const script = 'process.stdout.write("Dev server: http://loc");'
          + 'setTimeout(() => process.stdout.write("alhost:41235\\n"), 80);'
          + 'setInterval(() => {}, 1000);';

        const { child, ready } = startChild({
          bin: process.execPath,
          args: ['-e', script],
          cwd: dir,
          logFile: path.join(dir, 'dev.log'),
          marker: /Dev server: (https?:\/\/localhost:\d+)/,
          timeout: 20000,
        });

        try {
          ctx.expect(await ready).toBe('http://localhost:41235');
        } finally {
          await stopChild(child);
        }
      },
    },

    {
      name: 'a child that dies before its marker rejects with the code and the log path',
      run: async (ctx) => {
        const dir = scratch();
        const logFile = path.join(dir, 'emulator.log');

        const { ready } = startChild({
          bin: process.execPath,
          args: ['-e', 'process.stdout.write("port 8080 is taken\\n"); process.exit(3);'],
          cwd: dir,
          logFile,
          marker: /never printed/,
          timeout: 20000,
          relativeTo: dir,
        });

        await ctx.expect((() => ready)()).rejects.toThrow(/exited early \(code 3, log: emulator\.log\)/);
        ctx.expect(fs.readFileSync(logFile, 'utf8'), 'the reason is on disk, not only in the rejection').toMatch(/port 8080 is taken/);
      },
    },

    {
      name: 'a grandchild holding the pipes open does not stall the early-exit rejection',
      run: async (ctx) => {
        const dir = scratch();
        const logFile = path.join(dir, 'emulator.log');
        // The emulator shape: the child spawns a longer-lived process that
        // inherits its stdout, then dies. Its pipes reach no EOF until the
        // grandchild ends, so the rejection is bounded by the drain grace instead.
        const script = `process.stdout.write("port 8080 is taken\\n");`
          + `require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { stdio: 'inherit' }).unref();`
          + `process.exit(3);`;

        const started = Date.now();
        const { ready } = startChild({
          bin: process.execPath,
          args: ['-e', script],
          cwd: dir,
          logFile,
          marker: /never printed/,
          timeout: 20000,
          relativeTo: dir,
        });

        await ctx.expect((() => ready)()).rejects.toThrow(/exited early \(code 3, log: emulator\.log\)/);
        ctx.expect(Date.now() - started < 3000, 'the rejection came within the drain grace, not after the grandchild').toBeTruthy();
        ctx.expect(fs.readFileSync(logFile, 'utf8')).toMatch(/port 8080 is taken/);
      },
    },

    {
      name: 'a child that never prints its marker rejects on the timeout',
      run: async (ctx) => {
        const dir = scratch();
        const { child, ready } = startChild({
          bin: process.execPath,
          args: ['-e', foreverScript(['still warming up'])],
          cwd: dir,
          logFile: path.join(dir, 'dev.log'),
          marker: /Dev server: (\S+)/,
          timeout: 300,
          relativeTo: dir,
        });

        try {
          await ctx.expect((() => ready)()).rejects.toThrow(/not ready after 0\.3s \(log: dev\.log\)/);
        } finally {
          await stopChild(child);
        }
      },
    },

    {
      name: 'stopChild ends the whole process group, and the child releases what it held',
      run: async (ctx) => {
        const dir = scratch();
        // A child holding a port is the real case: an emulator whose port stays
        // bound is an emulator the next lane cannot boot.
        const port = 46031;
        const script = `const net = require('net');`
          + `net.createServer().listen(${port}, '127.0.0.1', () => process.stdout.write('holding\\n'));`;

        const { child, ready } = startChild({
          bin: process.execPath,
          args: ['-e', script],
          cwd: dir,
          logFile: path.join(dir, 'held.log'),
          marker: /(holding)/,
          timeout: 20000,
        });

        await ready;
        await stopChild(child);

        ctx.expect(child.exitCode === null && child.signalCode === null, 'the child is gone').not.toBe(true);
        await new Promise((resolve, reject) => {
          const server = net.createServer();
          server.once('error', reject);
          server.listen(port, '127.0.0.1', () => server.close(resolve));
        });
      },
    },

    {
      name: 'stopChild on an already-exited child is a no-op',
      run: async (ctx) => {
        const dir = scratch();
        const { child, ready } = startChild({
          bin: process.execPath,
          args: ['-e', 'process.exit(0);'],
          cwd: dir,
          logFile: path.join(dir, 'gone.log'),
          marker: /never/,
          timeout: 20000,
        });

        await ctx.expect((() => ready)()).rejects.toThrow();
        await stopChild(child);
        await stopChild(child);
      },
    },
  ],
});
