/**
 * Workspace `scripts` ensure op + the package-scripts heal lib — a `deploy`
 * script is guaranteed and the legacy `start: 'omega'` shape migrates to the
 * dev-stack convention (`start: 'omega dev'` + `manage: 'omega'`), nothing
 * else is ever touched (the retired `omega-manager` bin name is not rewritten:
 * brands edit it by hand), and a converged file rewrites nothing (idempotence
 * proven by bytes).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scriptsOp = require('../src/services/workspace/ensure/scripts.js');
const { healPackageScripts, syncTargetScripts, DEPLOY_SCRIPT, START_SCRIPT, MANAGE_SCRIPT } = require('../src/lib/package-scripts.js');
const { projectScripts, verbScripts } = require('@omega.js/devkit/verb-scripts');

function tmpBrand(pkg) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-ws-scripts-'));
  if (pkg !== undefined) {
    fs.writeFileSync(path.join(root, 'package.json'), typeof pkg === 'string' ? pkg : `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return root;
}

function readPkg(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

// ─── Target script sync (#675 cycle break, #689 one policy) ──────────────────

const { discoverTargets } = require('../src/lib/brand.js');

/**
 * Plant a target dir AND the brand declaration that types it (#886): the
 * fixture names each target for its own type, so `targets/<dir>` is
 * `targets.<dir>: { type: '<dir>' }` in the brand file.
 */
