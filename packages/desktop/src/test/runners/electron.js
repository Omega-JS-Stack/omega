// Electron-runner — spawns electron with the main-process harness, parses JSON-line stream,
// renders @omega.js/backend-style output to console. Returns aggregate counts.

const path = require('path');
const { spawn } = require('child_process');
const chalk = require('chalk').default;
const { renderEvent } = require('./render-event.js');

function runElectronTests({ harnessEntry, suiteFiles, rendererSuiteFiles, filter, projectRoot }) {
  rendererSuiteFiles = rendererSuiteFiles || [];
  return new Promise((resolve, reject) => {
    let electronBin;
    try {
      // Resolve like Node would from the project root (walks up node_modules chains),
      // so hoisted installs (npm workspaces) are found — not just projectRoot/node_modules.
      electronBin = require(require.resolve('electron', { paths: [projectRoot] }));
    } catch (e) {
      const msg = `    ○ main + renderer tests skipped (electron not installed in ${projectRoot})`;
      console.log(chalk.yellow(msg));
      const skipCount = (suiteFiles || []).length + rendererSuiteFiles.length;
      return resolve({ passed: 0, failed: 0, skipped: skipCount });
    }

    // Pass the harness DIRECTORY (not the entry file) as the app.
    // The harness dir has its own package.json with main: main-entry.js, which Electron uses.
    // This avoids Electron picking up the consumer's package.json main field.
    const harnessDir = path.dirname(harnessEntry);
    const args = [
      harnessDir,
      '--',
      '--suites',          JSON.stringify(suiteFiles || []),
      '--renderer-suites', JSON.stringify(rendererSuiteFiles),
    ];
    if (filter) {
      args.push('--filter', filter);
    }

    const childEnv = Object.assign({}, process.env, {
      OMEGA_TEST_MODE:              'true',   // canonical signal — manager.isTesting() picks it up
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      NODE_OPTIONS:              '',
    });
    // Defensive scrub at the spawn (friction 17c) — the CLI boundary strips it,
    // but paths that bypass the boundary must not boot Electron as plain node.
    delete childEnv.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronBin, args, {
      cwd: projectRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    const counts = { passed: 0, failed: 0, skipped: 0 };

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('__EM_TEST__')) {
          renderEvent(JSON.parse(line.slice('__EM_TEST__'.length)), counts);
        } else if (line.trim().length > 0) {
          // Pass-through other electron stdout (logger lines from @omega.js/desktop init, etc.)
          // Indent so they don't disrupt the layout.
          process.stdout.write(chalk.gray(`      ${line}\n`));
        }
      }
    });

    // Always consume stderr (otherwise the pipe fills and the child blocks).
    // Default: silent. Set OMEGA_TEST_DEBUG=1 to see what electron is logging.
    child.stderr.on('data', (chunk) => {
      if (process.env.OMEGA_TEST_DEBUG) {
        const text = chunk.toString();
        process.stderr.write(chalk.gray(`[stderr] ${text}`));
      }
    });

    child.on('exit', (code, signal) => {
      if (process.env.OMEGA_TEST_DEBUG) {
        console.log(chalk.gray(`[harness exit code=${code} signal=${signal}]`));
      }
    });

    child.on('error', (err) => reject(err));
    child.on('exit', (_code) => resolve(counts));
  });
}

module.exports = { runElectronTests };
