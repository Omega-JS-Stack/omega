/**
 * The `main` and `renderer` drivers: each row launches its own Electron on the
 * harness directory (harness/main-entry.js), hands it a spec file naming this
 * row's suites, and reports every envelope line the harness writes. `main`
 * names each suite file and its cases by id and name (the harness requires the file and
 * normalizes it the same way); `renderer` sends the suites serialized, since
 * their bodies run in a page.
 */

const path = require('path');
const os = require('os');
const jetpack = require('fs-jetpack');
const { spawn } = require('child_process');
const { serializeSuite } = require('@omega.js/devkit/test/serialize');
const { reportEvery, createEventTracker } = require('@omega.js/devkit/test/events');
const {
  NO_ELECTRON_REASON, KILL_GRACE_MS, resolveElectron, electronArgs, readChildOutput, childEnded, exitError, endChild,
} = require('./app-child.js');

const HARNESS_DIR = path.join(__dirname, '..', 'harness');

function specSuites(layer, suites) {
  if (layer === 'main') {
    return suites.map((suite) => ({ file: suite.file, cases: suite.cases.map(({ id, name }) => ({ id, name })) }));
  }
  return suites.map(serializeSuite);
}

/**
 * The driver of one harness row.
 * @param {'main'|'renderer'} layer - The row it drives.
 * @returns {{start: Function}} `start({ projectRoot, suites, report })` resolves `{ finished, stop() }`.
 */
function electronDriver(layer) {
  return {
    async start({ projectRoot, suites, report }) {
      const electronBin = resolveElectron(projectRoot);
      if (!electronBin) {
        reportEvery(suites.flatMap((suite) => suite.cases), report, { status: 'skip', reason: NO_ELECTRON_REASON });
        return { finished: Promise.resolve(), stop() {} };
      }

      const specFile = path.join(os.tmpdir(), `desktop-${layer}-spec-${process.pid}-${Date.now()}.json`);
      jetpack.write(specFile, { layer, suites: specSuites(layer, suites) });

      const env = {
        ...process.env,
        OMEGA_ENVIRONMENT: 'testing',
        OMEGA_TEST_SPEC: specFile,
        ELECTRON_NO_ATTACH_CONSOLE: '1',
        NODE_OPTIONS: '',
      };
      // Electron run as plain node cannot host the harness.
      delete env.ELECTRON_RUN_AS_NODE;

      // The harness DIRECTORY is the app: its package.json names main-entry.js, never the project's main.
      const child = spawn(electronBin, electronArgs(HARNESS_DIR, { env }), { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const events = createEventTracker(report);
      const output = readChildOutput(child, events.onEvent);
      const finished = childEnded(child)
        .finally(() => {
          output.detach();
          jetpack.remove(specFile);
          events.settle(suites.flatMap((suite) => suite.cases));
        })
        .then((end) => {
          if (end.code !== 0 && !end.signal) throw exitError(layer, end, output.tail());
        });

      return {
        finished,
        async stop() {
          if (child.exitCode === null && child.signalCode === null) endChild(child, KILL_GRACE_MS);
          await finished.catch(() => {});
        },
      };
    },
  };
}

module.exports = { electronDriver };
