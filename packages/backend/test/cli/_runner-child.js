/**
 * The REAL test-runner child, run on a temp custom-server project: the command
 * `omega test` builds, spawned the way it spawns it. A custom project boots no
 * emulator, so the run reaches the discovered suites with nothing listening.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TestCommand = require('../../dist/cli/commands/test.js');

/** A temp project holding the given test files (path under test/ → source). */
function stageProject(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-child-')));
  for (const [file, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, 'test', file)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'test', file), source);
  }
  return dir;
}

/** Run the runner child on `projectDir` in custom mode; `env` rides over a clean lane env. */
function runRunnerChild(projectDir, env = {}) {
  const testConfig = {
    custom: true,
    projectDir,
    testPaths: [],
    // Nothing listens here: a run that reached the health check fails on it
    apiUrl: 'http://127.0.0.1:9',
    adminKey: 'fixture-admin-key',
    webhookKey: 'fixture-webhook-key',
    brand: { id: 'fixture' },
    domain: 'fixture.test',
    cloud: { config: { projectId: 'demo-fixture' } },
    emulatorPorts: { firestore: 9, auth: 9, hosting: 9 },
  };
  const command = new TestCommand({ firebaseProjectPath: projectDir, argv: {}, options: {} }).buildTestCommand(testConfig);

  const baseEnv = { ...process.env };
  delete baseEnv.TEST_EXTENDED_MODE;
  delete baseEnv.OMEGA_TEST_LANE;
  const result = spawnSync('sh', ['-c', command], { cwd: projectDir, env: { ...baseEnv, ...env }, encoding: 'utf8', timeout: 60000 });

  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

module.exports = { stageProject, runRunnerChild };
