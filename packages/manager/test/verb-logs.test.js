/**
 * Verb log targets (#231, #623) — EVERY brand-root verb tees its own run to its
 * OWN file, `<brandRoot>/logs/<verb>.log`: `omega manage` → logs/manage.log,
 * `omega dev` → logs/dev.log, and (#623) build, clean, deploy, update, test and
 * pipeline to theirs. One verb never truncates another's record, and the
 * fan-out's own verdict — its header, its loud skips, its summary — is on disk
 * without stitching the per-target logs together.
 *
 * A fanned-out target's own output is NOT here by design: `runCommand` spawns
 * with stdio inherit, so a child writes past this process' writers into its own
 * `targets/<target>/logs/<verb>.log`.
 *
 * This file pins the manage half and the six #623 verbs; the dev half lives in
 * dev.test.js, which owns the spawn/runManage stubs the boot needs.
 *
 * The walk and the per-target runner are stubbed before the commands resolve
 * them — the behavior here is WHERE the tee opens, not what the fan-out does.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { withoutCI } = require('@omega.js/devkit/test/without-ci');

const WALK_MARKER = 'walking the fixture brand';

const managePath = require.resolve('../src/manage.js');
require.cache[managePath] = {
  id: managePath,
  filename: managePath,
  path: path.dirname(managePath),
  loaded: true,
  exports: {
    runManage: async () => {
      console.log(WALK_MARKER);
      return { hasErrors: false, results: {}, brand: {} };
    },
  },
};

// The per-target runner every fan-out ends in — stubbed so nothing spawns and
// the only lines reaching the log are the fan-out's OWN (deploy-command.test.js
// stubs the delivery lane the same way).
const runCommandPath = require.resolve('../src/lib/run-command.js');
require.cache[runCommandPath] = {
  id: runCommandPath,
  filename: runCommandPath,
  path: path.dirname(runCommandPath),
  loaded: true,
  exports: { runCommand: async () => ({ success: true }) },
};

// The machine registry is per-machine state: this file's fixtures write into a
// temp home, never the developer's ~/.omega (#677).
require('@omega.js/devkit/test/temp-home');

const manageCommand = require('../src/commands/manage.js');
const buildCommand = require('../src/commands/build.js');
const cleanCommand = require('../src/commands/clean.js');
const deployCommand = require('../src/commands/deploy.js');
const updateCommand = require('../src/commands/update.js');
const testCommand = require('../src/commands/test.js');
const pipelineCommand = require('../src/commands/pipeline.js');

/** Stage a brand monorepo — a config/omega.json5 root is all the verb needs. */
function stageBrand() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-manager-verb-logs-')));

  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: { type: 'web' } },
}
`);

  return root;
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content));
}

/**
 * A brand the FAN-OUT verbs can walk: one framework target (a fake
 * @omega.js/web whose bin the climb finds, and whose `./ensure-target` the
 * deploy's in-process scaffold calls, #901) and one custom target with its own
 * scripts, so both lanes are represented in every summary.
 */
function stageFanoutBrand() {
  const root = stageBrand();

  write(path.join(root, 'package.json'), { name: 'fixture-brand', private: true, workspaces: ['targets/*'] });
  write(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: { type: 'web' }, api: { type: 'custom' } },
}
`);
  write(path.join(root, 'targets', 'web', 'package.json'), { name: 'web', private: true, devDependencies: { '@omega.js/web': '*' } });
  write(path.join(root, 'targets', 'api', 'package.json'), {
    name: 'api', private: true, scripts: { build: 'tsc', clean: 'rm -rf dist', deploy: 'echo publish' },
  });

  const pkgDir = path.join(root, 'node_modules', '@omega.js', 'web');
  write(path.join(pkgDir, 'package.json'), { name: '@omega.js/web', bin: { omega: './bin.js' } });
  write(path.join(pkgDir, 'bin.js'), '#!/usr/bin/env node\n');
  write(path.join(pkgDir, 'ensure-target.js'), 'exports.ensureTarget = async () => ({ written: [], merged: [], changed: [] });\n');

  return root;
}

/**
 * Run a brand-root verb from inside `root` with the tee's CI opt-out lifted
 * (the tee declines under a runner by design; these assert what it does when it
 * does not decline), then detach so the next verb starts from clean writers.
 */
