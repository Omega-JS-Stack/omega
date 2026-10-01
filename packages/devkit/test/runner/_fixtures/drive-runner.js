/**
 * Runs one createRunner scenario in this process (one runner per process)
 * and writes `{ result, error, calls }` to the out file named on argv.
 * Usage: node drive-runner.js <scenario> <outFile> [arg]
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRunner } = require('../../../src/test/runner.js');

const [scenarioName, outFile, arg] = process.argv.slice(2);
const calls = [];
globalThis.__runnerCalls = calls;

const IN_APP_STACK = 'AssertionError: in-app failure\n    at inApp (background.js:7:3)';
const ALL_REPORTED = [
  { status: 'pass', durationMs: 3 },
  { status: 'fail', durationMs: 4, error: { name: 'AssertionError', message: 'in-app failure', stack: IN_APP_STACK } },
  { status: 'skip', durationMs: 0, reason: 'in-app skip' },
];

// A fake app-row driver: once started, it "runs" the row's cases and reports
// outcomes[i] for the i-th case by id, then settles `finished`.
function appDriver(outcomes) {
  return {
    async start({ suites, report }) {
      calls.push('start');
      const cases = suites.flatMap((suite) => suite.cases);
      const finished = new Promise((resolve) => {
        setImmediate(() => {
          cases.forEach((caseDef, index) => {
            const outcome = outcomes(index);
            if (outcome) report({ id: caseDef.id, name: caseDef.name, ...outcome });
          });
          resolve();
        });
      });
      return { extras: () => ({}), finished, stop: async () => calls.push('stop') };
    },
  };
}

// A fake host-row driver: hands each case its own extras and counts stop().
function hostDriver() {
  return {
    async start() {
      calls.push('start');
      return {
        extras(caseInfo) {
          calls.push(`extras:${caseInfo.name}`);
          return { http: { forCase: caseInfo.name } };
        },
        finished: Promise.resolve(),
        stop: async () => calls.push('stop'),
      };
    },
  };
}

const SCENARIOS = {
  'app-reports': () => ({ framework: 'extension', fixture: 'runner-app', drivers: { background: appDriver((i) => ALL_REPORTED[i]) } }),
  'app-unreported': () => ({ framework: 'extension', fixture: 'runner-app', drivers: { background: appDriver((i) => (i === 0 ? ALL_REPORTED[0] : null)) } }),
  'host-extras': () => ({ framework: 'backend', fixture: 'runner-host', drivers: { emulator: hostDriver() } }),
  'no-driver': () => ({ framework: 'extension', fixture: 'runner-app', drivers: {} }),
  layer: () => ({ framework: 'desktop', fixture: 'runner-layers', drivers: { main: appDriver(() => ({ status: 'pass', durationMs: 1 })) }, options: { layer: arg } }),
  lanes: () => ({ framework: 'node', fixture: 'runner-lanes', drivers: {}, lanes: ['live'], options: arg ? { lane: arg } : {} }),
  'default-layer': () => ({ framework: 'desktop', fixture: 'runner-default', drivers: {} }),
};

async function main() {
  const scenario = SCENARIOS[scenarioName]();
  const projectRoot = path.join(__dirname, scenario.fixture);
  const runner = createRunner({
    framework: scenario.framework,
    title: `Fixture ${scenarioName}`,
    projectRoot,
    roots: [{ source: 'project', dir: path.join(projectRoot, 'test') }],
    drivers: scenario.drivers,
    log: `${outFile}.log`,
    defaultTimeout: 5000,
    packageName: `fixture-${scenario.fixture}`,
    frameworkAliases: [],
    ...(scenario.lanes ? { lanes: scenario.lanes } : {}),
  });

  let result = null;
  let error = null;
  try {
    result = await runner.run({ targets: [], reporter: 'json', ...scenario.options });
  } catch (e) {
    error = { message: e.message };
  }
  fs.writeFileSync(outFile, JSON.stringify({ result, error, calls }));
  process.exit(0);
}

main();
