// Build-layer tests for commands/logs.js — `mgr logs` CLI surface.

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const defineCases = require('@omega.js/devkit/test/define-cases');

const MOD_PATH = path.join(__dirname, '..', '..', '..', 'commands', 'logs.js');

function freshTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-logs-cmd-'));
}

function withCwd(dir, fn) {
  const orig = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(orig);
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'logs command — `npx omega logs`',
  tests: [
    {
      name: 'module exports an async function',
      run: (ctx) => {
        const cmd = require(MOD_PATH);
        ctx.expect(typeof cmd).toBe('function');
      },
    },
    {
      name: '--path: prints the resolved path (no file contents)',
      run: async (ctx) => {
        const cmd = require(MOD_PATH);
        const tmp = freshTmp();
        try {
          let captured = '';
          const origLog = console.log;
          console.log = (...a) => { captured += a.join(' ') + '\n'; };
          try {
            await withCwd(tmp, async () => {
              await cmd({ path: true });
            });
          } finally {
            console.log = origLog;
          }
          // Should have printed the resolved path (cwd/logs/runtime.log).
          const expectedPath = path.join(tmp, 'logs', 'runtime.log');
          // path resolution on macOS realpath may differ from mkdtemp path; check the suffix instead.
          ctx.expect(captured).toMatch(/logs[\\/]runtime\.log/);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'default mode: warns when log file does not exist yet',
      run: async (ctx) => {
        const cmd = require(MOD_PATH);
        const tmp = freshTmp();
        try {
          let captured = '';
          const origLog = console.log;
          console.log = (...a) => { captured += a.join(' ') + '\n'; };
          try {
            await withCwd(tmp, async () => {
              await cmd({});
            });
          } finally {
            console.log = origLog;
          }
          ctx.expect(captured).toMatch(/does not exist yet/);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'default mode: prints last N lines when file exists',
      run: async (ctx) => {
        const cmd = require(MOD_PATH);
        const tmp = freshTmp();
        try {
          // Set up a fake log file with 100 lines.
          const logsDir = path.join(tmp, 'logs');
          fs.mkdirSync(logsDir, { recursive: true });
          const logFile = path.join(logsDir, 'runtime.log');
          const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
          fs.writeFileSync(logFile, lines.join('\n') + '\n');

          let captured = '';
          const origStdoutWrite = process.stdout.write.bind(process.stdout);
          const origLog = console.log;
          console.log = (...a) => { captured += a.join(' ') + '\n'; };
          process.stdout.write = (s) => { captured += s; return true; };
          try {
            await withCwd(tmp, async () => {
              await cmd({ lines: 5 });
            });
          } finally {
            console.log = origLog;
            process.stdout.write = origStdoutWrite;
          }
          // Should contain the most recent lines (last 5 of 100, so lines 95-99 ish
          // depending on how the trailing newline splits). At minimum the last
          // few must be present, the very-early ones must not.
          ctx.expect(captured).toContain('line 99');
          ctx.expect(captured).toContain('line 96');
          // Should NOT contain very early lines.
          ctx.expect(captured.includes('line 0\n')).toBe(false);
          ctx.expect(captured.includes('line 50\n')).toBe(false);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'surface positional: resolves <cwd>/logs/<surface>.log',
      run: async (ctx) => {
        const cmd = require(MOD_PATH);
        for (const surface of ['dev', 'build', 'test']) {
          const tmp = freshTmp();
          try {
            let captured = '';
            const origLog = console.log;
            console.log = (...a) => { captured += a.join(' ') + '\n'; };
            try {
              await withCwd(tmp, async () => {
                await cmd({ _: ['logs', surface], path: true });
              });
            } finally {
              console.log = origLog;
            }
            ctx.expect(captured).toMatch(new RegExp(`logs[\\\\/]${surface}\\.log`));
          } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
          }
        }
      },
    },
    {
      name: 'no surface positional: still resolves runtime.log',
      run: async (ctx) => {
        const cmd = require(MOD_PATH);
        const tmp = freshTmp();
        try {
          let captured = '';
          const origLog = console.log;
          console.log = (...a) => { captured += a.join(' ') + '\n'; };
          try {
            await withCwd(tmp, async () => {
              await cmd({ _: ['logs'], path: true });
            });
          } finally {
            console.log = origLog;
          }
          ctx.expect(captured).toMatch(/logs[\\/]runtime\.log/);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'default mode: tails the named surface, not runtime.log',
      run: async (ctx) => {
        const cmd = require(MOD_PATH);
        const tmp = freshTmp();
        try {
          const logsDir = path.join(tmp, 'logs');
          fs.mkdirSync(logsDir, { recursive: true });
          fs.writeFileSync(path.join(logsDir, 'dev.log'), Array.from({ length: 100 }, (_, i) => `dev line ${i}`).join('\n') + '\n');
          fs.writeFileSync(path.join(logsDir, 'runtime.log'), 'runtime line\n');

          let captured = '';
          const origStdoutWrite = process.stdout.write.bind(process.stdout);
          const origLog = console.log;
          console.log = (...a) => { captured += a.join(' ') + '\n'; };
          process.stdout.write = (s) => { captured += s; return true; };
          try {
            await withCwd(tmp, async () => {
              await cmd({ _: ['logs', 'dev'], lines: 5 });
            });
          } finally {
            console.log = origLog;
            process.stdout.write = origStdoutWrite;
          }
          ctx.expect(captured).toMatch(/logs[\\/]dev\.log/);
          ctx.expect(captured).toContain('dev line 99');
          // The runtime log must stay out of a `logs dev` read entirely.
          ctx.expect(captured.includes('runtime line')).toBe(false);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'unknown surface: fails with a message naming the four surfaces',
      run: async (ctx) => {
        const cmd = require(MOD_PATH);
        const tmp = freshTmp();
        try {
          let error = null;
          await withCwd(tmp, async () => {
            try {
              await cmd({ _: ['logs', 'bogus'], path: true });
            } catch (e) {
              error = e;
            }
          });
          ctx.expect(error).toBeTruthy();
          ctx.expect(error.message).toContain('bogus');
          for (const surface of ['runtime', 'dev', 'build', 'test']) {
            ctx.expect(error.message).toContain(surface);
          }
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});
