/**
 * Unit pins for the journey harness's pure helpers (cp195). The full
 * runJourney() is the root `test:journey` lane itself — a real
 * outside-monorepo brand birth — and is exercised there, not here.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'journey-harness',
  tests: [
    {
      name: 'childEnv puts the stored-login redirects under the run temp root only when scrubbed',
      run: (ctx) => {
        const { run, logDir } = runInTempLogDir();
        // runJourney sets the temp root at clone time; a unit run supplies its own
        run.tempRoot = logDir;

        // The machine may set any of these itself; cleared here so "none is set" reads plainly
        const saved = Object.fromEntries(STORED_LOGIN_VARS.map((key) => [key, process.env[key]]));
        for (const key of STORED_LOGIN_VARS) delete process.env[key];

        try {
          const scrubbed = run.childEnv({}, { scrub: true });
          ctx.expect(scrubbed.GH_CONFIG_DIR).toBe(path.join(logDir, 'gh'));
          ctx.expect(scrubbed.XDG_CONFIG_HOME).toBe(path.join(logDir, 'xdg'));
          ctx.expect(scrubbed.CLOUDSDK_CONFIG).toBe(path.join(logDir, 'gcloud'));
          ctx.expect(scrubbed.GOOGLE_APPLICATION_CREDENTIALS).toBe(path.join(logDir, 'gcloud', 'application_default_credentials.json'));

          const plain = run.childEnv();
          for (const key of STORED_LOGIN_VARS) ctx.expect(key in plain, key).toBe(false);
        } finally {
          for (const [key, value] of Object.entries(saved)) {
            if (value !== undefined) process.env[key] = value;
          }
          fs.rmSync(logDir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'latestRunFile picks the newest .omega/runs entry; null without one',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-unit-'));
        ctx.expect(latestRunFile(root)).toBe(null);

        const runsDir = path.join(root, '.omega', 'runs');
        fs.mkdirSync(runsDir, { recursive: true });
        ctx.expect(latestRunFile(root)).toBe(null); // empty dir

        fs.writeFileSync(path.join(runsDir, '2026-07-17T01-00-00.json'), '{}');
        fs.writeFileSync(path.join(runsDir, '2026-07-17T02-30-00.json'), '{}');
        fs.writeFileSync(path.join(runsDir, 'notes.txt'), 'ignored');
        ctx.expect(latestRunFile(root)).toBe(path.join(runsDir, '2026-07-17T02-30-00.json'));

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'discoverBrandTargets returns package.json-bearing target dirs in journey order',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-unit-'));
        ctx.expect(discoverBrandTargets(root)).toEqual([]); // no targets/ at all

        for (const name of ['extension', 'backend', 'web', 'desktop', 'docs']) {
          fs.mkdirSync(path.join(root, 'targets', name), { recursive: true });
          fs.writeFileSync(path.join(root, 'targets', name, 'package.json'), '{}');
        }
        fs.mkdirSync(path.join(root, 'targets', 'no-manifest')); // skipped: no package.json

        ctx.expect(discoverBrandTargets(root).map((dir) => path.basename(dir))).toEqual(['web', 'backend', 'desktop', 'extension', 'docs']);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    // --- steps.log: the journey's verdicts on disk (#197) ---

    {
      name: 'every journey step writes its verdict to steps.log as it lands',
      run: async (ctx) => {
        const { run, read, logDir } = runInTempLogDir();

        await run.step('onboard scaffolds journey-brand', async () => '/tmp/journey-brand');
        await ctx.expect(run.step('`omega dev` boots web + backend emulator', async () => {
            throw new Error('dev not ready after 7 min\n  waiting on: backend');
          })).rejects.toThrow(/dev not ready/);

        const contents = read();
        ctx.expect(contents).toMatch(/^PASS {2}onboard scaffolds journey-brand \(\/tmp\/journey-brand\)$/m);
        // One line per step: the multi-line failure detail collapses
        ctx.expect(contents).toMatch(/^FAIL {2}`omega dev` boots web \+ backend emulator — dev not ready after 7 min waiting on: backend$/m);

        fs.rmSync(logDir, { recursive: true, force: true });
      },
    },

    {
      name: 'a journey abort outside the steps is recorded as a preflight failure',
      run: (ctx) => {
        const { run, read, logDir } = runInTempLogDir();
        // The harness names a missing machine tool with the helper's one line
        const javaLine = machineToolLine({
          target: 'backend', type: 'backend', name: 'java', why: 'the Firebase emulators run on it', install: 'brew install openjdk',
        });

        run.stepsLog.abort(`preconditions unmet: ${javaLine}`);

        const verdict = read().split('\n').find((line) => line.startsWith('FAIL  preflight '));
        ctx.expect(verdict && verdict.endsWith(` preconditions unmet: ${javaLine}`), read()).toBeTruthy();

        fs.rmSync(logDir, { recursive: true, force: true });
      },
    },

    {
      name: 'a journey abort after a failed step adds nothing — that verdict is on file',
      run: async (ctx) => {
        const { run, read, logDir } = runInTempLogDir();

        await ctx.expect(run.step('headless manage', async () => { throw new Error('update service error'); })).rejects.toThrow();
        run.stepsLog.abort(new Error('update service error'));

        const verdicts = read().split('\n').filter((line) => /^(PASS|FAIL) /.test(line));
        ctx.expect(verdicts.length).toBe(1);
        ctx.expect(/preflight/.test(read())).toBe(false);

        fs.rmSync(logDir, { recursive: true, force: true });
      },
    },
  ],
});
