/**
 * ensure-target + deploy-precheck — the two halves `omega setup` used to be
 * ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)): the local half
 * runs on every verb and is idempotent, the network half is a deploy precheck
 * with one opt-out flag.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { ensureTarget, PROJECT_SCRIPTS } = require('../src/commands/lib/ensure-target.js');
const { verbScripts } = require('@omega.js/devkit/verb-scripts');
const { deployPrecheck, STEPS } = require('../src/commands/lib/deploy-precheck.js');
const Main = require('../src/cli.js');

const quiet = { log() {}, warn() {}, error() {} };

function tmpConsumer() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-ensure-'));
}

module.exports = defineCases({
  type: 'group',
  description: 'ensure-target',
  tests: [
    {
      name: 'ensureTarget: the verb scripts derive from the verb table, `start` among them',
      run: (ctx) => {
        const root = tmpConsumer();
        ensureTarget({ projectDir: root });

        const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        const derived = verbScripts('@omega.js/web');
        for (const [verb, command] of Object.entries(derived)) {
          ctx.expect(scripts[verb], `${verb} is scaffolded as its bare verb`).toBe(command);
        }
        ctx.expect(scripts.start, 'the dev row derives npm\'s start').toBe('omega dev');

        // No verb script is typed by hand: the manifest declares only what the table cannot derive
        const declared = require('../package.json').projectScripts || {};
        ctx.expect(Object.keys(declared).filter((key) => key in derived)).toEqual([]);
      },
    },

    {
      name: 'ensureTarget: writes on a fresh target, no-op on the rerun',
      run: (ctx) => {
        const root = tmpConsumer();

        const first = ensureTarget({ projectDir: root });
        ctx.expect(first.written.length > 0, 'a fresh target gets the defaults tree').toBeTruthy();
        ctx.expect(first.changed.some((line) => line.startsWith('package.json')), 'package.json is synced').toBeTruthy();
        ctx.expect(fs.existsSync(path.join(root, '.github/workflows/build.yml')), 'CI workflow scaffolded').toBeTruthy();

        const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        ctx.expect(Object.fromEntries(Object.keys(PROJECT_SCRIPTS).map((key) => [key, manifest.scripts[key]])), 'the omega verb scripts are synced').toEqual(PROJECT_SCRIPTS);
        ctx.expect(!('setup' in manifest.scripts), 'no `setup` script — the verbs run ensureTarget themselves').toBeTruthy();
        // Every OMEGA target states its license (#884): npm's own word for
        // closed-source commercial code, seeded only when the manifest states none
        ctx.expect(manifest.license).toBe('UNLICENSED');

        // The rerun adds nothing and syncs nothing. (One caveat, pre-existing and
        // named in `merged`: the omega.json5 seed is written verbatim on the fresh
        // pass and re-stringified by its JSON5 defaults-merge on the next one, so it
        // converges on pass three. Everything else is stable from pass two.)
        const second = ensureTarget({ projectDir: root });
        ctx.expect(second.written, 'a converged target writes nothing new').toEqual([]);
        ctx.expect(second.changed, 'a converged target syncs no manifest').toEqual([]);

        const third = ensureTarget({ projectDir: root });
        ctx.expect(third, 'a converged target is a total no-op').toEqual({ written: [], merged: [], changed: [] });
      },
    },

    {
      name: 'ensureTarget: the AGENTS.md builder\'s warnings reach the verb, as a converged old template shows',
      run: (ctx) => {
        const root = tmpConsumer();
        fs.writeFileSync(path.join(root, 'AGENTS.md'),
          '# ========== Default Values ==========\nframework guidance\n\n# ========== Custom Values ==========\nOur deploy needs the VPN up.\n');
        const warnings = [];

        ensureTarget({ projectDir: root, warn: (line) => warnings.push(line) });
        ctx.expect(warnings.some((line) => line.includes('Converged AGENTS.md')), 'a web verb prints the convergence').toBeTruthy();
        ctx.expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), 'the notes stay').toMatch(/VPN/);
      },
    },

    {
      name: 'ensureTarget: refuses a workspace root, loudly, without writing a single file (#699)',
      run: (ctx) => {
        // The accident: `omega deploy` at a workspace root scaffolded a whole website
        // target into it — src/, workflows, rewritten root scripts — before failing
        // anyway. Parity with the same case in @omega.js/desktop's suite (#706).
        const root = tmpConsumer();
        const manifestPath = path.join(root, 'package.json');
        fs.writeFileSync(manifestPath, `${JSON.stringify({ name: 'acme', private: true, workspaces: ['targets/*'] }, null, 2)}\n`);
        const before = fs.readFileSync(manifestPath, 'utf8');

        ctx.expect(() => ensureTarget({ projectDir: root })).toThrow((error) => {
          ctx.expect(error.message).toMatch(/refusing to scaffold into/);
          ctx.expect(error.message).toMatch(/declares "workspaces"/);
          ctx.expect(error.message.includes(root), `names the directory: ${error.message}`).toBeTruthy();
          return true;
        });

        ctx.expect(fs.readdirSync(root), 'nothing was scaffolded').toEqual(['package.json']);
        ctx.expect(fs.readFileSync(manifestPath, 'utf8'), 'the manifest is byte-identical').toBe(before);
      },
    },

    {
      name: 'deploy precheck: --no-secrets skips every step, bare deploy runs them in order',
      run: async (ctx) => {
        const ran = [];
        const steps = ['push-secrets'].map((name) => ({ name, run: () => { ran.push(name); } }));

        const skipped = await deployPrecheck({ projectDir: '/tmp/x', options: { secrets: false }, logger: quiet, steps });
        ctx.expect(skipped).toEqual({ skipped: 'opt-out' });
        ctx.expect(ran, '--no-secrets publishes nothing').toEqual([]);

        const result = await deployPrecheck({ projectDir: '/tmp/x', options: {}, logger: quiet, steps });
        ctx.expect(ran, 'the precheck runs by default').toEqual(['push-secrets']);
        ctx.expect(result.ran).toEqual(ran);
      },
    },

    // FATAL on all four frameworks (#891): the runner builds with what this step
    // sends, so a refused or half publish stops the deploy instead of dispatching
    // a run that cannot succeed.
    {
      name: 'deploy precheck: the secrets step is FATAL (#891)',
      run: (ctx) => {
        ctx.expect(STEPS.map((step) => step.name)).toEqual(['push-secrets']);
        ctx.expect(STEPS[0].fatal).toBe(true);
      },
    },

    {
      name: 'cli: no `setup` command, and a bare invocation resolves to help',
      run: (ctx) => {
        const { commandsDir, aliases, defaultCommand } = Main.config;

        ctx.expect(defaultCommand, 'bare `omega` prints help (#675)').toBe('help');
        ctx.expect(!('setup' in aliases), 'the setup alias is gone').toBeTruthy();
        ctx.expect(!fs.existsSync(path.join(commandsDir, 'setup.js')), 'commands/setup.js is deleted').toBeTruthy();
      },
    },
  ],
});
