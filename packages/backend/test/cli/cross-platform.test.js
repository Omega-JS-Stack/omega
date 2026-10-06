/**
 * Test: the CLI's host assumptions, pinned for a host that is not this one
 * ([#769](https://github.com/Omega-JS-Stack/omega/issues/769)).
 *
 * Every case here used to be a Unix-only line: `sh -c` with no `sh` to run it,
 * a `--exec` whose hand-quoted path lost its backslashes, an install hint that
 * told a Windows box to use Homebrew, an `lsof` diagnostic that threw. The
 * platform is an ARGUMENT throughout, so the Windows branch is proven from a
 * Mac — nothing here spawns anything, which is the point: what a spawn WOULD
 * be is decided by pure functions, and those are what a test can hold.
 *
 * Run: npx omega test backend:cli/cross-platform
 */
const { shellInvocation, pathInvocation } = require('../../dist/cli/utils/spawn-shell.js');
const { MACHINE_TOOLS } = require('../../dist/vendor/devkit/machine-tools.js');
const WatchCommand = require('../../dist/cli/commands/watch.js');
const BaseCommand = require('../../dist/cli/commands/base-command.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const { reloadTriggerExec } = WatchCommand;

// A port the OS hands out on demand and releases at once: free by
// construction at the moment the case reads it.
function freePort() {
  return new Promise((resolve, reject) => {
    const server = require('node:net').createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// The `node -e "<script>"` half of an --exec line, unwrapped.
function scriptOf(execLine) {
  return execLine.slice('node -e "'.length, execLine.lastIndexOf('" && echo'));
}

module.exports = defineCases({
  description: 'Cross-platform CLI internals — the shell, the trigger script, the hints, the port probe',
  type: 'group',

  tests: [
    {
      name: 'a-command-line-runs-through-the-hosts-own-shell',
      async run({ expect }) {
        expect(shellInvocation('firebase emulators:start --only functions', 'darwin'), 'unix composes sh -c').toEqual(['sh', ['-c', 'firebase emulators:start --only functions']]);
        expect(shellInvocation('firebase emulators:start --only functions', 'linux'), 'linux is the same unix branch').toEqual(['sh', ['-c', 'firebase emulators:start --only functions']]);
        expect(shellInvocation('firebase emulators:start --only functions', 'win32'), 'windows has no sh — cmd.exe /c, and never shell:true (DEP0190)').toEqual(['cmd.exe', ['/c', 'firebase emulators:start --only functions']]);
      },
    },

    {
      name: 'a-bare-name-is-resolved-by-the-host-never-by-us',
      async run({ expect }) {
        // The whole point of the pair: `commandOnPath` says nodemon EXISTS, and
        // this says how to run it. On Windows that must go through cmd.exe, the
        // only thing that applies PATHEXT to a bare name and can execute the
        // `.cmd` shim npm installed.
        expect(pathInvocation('nodemon', ['--watch', '/src'], 'darwin'), 'unix spawns the name directly — execvp searches PATH, and the child stays the real process').toEqual(['nodemon', ['--watch', '/src']]);
        expect(pathInvocation('nodemon', ['--watch', 'C:\\src'], 'win32'), 'windows goes through cmd.exe with the args still separate (Node quotes each one)').toEqual(['cmd.exe', ['/c', 'nodemon', '--watch', 'C:\\src']]);
        expect(pathInvocation('stripe', [], 'win32'), 'no args is still the shell branch').toEqual(['cmd.exe', ['/c', 'stripe']]);
      },
    },

    {
      name: 'the-reload-trigger-script-survives-a-windows-path',
      async run({ expect }) {
        const triggerFile = 'C:\\Users\\ian\\targets\\backend\\dist\\omega-reload-trigger.js';
        const resetPaths = ['C:\\Users\\ian\\.temp\\dev.log.reset'];
        const script = scriptOf(reloadTriggerExec({ triggerFile, resetPaths, message: '  x' }));

        // Hand-written quotes made `\U` and `\d` into escape sequences, so node
        // parsed the path into a different one and the trigger silently missed.
        // eslint-disable-next-line no-new-func
        const readBack = new Function(`${script.slice(0, script.indexOf(',fs='))};return f;`)();
        expect(readBack, 'the path node parses must be the path we meant').toBe(triggerFile);
        expect(script.includes('C:\\\\Users\\\\ian'), 'backslashes are escaped in the literal, not lost').toBe(true);
        expect(script.includes(`'${resetPaths[0]}'`), 'the sentinel path is escaped too, not raw').toBe(false);
      },
    },

    {
      name: 'the-reload-trigger-script-still-round-trips-a-unix-path',
      async run({ expect }) {
        const triggerFile = '/Users/ian/targets/backend/dist/omega-reload-trigger.js';
        const line = reloadTriggerExec({
          triggerFile,
          resetPaths: ['/Users/ian/.temp/dev.log.reset'],
          message: '  [@omega.js/backend] Triggered hot reload',
        });
        const script = scriptOf(line);

        // eslint-disable-next-line no-new-func
        const readBack = new Function(`${script.slice(0, script.indexOf(',fs='))};return f;`)();
        expect(readBack, 'the unix path is unchanged by the escaping').toBe(triggerFile);
        expect(line.endsWith('&& echo "  [@omega.js/backend] Triggered hot reload"'), 'the lane keeps its own line').toBe(true);
        expect(line.includes('touch '), 'touch is gone — it bumps mtime, and Firebase reloads on content').toBe(false);
        expect(line.includes('sleep'), 'sleep is a Unix binary; the settle wait is in-process').toBe(false);
      },
    },

    {
      name: 'every-machine-tool-install-names-a-manager-the-host-actually-has',
      async run({ expect }) {
        const java = MACHINE_TOOLS.backend.find((tool) => tool.name === 'java').install;
        expect(java.darwin).toBe('brew install openjdk');
        expect(java.win32.split('.')[0], 'windows opens with winget').toBe('winget install Microsoft');
        expect(java.linux).toBe('sudo apt install default-jdk');
        expect(/choco install openjdk/.test(java.win32), 'chocolatey is still named').toBe(true);

        for (const tool of Object.values(MACHINE_TOOLS).flat()) {
          for (const platform of ['win32', 'linux']) {
            expect(tool.install[platform].includes('brew install'), `${tool.name} on ${platform}: no Homebrew there`).toBe(false);
          }

          // Same rule as the mkcert hint: the head of the line is pasteable, an
          // alternative follows in a sentence. `(or: choco …)` inside the command
          // is a command that does not run.
          for (const platform of ['darwin', 'win32', 'linux']) {
            const head = tool.install[platform].split('.')[0];
            expect(/\(or\b|\bor:/.test(head), `${tool.name} on ${platform} splices an alternative into the command`).toBe(false);
          }
        }
      },
    },

    {
      name: 'the-port-diagnostic-is-unix-only-and-says-so',
      async run({ expect }) {
        const command = new BaseCommand({ firebaseProjectPath: process.cwd(), argv: {}, options: {} });

        // lsof/ps do not exist on Windows. The enrichment answers "nobody to
        // name" rather than throwing; isPortInUse() is the real check and is
        // OS-agnostic, so nothing downstream depends on this.
        // The port is one the OS just handed out and released, never a fixed
        // number: the run's own emulators bind dynamic ports, and a fixed
        // "free" port was found held by them.
        const port = await freePort();
        expect(command.getProcessesOnPort(port, { platform: 'win32' }), 'win32 short-circuits').toBe(null);
        expect(command.getProcessesOnPort(port, { platform: 'darwin' }), 'a free port is null on unix too').toBe(null);
      },
    },
  ],
});
