// Build-layer tests for src/utils/attach-log-file.js — the vendored shim over
// @omega.js/devkit/attach-log-file. Each test attaches, writes, detaches, then
// inspects the file. The tee's own contract (both sinks, truncation, crash
// tails, CI skip) is pinned in devkit; this suite pins that the shim the
// framework's verbs require IS that tee, through the framework's own paths.
//
// CRITICAL: these tests run INSIDE a live `npx omega test` process whose own output is being
// teed to logs/test.log by the singleton. So they must NOT touch the singleton — exercising
// attach()/detach() on it would detach the live tee mid-run and truncate logs/test.log. Each
// test uses its OWN `createTee()` instance, which stacks under the live singleton tee and
// restores it cleanly on detach.
//
// Every attach passes an explicit `env` so the tee's CI skip is never what a
// green run depends on — the suite behaves the same on a laptop and a runner.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const NO_CI = { env: {} };

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'attach-log-file — tee stdout/stderr to a file',
  tests: [
    {
      name: 'exports the expected surface',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'utils', 'attach-log-file.js'));
        ctx.expect(typeof mod).toBe('function');
        ctx.expect(typeof mod.detach).toBe('function');
        ctx.expect(typeof mod.stripAnsi).toBe('function');
        ctx.expect(typeof mod.createTee).toBe('function');
      },
    },
    {
      name: 'stripAnsi removes color escape codes',
      run: (ctx) => {
        const { stripAnsi } = require(path.join(__dirname, '..', '..', '..', 'utils', 'attach-log-file.js'));
        const colored = '\x1B[31mred\x1B[0m and \x1B[32mgreen\x1B[0m';
        ctx.expect(stripAnsi(colored)).toBe('red and green');
      },
    },
    {
      name: 'attach + stdout.write + detach: file contains the writes, ANSI stripped',
      run: (ctx) => {
        const attach = require(path.join(__dirname, '..', '..', '..', 'utils', 'attach-log-file.js'));
        // Isolated instance — stacks under the live test.log tee, never clobbers it.
        const tee = attach.createTee();
        const tmpPath = path.join(os.tmpdir(), `extension-log-${Date.now()}.log`);
        try {
          // attach() returns the DETACH function; the writes themselves are
          // synchronous fd writes, so there is nothing to flush before reading.
          const detach = tee.attach(tmpPath, NO_CI);
          process.stdout.write('hello world\n');
          process.stdout.write('\x1B[31mcolored\x1B[0m line\n');
          detach();

          const contents = fs.readFileSync(tmpPath, 'utf8');
          ctx.expect(contents).toContain('hello world');
          ctx.expect(contents).toContain('colored line');
          ctx.expect(contents).not.toContain('\x1B[');
        } finally {
          tee.detach();
          try { fs.unlinkSync(tmpPath); } catch (e) {}
        }
      },
    },
    {
      name: 'idempotent: attaching twice with the same path returns the same detach',
      run: (ctx) => {
        const attach = require(path.join(__dirname, '..', '..', '..', 'utils', 'attach-log-file.js'));
        const tee = attach.createTee();
        const tmpPath = path.join(os.tmpdir(), `extension-log-idem-${Date.now()}.log`);
        try {
          const d1 = tee.attach(tmpPath, NO_CI);
          const d2 = tee.attach(tmpPath, NO_CI);
          ctx.expect(d1).toBe(d2);
        } finally {
          tee.detach();
          try { fs.unlinkSync(tmpPath); } catch (e) {}
        }
      },
    },
    {
      name: 'attach with falsy path returns a no-op detach and patches nothing',
      run: (ctx) => {
        const attach = require(path.join(__dirname, '..', '..', '..', 'utils', 'attach-log-file.js'));
        const tee = attach.createTee();
        const priorWrite = process.stdout.write;
        ctx.expect(typeof tee.attach(null, NO_CI)).toBe('function');
        ctx.expect(typeof tee.attach('', NO_CI)).toBe('function');
        ctx.expect(process.stdout.write).toBe(priorWrite);
      },
    },
  ],
};
