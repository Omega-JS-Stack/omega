/**
 * runCommand's PREFIXED mode ([#901](https://github.com/Omega-JS-Stack/omega/issues/901)):
 * the deploy fan-out's parallel group pipes each child instead of inheriting
 * the terminal, and writes every line behind `[<target>] ` so three concurrent
 * targets read as one log. Real processes, real pipes: the run happens in a
 * driver process of its own, and the assertion is the bytes it emitted.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { execFile } = require('node:child_process');

const RUN_COMMAND = require.resolve('../src/lib/run-command.js');

/**
 * Run `child.js` under runCommand in a driver process and hand back what the
 * PARENT wrote to each stream.
 *
 * @param {string} dir - The scratch dir holding child.js (and the driver).
 * @param {string} prefix - The target label the lines carry.
 * @returns {Promise<{ stdout: string, stderr: string }>} the parent's output
 */
function runDriver(dir, prefix) {
  const driver = path.join(dir, 'driver.js');
  fs.writeFileSync(driver, [
    `const { runCommand } = require(${JSON.stringify(RUN_COMMAND)});`,
    `runCommand(process.execPath, [${JSON.stringify(path.join(dir, 'child.js'))}], ${JSON.stringify(dir)}, undefined, { prefix: ${JSON.stringify(prefix)} })`,
    '  .then((result) => { if (!result.success) { process.exitCode = 1; } });',
    '',
  ].join('\n'));

  return new Promise((resolve, reject) => {
    execFile(process.execPath, [driver], { cwd: dir }, (error, stdout, stderr) => {
      if (error) return reject(error);
      return resolve({ stdout, stderr });
    });
  });
}

module.exports = defineCases({
  type: 'group',
  description: 'run-command',
  tests: [
    {
      name: 'prefixed mode labels every line of both streams, partial last line included (#901)',
      run: async (ctx) => {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-run-command-')));

        // Two full lines on stdout, one on stderr, then a line the child never
        // terminates: a tool's last progress line must not be swallowed.
        fs.writeFileSync(path.join(dir, 'child.js'), [
          'process.stdout.write("first\\nsecond\\n");',
          'process.stderr.write("warned\\n");',
          'process.stdout.write("no trailing newline");',
          '',
        ].join('\n'));

        try {
          const { stdout, stderr } = await runDriver(dir, 'web');

          ctx.expect(stdout.includes('[web] first\n'), `stdout line one is prefixed (got: ${JSON.stringify(stdout)})`).toBeTruthy();
          ctx.expect(stdout.includes('[web] second\n'), 'stdout line two is prefixed').toBeTruthy();
          ctx.expect(stdout.includes('[web] no trailing newline\n'), 'the partial last line is flushed at exit').toBeTruthy();
          ctx.expect(stderr.includes('[web] warned\n'), `stderr lands on the parent stderr, prefixed the same way (got: ${JSON.stringify(stderr)})`).toBeTruthy();
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'prefixed mode gives the child NO stdin, so a step that would prompt refuses (#901)',
      run: async (ctx) => {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-run-command-tty-')));

        fs.writeFileSync(path.join(dir, 'child.js'), 'process.stdout.write(`tty=${Boolean(process.stdin.isTTY)}`);\n');

        try {
          const { stdout } = await runDriver(dir, 'desktop');

          ctx.expect(stdout.includes('[desktop] tty=false'), 'the group child sees no terminal to ask in').toBeTruthy();
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  ],
});
