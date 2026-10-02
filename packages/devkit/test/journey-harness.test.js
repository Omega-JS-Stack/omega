/**
 * Unit pins for the journey harness's pure helpers (cp195). The full
 * runJourney() is the root `test:journey` lane itself — a real
 * outside-monorepo brand birth — and is exercised there, not here.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  JourneyRun, latestRunFile, discoverBrandTargets,
} = require('../src/test/journey-harness.js');
const { machineToolLine } = require('../src/machine-tools.js');

const STORED_LOGIN_VARS = ['GH_CONFIG_DIR', 'XDG_CONFIG_HOME', 'CLOUDSDK_CONFIG', 'GOOGLE_APPLICATION_CREDENTIALS'];

/** A run bound to a throwaway log dir — no brand, no children, just the recorder. */
function runInTempLogDir() {
  const logDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'journey-steps-'));
  const run = new JourneyRun({
    monorepoRoot: os.tmpdir(),
    spec: { id: 'journey-brand' },
    logDir,
    log: () => {},
  });
  return { run, logDir, read: () => fs.readFileSync(path.join(logDir, 'steps.log'), 'utf8') };
}

test('childEnv puts the stored-login redirects under the run temp root only when scrubbed', () => {
  const { run, logDir } = runInTempLogDir();
  // runJourney sets the temp root at clone time; a unit run supplies its own
  run.tempRoot = logDir;

  // The machine may set any of these itself; cleared here so "none is set" reads plainly
  const saved = Object.fromEntries(STORED_LOGIN_VARS.map((key) => [key, process.env[key]]));
  for (const key of STORED_LOGIN_VARS) delete process.env[key];

  try {
    const scrubbed = run.childEnv({}, { scrub: true });
    assert.equal(scrubbed.GH_CONFIG_DIR, path.join(logDir, 'gh'));
    assert.equal(scrubbed.XDG_CONFIG_HOME, path.join(logDir, 'xdg'));
    assert.equal(scrubbed.CLOUDSDK_CONFIG, path.join(logDir, 'gcloud'));
    assert.equal(scrubbed.GOOGLE_APPLICATION_CREDENTIALS, path.join(logDir, 'gcloud', 'application_default_credentials.json'));

    const plain = run.childEnv();
    for (const key of STORED_LOGIN_VARS) assert.equal(key in plain, false, key);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value !== undefined) process.env[key] = value;
    }
    fs.rmSync(logDir, { recursive: true, force: true });
  }
});

test('latestRunFile picks the newest .omega/runs entry; null without one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-unit-'));
  assert.equal(latestRunFile(root), null);

  const runsDir = path.join(root, '.omega', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  assert.equal(latestRunFile(root), null); // empty dir

  fs.writeFileSync(path.join(runsDir, '2026-07-17T01-00-00.json'), '{}');
  fs.writeFileSync(path.join(runsDir, '2026-07-17T02-30-00.json'), '{}');
  fs.writeFileSync(path.join(runsDir, 'notes.txt'), 'ignored');
  assert.equal(latestRunFile(root), path.join(runsDir, '2026-07-17T02-30-00.json'));

  fs.rmSync(root, { recursive: true, force: true });
});

test('discoverBrandTargets returns package.json-bearing target dirs in journey order', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-unit-'));
  assert.deepEqual(discoverBrandTargets(root), []); // no targets/ at all

  for (const name of ['extension', 'backend', 'web', 'desktop', 'docs']) {
    fs.mkdirSync(path.join(root, 'targets', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'targets', name, 'package.json'), '{}');
  }
  fs.mkdirSync(path.join(root, 'targets', 'no-manifest')); // skipped: no package.json

  assert.deepEqual(
    discoverBrandTargets(root).map((dir) => path.basename(dir)),
    ['web', 'backend', 'desktop', 'extension', 'docs'],
  );

  fs.rmSync(root, { recursive: true, force: true });
});

// --- steps.log: the journey's verdicts on disk (#197) ---

test('every journey step writes its verdict to steps.log as it lands', async () => {
  const { run, read, logDir } = runInTempLogDir();

  await run.step('onboard scaffolds journey-brand', async () => '/tmp/journey-brand');
  await assert.rejects(
    run.step('`omega dev` boots web + backend emulator', async () => {
      throw new Error('dev not ready after 7 min\n  waiting on: backend');
    }),
    /dev not ready/,
  );

  const contents = read();
  assert.match(contents, /^PASS {2}onboard scaffolds journey-brand \(\/tmp\/journey-brand\)$/m);
  // One line per step: the multi-line failure detail collapses
  assert.match(contents, /^FAIL {2}`omega dev` boots web \+ backend emulator — dev not ready after 7 min waiting on: backend$/m);

  fs.rmSync(logDir, { recursive: true, force: true });
});

test('a journey abort outside the steps is recorded as a preflight failure', () => {
  const { run, read, logDir } = runInTempLogDir();
  // The harness names a missing machine tool with the helper's one line
  const javaLine = machineToolLine({
    target: 'backend', type: 'backend', name: 'java', why: 'the Firebase emulators run on it', install: 'brew install openjdk',
  });

  run.stepsLog.abort(`preconditions unmet: ${javaLine}`);

  const verdict = read().split('\n').find((line) => line.startsWith('FAIL  preflight '));
  assert.ok(verdict && verdict.endsWith(` preconditions unmet: ${javaLine}`), read());

  fs.rmSync(logDir, { recursive: true, force: true });
});

test('a journey abort after a failed step adds nothing — that verdict is on file', async () => {
  const { run, read, logDir } = runInTempLogDir();

  await assert.rejects(run.step('headless manage', async () => { throw new Error('update service error'); }));
  run.stepsLog.abort(new Error('update service error'));

  const verdicts = read().split('\n').filter((line) => /^(PASS|FAIL) /.test(line));
  assert.equal(verdicts.length, 1);
  assert.equal(/preflight/.test(read()), false);

  fs.rmSync(logDir, { recursive: true, force: true });
});