async function runVerb(command, root, options = {}) {
  const cwd0 = process.cwd();
  const restoreTee = require('@omega.js/devkit/attach-log-file').mark();

  try {
    process.chdir(root);
    await withoutCI(() => command(options));
  } finally {
    restoreTee();
    process.chdir(cwd0);
    process.exitCode = undefined;
  }
}

/** The verb's log, read from the brand root. */
function readVerbLog(root, verb) {
  return fs.readFileSync(path.join(root, 'logs', `${verb}.log`), 'utf8');
}

module.exports = defineCases({
  type: 'group',
  description: 'verb-logs',
  tests: [
    {
      name: 'omega manage tees the service walk to <brandRoot>/logs/manage.log',
      run: async (ctx) => {
        const root = stageBrand();

        await runVerb(manageCommand, root);

        const contents = readVerbLog(root, 'manage');
        ctx.expect(contents, "the walk's output is in the brand's manage log").toMatch(new RegExp(WALK_MARKER));
        ctx.expect(fs.existsSync(path.join(root, 'logs', 'dev.log')), 'dev.log belongs to `omega dev` — a walk never truncates it').toBe(false);
      },
    },

    // ─── The #623 fan-outs — one file per verb, the fan-out's own verdict in it ───

    {
      name: 'omega build tees the fan-out to <brandRoot>/logs/build.log',
      run: async (ctx) => {
        const root = stageFanoutBrand();

        await runVerb(buildCommand, root);

        const contents = readVerbLog(root, 'build');
        ctx.expect(contents, 'the fan-out header opens the log').toMatch(/OMEGA brand build/);
        ctx.expect(contents, "and the fan-out's own verdict closes it").toMatch(/Build summary/);
        ctx.expect(contents, 'every target the walk covered is named').toMatch(/api/);
      },
    },

    {
      name: 'omega clean tees the fan-out to <brandRoot>/logs/clean.log — never build.log',
      run: async (ctx) => {
        const root = stageFanoutBrand();

        await runVerb(cleanCommand, root);

        ctx.expect(readVerbLog(root, 'clean')).toMatch(/Clean summary/);
        ctx.expect(fs.existsSync(path.join(root, 'logs', 'build.log')), 'one verb never truncates another verb\'s record').toBe(false);
      },
    },

    {
      name: 'omega deploy tees the fan-out (delivery lane included) to <brandRoot>/logs/deploy.log',
      run: async (ctx) => {
        const root = stageFanoutBrand();

        await runVerb(deployCommand, root);

        const contents = readVerbLog(root, 'deploy');
        ctx.expect(contents).toMatch(/OMEGA brand deploy/);
        ctx.expect(contents, 'the delivery lane runs under the tee too').toMatch(new RegExp(WALK_MARKER));
        ctx.expect(contents).toMatch(/Deploy summary/);
      },
    },

    {
      name: 'omega update tees the fan-out to <brandRoot>/logs/update.log',
      run: async (ctx) => {
        const root = stageFanoutBrand();

        await runVerb(updateCommand, root);

        const contents = readVerbLog(root, 'update');
        ctx.expect(contents).toMatch(/OMEGA brand update/);
        ctx.expect(contents).toMatch(/Update summary/);
      },
    },

    {
      name: 'omega test tees the fan-out to <brandRoot>/logs/test.log',
      run: async (ctx) => {
        const root = stageFanoutBrand();

        await runVerb(testCommand, root, { _: ['test'] });

        const contents = readVerbLog(root, 'test');
        ctx.expect(contents).toMatch(/OMEGA brand tests/);
        ctx.expect(contents).toMatch(/Test summary/);
      },
    },

    {
      name: 'omega pipeline tees its scorecard to <brandRoot>/logs/pipeline.log',
      run: async (ctx) => {
        const root = stageFanoutBrand();

        // An unknown service makes the child manage run throw on its own argument
        // check — no service ever walks, nothing touches the network, and the
        // pipeline's verdict (no run record) is the fan-out output being asserted.
        await runVerb(pipelineCommand, root, { service: 'no-such-service' });

        const contents = readVerbLog(root, 'pipeline');
        ctx.expect(contents, 'the pipeline header opens the log').toMatch(/Pipeline — live full-cycle test/);
        ctx.expect(contents, 'and its own verdict is on disk').toMatch(/PIPELINE FAIL/);
      },
    },
  ],
});
