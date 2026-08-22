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

const { JourneyRun, scrubCredentialEnv, latestRunFile, discoverBrandTargets } = require('../src/test/journey-harness.js');

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

test('scrubCredentialEnv drops credential-shaped vars, keeps operating env', () => {
  const scrubbed = scrubCredentialEnv({
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    NODE_ENV: 'test',
    npm_config_cache: '/tmp/npm',
    OMEGA_MONOREPO: '/repo',
    OMEGA_NON_INTERACTIVE: '1',
    // Every one of these must go — the runtime legs prove themselves credless
    GOOGLE_CLIENT_ID: 'x',
    GOOGLE_CLIENT_SECRET: 'x',
    GOOGLE_APPLICATION_CREDENTIALS: '/adc.json',
    CLOUDFLARE_TOKEN: 'x',
    GH_TOKEN: 'x',
    GITHUB_TOKEN: 'x',
    SENDGRID_API_KEY: 'x',
    APPLE_API_KEY: 'x',
    STRIPE_SECRET_KEY: 'x',
    OMEGA_ADMIN_KEY: 'x',
    SENTRY_AUTH_TOKEN: 'x',
    DB_PASSWORD: 'x',
  });

  assert.deepEqual(Object.keys(scrubbed).sort(), [
    'HOME', 'NODE_ENV', 'OMEGA_MONOREPO', 'OMEGA_NON_INTERACTIVE', 'PATH', 'npm_config_cache',
  ]);
  assert.equal(scrubbed.PATH, '/usr/bin');
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

  for (const name of ['extension', 'backend', 'website', 'desktop', 'website-docs']) {
    fs.mkdirSync(path.join(root, 'targets', name), { recursive: true });
    fs.writeFileSync(path.join(root, 'targets', name, 'package.json'), '{}');
  }
  fs.mkdirSync(path.join(root, 'targets', 'no-manifest')); // skipped: no package.json

  assert.deepEqual(
    discoverBrandTargets(root).map((dir) => path.basename(dir)),
    ['website', 'backend', 'desktop', 'extension', 'website-docs'],
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

  run.stepsLog.abort('preconditions unmet: java is not installed');

  assert.match(read(), /^FAIL {2}preflight — preconditions unmet: java is not installed$/m);

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
