/**
 * Unit pins for the journey harness: the JourneyRun shape and its pure helpers.
 * The stages themselves are the root `test:journey` lane, a real
 * outside-monorepo brand birth, and are exercised there, not here.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HARNESS_PATH = path.join(__dirname, '..', 'src', 'test', 'journey-harness.js');
const harness = require(HARNESS_PATH);
const {
  JourneyRun, latestRunFile, discoverBrandTargets,
} = harness;

const STORED_LOGIN_VARS = ['GH_CONFIG_DIR', 'XDG_CONFIG_HOME', 'CLOUDSDK_CONFIG', 'GOOGLE_APPLICATION_CREDENTIALS'];
const STAGES = ['clone', 'onboard', 'link', 'bootDev', 'homepage', 'sampleContent', 'shutdown', 'manage'];

/** A run bound to a throwaway log dir: no brand, no children. */
function runInTempLogDir(options = {}) {
  const logDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'journey-run-'));
  const lines = [];
  const run = new JourneyRun({
    monorepoRoot: os.tmpdir(),
    spec: { id: 'journey-brand' },
    logDir,
    log: (line) => lines.push(line),
    ...options,
  });
  return { run, logDir, lines };
}

/** A run whose clone already landed: a temp root holding the brand dir, as clone() leaves it. */
function runWithClonedBrand(options = {}) {
  const made = runInTempLogDir(options);
  const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'omega-journey-'));
  made.run.tempRoot = tempRoot;
  made.run.brandRoot = path.join(tempRoot, 'journey-brand');
  fs.mkdirSync(made.run.brandRoot);
  fs.writeFileSync(path.join(made.run.brandRoot, 'package.json'), '{}');
  return { ...made, tempRoot };
}

/** `YYYY-MM-DD`, `days` before today in UTC. */
function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

module.exports = defineCases({
  type: 'group',
  description: 'journey-harness',
  tests: [
    {
      name: 'childEnv puts the stored-login redirects under the run temp root only when scrubbed',
      run: (ctx) => {
        const { run, logDir } = runInTempLogDir();
        // clone() sets the temp root; a unit run supplies its own
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

    // --- JourneyRun: one method per stage, no step recorder ---

    {
      name: 'JourneyRun carries one method per stage plus finish, each taking no argument (the run state is its input)',
      run: (ctx) => {
        for (const name of [...STAGES, 'finish']) {
          ctx.expect(JourneyRun.prototype[name], name).toBeTypeOf('function');
          ctx.expect(JourneyRun.prototype[name].length, `${name} takes no argument`).toBe(0);
        }
      },
    },

    {
      name: 'runJourney and step are gone; checkPreconditions, latestRunFile and discoverBrandTargets stay exported',
      run: (ctx) => {
        ctx.expect('runJourney' in harness, 'runJourney export').toBe(false);
        ctx.expect('step' in JourneyRun.prototype, 'JourneyRun.prototype.step').toBe(false);
        for (const name of ['checkPreconditions', 'latestRunFile', 'discoverBrandTargets']) {
          ctx.expect(harness[name], name).toBeTypeOf('function');
        }
      },
    },

    {
      name: 'a JourneyRun keeps no step recorder and writes no steps.log',
      run: (ctx) => {
        const { run, logDir } = runInTempLogDir();
        try {
          for (const key of ['step', 'steps', 'stepsLog', 'status']) {
            ctx.expect(run[key], key).toBeUndefined();
          }
          ctx.expect(fs.existsSync(path.join(logDir, 'steps.log'))).toBe(false);
        } finally {
          fs.rmSync(logDir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'the harness source imports no steps-log',
      run: (ctx) => {
        const source = fs.readFileSync(HARNESS_PATH, 'utf8');
        ctx.expect(/steps-log/.test(source), 'a steps-log mention').toBe(false);
      },
    },

    // --- stages that run on plain files ---

    {
      name: 'finish() removes the temp brand of a complete run',
      run: async (ctx) => {
        const { run, logDir, tempRoot } = runWithClonedBrand();
        try {
          run.complete = true;
          await run.finish();
          ctx.expect(fs.existsSync(tempRoot)).toBe(false);
        } finally {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          fs.rmSync(logDir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'finish() keeps the temp brand of a run that never completed, and names it',
      run: async (ctx) => {
        const { run, logDir, lines, tempRoot } = runWithClonedBrand();
        try {
          await run.finish();
          ctx.expect(fs.existsSync(path.join(run.brandRoot, 'package.json'))).toBe(true);
          ctx.expect(lines.join('\n')).toContain(`brand kept for inspection: ${run.brandRoot}`);
        } finally {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          fs.rmSync(logDir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'finish() keeps the temp brand of a complete run asked to keep it',
      run: async (ctx) => {
        // The lane turns OMEGA_JOURNEY_KEEP=1 into this option; the harness reads no env for it
        const { run, logDir, tempRoot } = runWithClonedBrand({ keep: true });
        try {
          run.complete = true;
          await run.finish();
          ctx.expect(fs.existsSync(path.join(run.brandRoot, 'package.json'))).toBe(true);
        } finally {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          fs.rmSync(logDir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'sampleContent() names the 11 materialized posts of the web target',
      run: async (ctx) => {
        const { run, logDir, tempRoot } = runWithClonedBrand();
        try {
          const sampleRoot = path.join(run.brandRoot, 'targets', 'web', '.omega', 'sample-content');
          fs.mkdirSync(path.join(sampleRoot, '_posts'), { recursive: true });
          fs.writeFileSync(path.join(sampleRoot, '.gitignore'), '*\n');
          // Rolling dates: the newest post sits ten days back
          for (let i = 0; i < 11; i += 1) {
            fs.writeFileSync(path.join(sampleRoot, '_posts', `${daysAgo(10 + i)}-sample-${i}.md`), '---\n---\n');
          }

          const detail = await run.sampleContent();
          ctx.expect(detail).toMatch(new RegExp(`^11 posts, newest ${daysAgo(10)}`));
        } finally {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          fs.rmSync(logDir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'sampleContent() throws when the web target materialized no post',
      run: async (ctx) => {
        const { run, logDir, tempRoot } = runWithClonedBrand();
        try {
          const sampleRoot = path.join(run.brandRoot, 'targets', 'web', '.omega', 'sample-content');
          fs.mkdirSync(path.join(sampleRoot, '_posts'), { recursive: true });
          fs.writeFileSync(path.join(sampleRoot, '.gitignore'), '*\n');

          await ctx.expect(run.sampleContent()).rejects.toThrow(/expected 11 sample posts, found 0/);
        } finally {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          fs.rmSync(logDir, { recursive: true, force: true });
        }
      },
    },
  ],
});