function plantTarget(root, dir, targetPkg, frameworkName, frameworkPkg) {
  const configPath = path.join(root, 'config', 'omega.json5');
  const declared = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : { brand: { id: 'fixture', name: 'Fixture', url: 'https://fixture.test' }, targets: {} };
  declared.targets[dir] = { type: dir };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(declared, null, 2)}\n`);

  const targetPath = path.join(root, 'targets', dir);
  fs.mkdirSync(targetPath, { recursive: true });
  if (targetPkg !== undefined) {
    fs.writeFileSync(path.join(targetPath, 'package.json'), typeof targetPkg === 'string' ? targetPkg : `${JSON.stringify(targetPkg, null, 2)}\n`);
  }
  if (frameworkName) {
    const fwDir = path.join(targetPath, 'node_modules', ...frameworkName.split('/'));
    fs.mkdirSync(fwDir, { recursive: true });
    fs.writeFileSync(path.join(fwDir, 'package.json'), `${JSON.stringify(frameworkPkg, null, 2)}\n`);
  }
  return targetPath;
}

// The op takes the runner's targets context (manage.js hands brand.targets to
// every workspace op) — the tests hand it the same discovery the runner uses.
const opInput = (root, extra) => ({ brandRoot: root, targets: discoverTargets(root), ...extra });

const ROOT_OK = { start: START_SCRIPT, manage: MANAGE_SCRIPT, deploy: DEPLOY_SCRIPT };

const FRAMEWORK_SCRIPTS = { start: 'omega serve', emulator: 'omega emulator', test: 'omega test' };

// A backend-shaped script map, the pure sync's fixture (the real backend's set
// is REAL_BACKEND below)
const BACKEND_PROJECT_SCRIPTS = {
  start: 'omega serve',
  deploy: 'omega deploy',
  emulator: 'omega emulator',
  test: "node --require ./test/_helpers/connect-trap.js --test 'test/_unit/**/*.test.js'",
  'test:static': 'npm test',
  'test:emulator': 'omega test',
};

// The real @omega.js/backend manifest and scaffold entry, for the op cases that hold its policy
// (the ensure-target door loads packages/backend/dist: it needs the backend's prepare to have run)
const REAL_BACKEND_DIR = path.join(__dirname, '..', '..', 'backend');
const REAL_BACKEND = require(path.join(REAL_BACKEND_DIR, 'package.json'));
const { CUSTOM_OWNED_SCRIPTS } = require('@omega.js/backend/ensure-target');

// ─── The retired `npx omega setup` migration (#707) ──────────────────────────

// A pre-#675 backend target verbatim: every framework script chained the
// command #675 retired, so the dev fan-out dies at `Unknown command "setup"`
const STALE_BACKEND_SCRIPTS = {
  start: 'npx omega setup && omega serve',
  deploy: 'npx omega setup && omega deploy',
  emulator: 'npx omega setup && omega emulator',
  test: "node --require ./test/_helpers/connect-trap.js --test 'test/_unit/**/*.test.js'",
  'test:static': 'npm test',
  'test:emulator': 'npx omega setup && omega test',
  setup: 'npx omega setup',
};

module.exports = defineCases({
  type: 'group',
  description: 'workspace-scripts',
  tests: [
    // ─── The heal lib (pure) ─────────────────────────────────────────────────────

    {
      name: 'healPackageScripts: adds deploy when absent, keeps an existing deploy, never rewrites an unrelated value',
      run: (ctx) => {
        const healed = healPackageScripts({ scripts: { start: 'omega-manager', build: 'echo hi' } });
        ctx.expect(healed.scripts, 'the retired bin name is left verbatim — it is not the legacy shape this migration knows; manage is minted beside it').toEqual({ start: 'omega-manager', build: 'echo hi', manage: MANAGE_SCRIPT, deploy: DEPLOY_SCRIPT });
        ctx.expect(healed.changes).toEqual([`manage: '${MANAGE_SCRIPT}'`, `deploy: '${DEPLOY_SCRIPT}'`]);

        const kept = healPackageScripts({ scripts: { start: START_SCRIPT, manage: MANAGE_SCRIPT, deploy: 'my-own-deploy' } });
        ctx.expect(kept.scripts.deploy, 'an existing deploy script is never overwritten').toBe('my-own-deploy');
        ctx.expect(kept.changes).toEqual([]);
      },
    },

    {
      name: 'healPackageScripts: migrates the legacy `start: omega` shape to the dev stack + a manage script',
      run: (ctx) => {
        const migrated = healPackageScripts({
          scripts: { start: 'omega', dev: 'omega dev', deploy: DEPLOY_SCRIPT, pipeline: 'omega pipeline' },
        });
        ctx.expect(migrated.scripts, 'npm start boots the dev stack; the bare manage cycle moves to `manage`; every other script survives').toEqual({
          start: START_SCRIPT,
          dev: 'omega dev',
          deploy: DEPLOY_SCRIPT,
          pipeline: 'omega pipeline',
          manage: MANAGE_SCRIPT,
        });
        ctx.expect(migrated.changes).toEqual([`start: '${START_SCRIPT}'`, `manage: '${MANAGE_SCRIPT}'`]);

        // Second pass over the migrated shape: nothing left to do
        ctx.expect(healPackageScripts({ scripts: migrated.scripts }).changes).toEqual([]);

        // An existing manage script is never overwritten
        const ownManage = healPackageScripts({ scripts: { start: 'omega', manage: 'my-own-manage', deploy: DEPLOY_SCRIPT } });
        ctx.expect(ownManage.scripts.manage).toBe('my-own-manage');
        ctx.expect(ownManage.changes).toEqual([`start: '${START_SCRIPT}'`]);
      },
    },

    {
      name: 'healPackageScripts: migrates the legacy `manage: omega` to the named verb (#229), idempotently',
      run: (ctx) => {
        const migrated = healPackageScripts({
          scripts: { start: START_SCRIPT, manage: 'omega', deploy: DEPLOY_SCRIPT },
        });

        ctx.expect(MANAGE_SCRIPT, 'a bare `omega` prints help now — the script must name the verb').toBe('omega manage');
        ctx.expect(migrated.scripts.manage).toBe(MANAGE_SCRIPT);
        ctx.expect(migrated.changes).toEqual([`manage: '${MANAGE_SCRIPT}'`]);

        // Second pass over the migrated shape: nothing left to do
        ctx.expect(healPackageScripts({ scripts: migrated.scripts }).changes).toEqual([]);

        // A brand that customized its manage script keeps it
        const own = healPackageScripts({ scripts: { start: START_SCRIPT, manage: 'node tools/manage.js', deploy: DEPLOY_SCRIPT } });
        ctx.expect(own.scripts.manage).toBe('node tools/manage.js');
        ctx.expect(own.changes).toEqual([]);
      },
    },

    {
      name: 'healPackageScripts: a customized start value is left alone; manage is still minted so the retry hints answer',
      run: (ctx) => {
        const custom = healPackageScripts({ scripts: { start: 'node server.js', deploy: DEPLOY_SCRIPT } });
        ctx.expect(custom.scripts, 'the customized start survives verbatim; the new manage key overwrites nothing').toEqual({ start: 'node server.js', deploy: DEPLOY_SCRIPT, manage: MANAGE_SCRIPT });
        ctx.expect(custom.changes).toEqual([`manage: '${MANAGE_SCRIPT}'`]);

        // Second pass: converged
        ctx.expect(healPackageScripts({ scripts: custom.scripts }).changes).toEqual([]);
      },
    },

    // ─── The ensure op ───────────────────────────────────────────────────────────

    {
      name: 'scripts op: heals a legacy brand root (deploy + the start/manage migration), leaves every other value verbatim',
      run: async (ctx) => {
        const root = tmpBrand({
          name: 'omegajs.dev',
          private: true,
          workspaces: ['targets/*'],
          scripts: {
            start: 'omega',
            dev: 'omega dev',
            pipeline: 'omega pipeline --require=analytics,disperse,update,bookmark',
          },
          devDependencies: { '@omega.js/manager': '*' },
        });

        const result = await scriptsOp({ brandRoot: root });
        ctx.expect(result.output.scripts).toEqual({
          changed: [`start: '${START_SCRIPT}'`, `manage: '${MANAGE_SCRIPT}'`, `deploy: '${DEPLOY_SCRIPT}'`],
        });

        const pkg = readPkg(root);
        ctx.expect(pkg.scripts).toEqual({
          start: START_SCRIPT,
          dev: 'omega dev',
          pipeline: 'omega pipeline --require=analytics,disperse,update,bookmark',
          manage: MANAGE_SCRIPT,
          deploy: DEPLOY_SCRIPT,
        });
        // Everything else survives verbatim
        ctx.expect(pkg.name).toBe('omegajs.dev');
        ctx.expect(pkg.workspaces).toEqual(['targets/*']);
        ctx.expect(pkg.devDependencies).toEqual({ '@omega.js/manager': '*' });
      },
    },

    {
      name: 'scripts op: converged file is a no-op — null return, byte-identical bytes',
      run: async (ctx) => {
        const root = tmpBrand({ name: 'x', scripts: { start: START_SCRIPT, manage: MANAGE_SCRIPT, deploy: DEPLOY_SCRIPT } });

        const first = await scriptsOp({ brandRoot: root });
        ctx.expect(first).toBe(null);
        const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

        // Heal then rerun — the second pass changes nothing (idempotence)
        const healRoot = tmpBrand({ name: 'y', scripts: { start: 'omega' } });
        await scriptsOp({ brandRoot: healRoot });
        const healedBytes = fs.readFileSync(path.join(healRoot, 'package.json'), 'utf8');
        ctx.expect(await scriptsOp({ brandRoot: healRoot })).toBe(null);
        ctx.expect(fs.readFileSync(path.join(healRoot, 'package.json'), 'utf8')).toBe(healedBytes);

        ctx.expect(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).toBe(before);
      },
    },

    {
      name: 'scripts op: dry run plans and writes nothing',
      run: async (ctx) => {
        const root = tmpBrand({ name: 'x', scripts: { start: 'omega' } });
        const before = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

        const result = await scriptsOp({ brandRoot: root, options: { dryRun: true } });
        ctx.expect(result.output).toEqual({ scripts: 'planned' });
        ctx.expect(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).toBe(before);
      },
    },

    {
      name: 'scripts op: missing package.json is a note (structure scaffolds it), unparseable warns',
      run: async (ctx) => {
        const missing = await scriptsOp({ brandRoot: tmpBrand() });
        ctx.expect(missing.output).toEqual({ scripts: 'missing' });

        const broken = tmpBrand('{ not json');
        const warned = await scriptsOp({ brandRoot: broken });
        ctx.expect(warned.status).toBe('warned');
        ctx.expect(warned.output).toEqual({ scripts: 'unparseable' });
        ctx.expect(fs.readFileSync(path.join(broken, 'package.json'), 'utf8'), 'never touched').toBe('{ not json');
      },
    },

    {
      name: 'scripts op is registered in the workspace OPERATIONS',
      run: (ctx) => {
        const { OPERATIONS } = require('../src/config.js');
        ctx.expect(OPERATIONS.workspace.some((op) => op.name === 'scripts' && op.ensure === true)).toBeTruthy();
      },
    },

    {
      name: 'syncTargetScripts: rewrites every standard key to its default, keeps every consumer-added key (#689)',
      run: (ctx) => {
        const synced = syncTargetScripts(
          { scripts: { test: 'node --test my-own', lint: 'eslint .' } },
          FRAMEWORK_SCRIPTS,
        );
        ctx.expect(synced.scripts, 'a standard key is FRAMEWORK-owned — the hand-edited value is rewritten to the default; a key the framework never declares is the consumer\'s own').toEqual({
          test: 'omega test',
          lint: 'eslint .',
          start: 'omega serve',
          emulator: 'omega emulator',
        });
        ctx.expect(synced.changes).toEqual(["start: 'omega serve'", "emulator: 'omega emulator'", "test: 'omega test'"]);
        ctx.expect(synced.skipped).toEqual([]);

        // Converged: a second pass rewrites nothing
        ctx.expect(syncTargetScripts({ scripts: synced.scripts }, FRAMEWORK_SCRIPTS).changes).toEqual([]);
      },
    },

    {
      name: 'syncTargetScripts: brand-owned keys are never written and never scaffolded — reported as skipped (#689)',
      run: (ctx) => {
        const synced = syncTargetScripts(
          { scripts: { start: 'node server.js', test: 'node --test my-own' } },
          FRAMEWORK_SCRIPTS,
          ['start', 'emulator'],
        );
        ctx.expect(synced.scripts, "the brand's own start survives verbatim, the missing emulator is never scaffolded, and the framework-owned test is rewritten").toEqual({
          start: 'node server.js',
          test: 'omega test',
        });
        ctx.expect(synced.changes).toEqual(["test: 'omega test'"]);
        ctx.expect(synced.skipped, 'the walk reports per key what it left to the brand').toEqual(['start', 'emulator']);

        // Converged: a second pass rewrites nothing
        ctx.expect(syncTargetScripts({ scripts: synced.scripts }, FRAMEWORK_SCRIPTS, ['start', 'emulator']).changes).toEqual([]);
      },
    },

    {
      name: 'scripts op: a script-less scaffolded target gets its framework\'s scripts, the verb table\'s and its declared ones',
      run: async (ctx) => {
        const root = tmpBrand({ name: 'fresh-brand', workspaces: ['targets/*'], scripts: ROOT_OK });
        const framework = { name: '@omega.js/backend', projectScripts: { start: 'omega serve', emulator: 'omega emulator' } };
        plantTarget(root, 'backend',
          { name: 'fresh-brand-backend', version: '0.0.1', private: true, dependencies: { '@omega.js/backend': '*' } },
          '@omega.js/backend',
          framework);

        const result = await scriptsOp(opInput(root));
        const expected = projectScripts(framework);
        ctx.expect(result.output.targetScripts.backend).toEqual(Object.entries(expected).map(([key, value]) => `${key}: '${value}'`));

        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'targets', 'backend', 'package.json'), 'utf8'));
        ctx.expect(pkg.scripts).toEqual(expected);
        ctx.expect(pkg.scripts.emulator, 'the dev fan-out leg exists before any verb ever ran').toBe('omega emulator');
        ctx.expect(pkg.scripts.deploy, 'and so does every verb script the table derives').toBe('omega deploy');
        ctx.expect(pkg.name, 'everything else survives verbatim').toBe('fresh-brand-backend');

        // Second pass: converged, byte-identical
        const bytes = fs.readFileSync(path.join(root, 'targets', 'backend', 'package.json'), 'utf8');
        ctx.expect(await scriptsOp(opInput(root))).toBe(null);
        ctx.expect(fs.readFileSync(path.join(root, 'targets', 'backend', 'package.json'), 'utf8')).toBe(bytes);
      },
    },

    {
      name: 'scripts op: the walk OVERWRITES a hand-edited standard script back to the default, one policy with the verbs (#689)',
      run: async (ctx) => {
        const root = tmpBrand({ name: 'b', workspaces: ['targets/*'], scripts: ROOT_OK });
        plantTarget(root, 'web',
          { name: 'b-web', scripts: { start: 'node my-own-dev.js', build: 'echo mine', lint: 'eslint .' } },
          '@omega.js/web',
          { name: '@omega.js/web', projectScripts: { start: 'omega dev' } });

        const result = await scriptsOp(opInput(root));
        ctx.expect(result.output.targetScripts.web.includes("start: 'omega dev'")).toBeTruthy();
        ctx.expect(result.output.targetScripts.web.includes("build: 'omega build'")).toBeTruthy();
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'targets', 'web', 'package.json'), 'utf8'));
        ctx.expect(pkg.scripts.start, 'the framework owns its own script keys: an edited one is rewritten, hooks are the customization seam').toBe('omega dev');
        ctx.expect(pkg.scripts.build, 'a derived verb script is framework-owned the same way').toBe('omega build');
        ctx.expect(pkg.scripts.lint, 'a key the framework never writes is the consumer\'s own').toBe('eslint .');

        // Second pass: converged, byte-identical
        const bytes = fs.readFileSync(path.join(root, 'targets', 'web', 'package.json'), 'utf8');
        ctx.expect(await scriptsOp(opInput(root))).toBe(null);
        ctx.expect(fs.readFileSync(path.join(root, 'targets', 'web', 'package.json'), 'utf8')).toBe(bytes);
      },
    },

    {
      name: 'scripts op: an uninstalled framework is skipped quietly; one that declares no projectScripts still gets its verb scripts',
      run: async (ctx) => {
        const root = tmpBrand({ name: 'c', workspaces: ['targets/*'], scripts: ROOT_OK });
        plantTarget(root, 'backend', { name: 'c-backend' }); // no node_modules at all
        plantTarget(root, 'web', { name: 'c-web' }, '@omega.js/web', { name: '@omega.js/web' }); // no projectScripts

        const result = await scriptsOp(opInput(root));
        ctx.expect(Object.keys(result.output.targetScripts), 'the uninstalled backend has nothing to heal from').toEqual(['web']);
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'targets', 'web', 'package.json'), 'utf8'));
        ctx.expect(pkg.scripts).toEqual(verbScripts('@omega.js/web'));
      },
    },

    {
      name: 'scripts op: a custom TARGET owns every script — no framework maps to it, so it is skipped whole (#603)',
      run: async (ctx) => {
        const root = tmpBrand({ name: 'e', workspaces: ['targets/*'], scripts: ROOT_OK });
        const serverPath = plantTarget(root, 'server', { name: 'e-server', scripts: {} });
        const before = fs.readFileSync(path.join(serverPath, 'package.json'), 'utf8');

        // Hand-built entry: a custom target carries target null (#603)
        const result = await scriptsOp({
          brandRoot: root,
          targets: [{ name: 'server', dir: 'targets/server', path: serverPath, target: null, custom: true }],
        });
        ctx.expect(result, 'skipped — converged').toBe(null);
        ctx.expect(fs.readFileSync(path.join(serverPath, 'package.json'), 'utf8')).toBe(before);
      },
    },

    {
      name: 'scripts op: a custom-server backend is PER-KEY: the framework-owned subset syncs, its own verbs are left alone (#689)',
      run: async (ctx) => {
        const root = tmpBrand({ name: 'e2', workspaces: ['targets/*'], scripts: ROOT_OK });
        const backendPath = plantTarget(root, 'backend',
          { name: 'e2-backend', dependencies: { '@omega.js/backend': '*' }, scripts: { start: 'node server.js', test: 'echo stale', render: 'render deploy' } },
          '@omega.js/backend',
          REAL_BACKEND);
        // The installed backend's scaffold entry names its brand-owned scripts
        const door = path.join(backendPath, 'node_modules', '@omega.js', 'backend', REAL_BACKEND.exports['./ensure-target']);
        fs.mkdirSync(path.dirname(door), { recursive: true });
        fs.writeFileSync(door, `module.exports = require(${JSON.stringify(require.resolve('@omega.js/backend/ensure-target'))});\n`);

        // A custom-server backend carries projectType 'custom' (#584)
        const entries = [{ name: 'backend', dir: 'targets/backend', path: backendPath, target: 'backend', projectType: 'custom' }];
        const result = await scriptsOp({ brandRoot: root, targets: entries });

        const owned = Object.entries(projectScripts(REAL_BACKEND)).filter(([key]) => !CUSTOM_OWNED_SCRIPTS.includes(key));
        ctx.expect(result.output.targetScripts.backend.sort(), 'only the keys whose verbs still work in custom mode are written').toEqual(owned.map(([key, value]) => `${key}: '${value}'`).sort());

        const pkg = JSON.parse(fs.readFileSync(path.join(backendPath, 'package.json'), 'utf8'));
        ctx.expect(pkg.scripts.start, 'the brand names its own server command (#584)').toBe('node server.js');
        ctx.expect([...CUSTOM_OWNED_SCRIPTS].sort(), 'the keys whose verbs this mode refuses').toEqual(['deploy', 'start']);
        ctx.expect(pkg.scripts.deploy, 'deploy runs a verb this mode refuses: brand-owned, never scaffolded').toBe(undefined);
        ctx.expect(pkg.scripts.test, 'a hand-edited framework-owned key is rewritten to the default: test runs in custom mode').toBe('omega test');
        ctx.expect(pkg.scripts.indexes, 'a derived verb that works in this mode is framework-owned').toBe('omega indexes');
        ctx.expect(pkg.scripts.render, 'a consumer-added key is untouched').toBe('render deploy');

        // Second pass: converged, byte-identical
        const bytes = fs.readFileSync(path.join(backendPath, 'package.json'), 'utf8');
        ctx.expect(await scriptsOp({ brandRoot: root, targets: entries })).toBe(null);
        ctx.expect(fs.readFileSync(path.join(backendPath, 'package.json'), 'utf8')).toBe(bytes);
      },
    },

    {
      name: 'scripts op: an unparseable target manifest WARNS the run instead of reporting converged',
      run: async (ctx) => {
        const root = tmpBrand({ name: 'f', workspaces: ['targets/*'], scripts: ROOT_OK });
        const targetPath = plantTarget(root, 'web', '{ not json',
          '@omega.js/web',
          { name: '@omega.js/web', projectScripts: { start: 'omega dev' } });

        const result = await scriptsOp(opInput(root));
        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.reason).toMatch(/targets\/web\/package\.json doesn't parse/);
        ctx.expect(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'), 'never touched').toBe('{ not json');
      },
    },

    {
      name: 'scripts op: a dry run whose only finding is an unreadable target manifest reports warned, never an empty plan',
      run: async (ctx) => {
        const root = tmpBrand({ name: 'f-dry', workspaces: ['targets/*'], scripts: ROOT_OK });
        plantTarget(root, 'web', '{ not json',
          '@omega.js/web',
          { name: '@omega.js/web', projectScripts: { start: 'omega dev' } });

        // There is nothing to PLAN (no heal, no sync), so the dry run reports exactly
        // what a real run would rather than a plan with no parts in it.
        const result = await scriptsOp(opInput(root, { options: { dryRun: true } }));
        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.reason).toMatch(/targets\/web\/package\.json doesn't parse/);
      },
    },

    {
      name: 'syncTargetScripts: rewrites pre-#675 `npx omega setup` residue to the manifest value, drops the retired key',
      run: (ctx) => {
        const healed = syncTargetScripts({ scripts: { ...STALE_BACKEND_SCRIPTS } }, BACKEND_PROJECT_SCRIPTS);

        ctx.expect(healed.scripts, 'every stale value takes its manifest value; `setup` (no manifest entry, nothing left to run) goes').toEqual(BACKEND_PROJECT_SCRIPTS);
        ctx.expect(JSON.stringify(healed.scripts).includes('omega setup'), 'the boot-after-walk proof: no script still names the retired command').toBe(false);
        ctx.expect(healed.changes).toEqual([
          "start: 'omega serve' (was 'npx omega setup')",
          "deploy: 'omega deploy' (was 'npx omega setup')",
          "emulator: 'omega emulator' (was 'npx omega setup')",
          "test:emulator: 'omega test' (was 'npx omega setup')",
          "setup: removed (was 'npx omega setup')",
        ]);

        // One-time: the healed shape matches nothing on a second pass
        ctx.expect(syncTargetScripts({ scripts: healed.scripts }, BACKEND_PROJECT_SCRIPTS).changes).toEqual([]);
      },
    },

    {
      name: 'syncTargetScripts: a mid-chain retired leg loses just that leg when the manifest no longer names the key',
      run: (ctx) => {
        // The pre-#675 desktop/extension shape — the retired command sat between two
        // live ones, and the key can outlive the manifest declaration
        const healed = syncTargetScripts(
          { scripts: { bundle: 'omega clean && npx omega setup && npm run gulp --' } },
          { start: 'omega clean && npm run gulp --' },
        );
        ctx.expect(healed.scripts.bundle, 'the consumer-named key keeps its own chain minus the retired leg').toBe('omega clean && npm run gulp --');
        ctx.expect(healed.changes).toEqual([
          "bundle: 'omega clean && npm run gulp --' (was 'npx omega setup')",
          "start: 'omega clean && npm run gulp --'",
        ]);

        ctx.expect(syncTargetScripts({ scripts: healed.scripts }, { start: 'omega clean && npm run gulp --' }).changes).toEqual([]);
      },
    },

    {
      name: 'syncTargetScripts: a value that never named the retired command is not MIGRATED — the standard keys still sync (#689)',
      run: (ctx) => {
        const healed = syncTargetScripts(
          { scripts: { start: 'node my-own-dev.js', emulator: 'npx omega emulator --only firestore', setups: 'npx omega setups' } },
          BACKEND_PROJECT_SCRIPTS,
        );
        ctx.expect(healed.scripts.start, 'a standard key is framework-owned in every mode but custom').toBe(BACKEND_PROJECT_SCRIPTS.start);
        ctx.expect(healed.scripts.emulator, 'a customized flag on a standard key goes too — hooks are the seam').toBe(BACKEND_PROJECT_SCRIPTS.emulator);
        ctx.expect(healed.scripts.setups, 'a different command that merely starts the same way survives').toBe('npx omega setups');
        ctx.expect(healed.changes.some((c) => c.includes("(was 'npx omega setup')")), 'nothing migrated').toBe(false);
      },
    },

    {
      name: 'scripts op: a pre-#675 target is healed on the walk — the boot leg lives again, idempotently',
      run: async (ctx) => {
        const root = tmpBrand({ name: 'legacy-brand', workspaces: ['targets/*'], scripts: ROOT_OK });
        plantTarget(root, 'backend',
          { name: 'legacy-brand-backend', version: '0.0.1', private: true, scripts: { ...STALE_BACKEND_SCRIPTS } },
          '@omega.js/backend',
          { name: '@omega.js/backend', projectScripts: BACKEND_PROJECT_SCRIPTS });

        const result = await scriptsOp(opInput(root));
        const migrated = result.output.targetScripts.backend.filter((change) => change.endsWith("(was 'npx omega setup')"));
        ctx.expect(migrated).toEqual([
          "start: 'omega serve' (was 'npx omega setup')",
          "deploy: 'omega deploy' (was 'npx omega setup')",
          "emulator: 'omega emulator' (was 'npx omega setup')",
          "test:emulator: 'omega test' (was 'npx omega setup')",
          "setup: removed (was 'npx omega setup')",
        ]);

        const manifestPath = path.join(root, 'targets', 'backend', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        ctx.expect(pkg.scripts.emulator, 'the dev fan-out leg no longer runs the retired command').toBe('omega emulator');
        ctx.expect(JSON.stringify(pkg.scripts).includes('omega setup')).toBe(false);
        ctx.expect(pkg.name, 'everything else survives verbatim').toBe('legacy-brand-backend');

        // Second pass: converged, byte-identical
        const bytes = fs.readFileSync(manifestPath, 'utf8');
        ctx.expect(await scriptsOp(opInput(root))).toBe(null);
        ctx.expect(fs.readFileSync(manifestPath, 'utf8')).toBe(bytes);
      },
    },

    {
      name: 'scripts op: dry run plans the target heal and writes nothing',
      run: async (ctx) => {
        const root = tmpBrand({ name: 'd', workspaces: ['targets/*'], scripts: ROOT_OK });
        const targetPath = plantTarget(root, 'backend',
          { name: 'd-backend' },
          '@omega.js/backend',
          { name: '@omega.js/backend', projectScripts: { emulator: 'omega emulator' } });
        const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');

        const result = await scriptsOp(opInput(root, { options: { dryRun: true } }));
        ctx.expect(result.output.targetScripts).toEqual('planned');
        ctx.expect(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8')).toBe(before);
      },
    },
  ],
});
