/**
 * The manager's own `omega`/`omg`/`mgr` bins (#276). A fresh brand-template
 * clone runs `npx omega onboard` before a single target framework is installed —
 * with no `bin` declared, npx fell through to an unrelated public npm package.
 * @omega.js/manager therefore ships the same three bins the frameworks do,
 * through the same omega-bin dispatcher, so the manager winning npm's hoist
 * link at a brand root is still correct inside a target.
 *
 * Real processes, real bin files: what npm links is exactly what runs here.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// The machine registry is per-machine state: this file's fixtures record into a temp home.
require('@omega.js/devkit/test/temp-home');

const { VERBS } = require('@omega.js/devkit/verbs');
const { createMachine } = require('./lib/fake-claude.js');
const { activate: activateGh } = require('./lib/fake-gh.js');
const { snapshot } = require('./lib/tree-snapshot.js');

const PKG = path.join(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));

/**
 * Run one of the manager's bin files as a real process.
 * @param {Function} expect - The calling case's `ctx.expect`.
 * @param {string} name - Bin file name under bin/.
 * @param {string[]} args - CLI arguments.
 * @param {string} cwd - Working directory the dispatcher resolves from.
 * @returns {{ stdout: string, stderr: string }}
 */
function runBin(expect, name, args, cwd) {
  const result = spawnBin(name, args, cwd);
  expect(result.status, `bin/${name} ${args.join(' ')} exited ${result.status}\n${result.stderr}`).toBe(0);
  return result;
}

/**
 * Run one of the manager's bin files as a real process, whatever its exit.
 * @param {string} name - Bin file name under bin/.
 * @param {string[]} args - CLI arguments.
 * @param {string} cwd - Working directory the dispatcher resolves from.
 * @param {object} [env] - The child's env; by default this one with the freshness heal held off.
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function spawnBin(name, args, cwd, env = Object.assign({}, process.env, { OMEGA_SKIP_FRESHNESS: '1' })) {
  return spawnSync(process.execPath, [path.join(PKG, 'bin', name), ...args], {
    cwd,
    encoding: 'utf8',
    // The local-dist freshness heal can rebuild and re-exec — a monorepo-dev
    // convenience, not part of this contract. Its documented hatch keeps the
    // run hermetic.
    env,
  });
}

/** A scratch dir with a .git so the dispatcher's walk stays inside it. */
function scratchRepo(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  return dir;
}

/**
 * A brand with the manager installed at its root (linked to this package) and
 * one web target, whose framework is a fake that only announces itself.
 * @returns {{ scratch: string, targetDir: string }}
 */
function stageBrandWithTarget(prefix) {
  const scratch = fs.realpathSync(scratchRepo(prefix));
  fs.mkdirSync(path.join(scratch, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(scratch, 'package.json'),
    JSON.stringify({ name: 'acme', private: true, workspaces: ['targets/*'], devDependencies: { '@omega.js/manager': '*' } })
  );
  fs.writeFileSync(path.join(scratch, 'config', 'omega.json5'), '{ brand: { id: "acme" }, targets: { site: { type: "web" } } }\n');
  fs.mkdirSync(path.join(scratch, 'node_modules', '@omega.js'), { recursive: true });
  fs.symlinkSync(PKG, path.join(scratch, 'node_modules', '@omega.js', 'manager'), 'dir');

  const targetDir = path.join(scratch, 'targets', 'site');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
    JSON.stringify({ name: 'acme-website', devDependencies: { '@omega.js/web': '*' } })
  );
  const fwDir = path.join(scratch, 'node_modules', '@omega.js', 'web');
  fs.mkdirSync(fwDir, { recursive: true });
  fs.writeFileSync(
    path.join(fwDir, 'package.json'),
    JSON.stringify({ name: '@omega.js/web', exports: { './cli': './cli.js' } })
  );
  fs.writeFileSync(path.join(fwDir, 'cli.js'), "module.exports = { run() { console.log('WEB-CLI-RAN'); } };");

  return { scratch, targetDir };
}

module.exports = defineCases({
  type: 'group',
  description: 'bin',
  tests: [
    {
      name: 'package: the manager declares the frameworks\' three bins, and ships them',
      run: (ctx) => {
        // Parity with every framework's bin block — `mgr` is the same file as
        // `omega`, and the retired `omega-manager` name never comes back.
        ctx.expect(MANIFEST.bin).toEqual({
          omega: 'bin/omega',
          omg: 'bin/omg',
          mgr: 'bin/omega',
        });
        ctx.expect(MANIFEST.files.includes('bin/'), 'the published tarball carries the bin files').toBeTruthy();

        for (const relative of new Set(Object.values(MANIFEST.bin))) {
          const abs = path.join(PKG, relative);
          ctx.expect(fs.existsSync(abs), `${relative} exists`).toBeTruthy();
          ctx.expect(fs.readFileSync(abs, 'utf8'), `${relative} is a node script`).toMatch(/^#!\/usr\/bin\/env node\n/);
          ctx.expect(fs.statSync(abs).mode & 0o111, `${relative} is executable`).toBeTruthy();
        }
      },
    },

    {
      name: 'bin: a fresh dir with nothing installed answers with the manager CLI (npx omega onboard\'s home)',
      run: (ctx) => {
        const scratch = scratchRepo('omega-manager-bin-fresh-');

        const { stdout, stderr } = runBin(ctx.expect, 'omega', [], scratch);

        ctx.expect(stdout, 'the manager\'s own help, not another package\'s').toMatch(/OMEGA — brand orchestration/);
        ctx.expect(stdout, 'the verb a stranger with an empty clone needs').toMatch(/omega onboard/);
        // The bootstrap note only the dispatcher prints — the bin routes through
        // omega-bin, it is not hard-wired straight to the manager CLI.
        ctx.expect(stderr).toMatch(/no target context found[\s\S]*running @omega\.js\/manager/);

        fs.rmSync(scratch, { recursive: true, force: true });
      },
    },

    {
      name: 'bin: omg is the same entry as omega',
      run: (ctx) => {
        const scratch = scratchRepo('omega-manager-bin-omg-');

        ctx.expect(runBin(ctx.expect, 'omg', [], scratch).stdout).toBe(runBin(ctx.expect, 'omega', [], scratch).stdout);

        fs.rmSync(scratch, { recursive: true, force: true });
      },
    },

    {
      name: 'bin: at a brand root with the manager installed, the bin runs the INSTALLED manager\'s CLI',
      run: (ctx) => {
        // The fresh-clone case proper: the brand template declares @omega.js/manager,
        // `npm install` links its bin, and `npx omega onboard` has to land here.
        const scratch = scratchRepo('omega-manager-bin-brand-');
        fs.mkdirSync(path.join(scratch, 'config'), { recursive: true });
        fs.writeFileSync(
          path.join(scratch, 'package.json'),
          JSON.stringify({ name: 'acme', private: true, workspaces: ['targets/*'], devDependencies: { '@omega.js/manager': '*' } })
        );
        fs.writeFileSync(path.join(scratch, 'config', 'omega.json5'), '{ brand: { id: "acme" } }\n');
        fs.mkdirSync(path.join(scratch, 'node_modules', '@omega.js'), { recursive: true });
        fs.symlinkSync(PKG, path.join(scratch, 'node_modules', '@omega.js', 'manager'), 'dir');

        const { stdout, stderr } = runBin(ctx.expect, 'omega', [], scratch);

        ctx.expect(stdout, 'the manager CLI answered at the brand root').toMatch(/omega onboard/);
        ctx.expect(stderr, 'the brand root IS a context').not.toMatch(/no target context found/);
        ctx.expect(stderr, 'and its manager resolved from there').not.toMatch(/is not installed/);

        fs.rmSync(scratch, { recursive: true, force: true });
      },
    },

    {
      name: 'bin: inside a target, the manager\'s bin hands a verb the target owns to the target\'s framework',
      run: (ctx) => {
        // The manager winning npm's bin link inside a target never runs the manager there
        const { scratch, targetDir } = stageBrandWithTarget('omega-manager-bin-target-');

        const { status, stdout, stderr } = spawnBin('omega', ['build'], targetDir);

        ctx.expect(status, stderr).toBe(0);
        ctx.expect(stdout, 'the target\'s framework ran in place').toMatch(/WEB-CLI-RAN/);
        ctx.expect(stdout, 'the manager did not').not.toMatch(/brand orchestration/);

        fs.rmSync(scratch, { recursive: true, force: true });
      },
    },

    {
      name: 'bin: inside a target, a brand-wide verb refuses and prints the brand root form',
      run: (ctx) => {
        const { scratch, targetDir } = stageBrandWithTarget('omega-manager-bin-brandwide-');

        const { status, stdout, stderr } = spawnBin('omega', ['install', 'local'], targetDir);

        ctx.expect(status, stderr).toBe(1);
        ctx.expect(stdout, 'the target\'s framework never ran').not.toMatch(/WEB-CLI-RAN/);
        ctx.expect(stdout, 'nor did the manager').not.toMatch(/brand orchestration/);
        ctx.expect(stderr.includes(`cd ${scratch} && npx omega install local`), stderr).toBeTruthy();

        fs.rmSync(scratch, { recursive: true, force: true });
      },
    },

    {
      name: 'bin: at the brand root, `omega test --target=` still dispatches to the manager',
      run: (ctx) => {
        // The picker is the manager's to read: an unknown token earns ITS refusal,
        // naming the brand's real targets, and no target CLI starts.
        const { scratch } = stageBrandWithTarget('omega-manager-bin-picker-');

        const { status, stdout, stderr } = spawnBin('omega', ['test', '--target=nope'], scratch);

        ctx.expect(status).not.toBe(0);
        ctx.expect(stdout).not.toMatch(/WEB-CLI-RAN/);
        ctx.expect(`${stdout}${stderr}`).toMatch(/Unknown --target token "nope": this brand's targets are site\. Nothing ran\./);

        fs.rmSync(scratch, { recursive: true, force: true });
      },
    },

    {
      name: 'bin: at the brand root, `omega migrate` runs the manager\'s ONE verb: a report, exit 1 while steps are due',
      run: (ctx) => {
        const { scratch } = stageBrandWithTarget('omega-manager-bin-migrate-');
        // A retired key the config pass reports, beside the target the walk visits
        fs.writeFileSync(
          path.join(scratch, 'config', 'omega.json5'),
          '{ brand: { id: "acme" }, slapform: { endpoint: "https://slapform.test/f/abc" }, targets: { site: { type: "web" } } }\n',
        );
        const before = fs.readFileSync(path.join(scratch, 'config', 'omega.json5'), 'utf8');
        // …and a renamed env key in the brand root .env, its value a marker never printed
        const env = 'OAUTH2_GOOGLE_CLIENT_ID="bin-value-marker"\n';
        fs.writeFileSync(path.join(scratch, '.env'), env);

        const { status, stdout, stderr } = spawnBin('omega', ['migrate'], scratch);

        ctx.expect(status, `${stdout}\n${stderr}`).toBe(1);
        ctx.expect(stdout, 'the config pass reported the retired key').toMatch(/remove slapform/);
        ctx.expect(stdout, 'the env pass reported the renamed key').toMatch(/rename OAUTH2_GOOGLE_CLIENT_ID → CONNECTIONS_GOOGLE_CLIENT_ID/);
        ctx.expect(!`${stdout}${stderr}`.includes('bin-value-marker'), 'an env value never reaches the report').toBeTruthy();
        ctx.expect(fs.readFileSync(path.join(scratch, '.env'), 'utf8'), 'a report writes no .env either').toBe(env);
        ctx.expect(stdout, 'the walk visited the target, headed by its name').toMatch(/^site/m);
        ctx.expect(stdout, 'a framework with no migrate entry is a loud error line, never a skip').toMatch(/error\s+@omega\.js\/web exposes no migrate entry \(update it\)/);
        ctx.expect(stdout, 'no framework CLI started: the leg runs in-process').not.toMatch(/WEB-CLI-RAN/);
        ctx.expect(stdout.trimEnd().split('\n').pop(), 'the report ends on the register line').toMatch(/docs\/shared\/breaking-changes\.md/);
        ctx.expect(fs.readFileSync(path.join(scratch, 'config', 'omega.json5'), 'utf8'), 'a report writes nothing').toBe(before);

        fs.rmSync(scratch, { recursive: true, force: true });
      },
    },

    {
      name: '#1031 case 10: `omega status` typed inside a target is the manager\'s, reporting from the brand root',
      run: (ctx) => {
        const { scratch, targetDir } = stageBrandWithTarget('omega-manager-bin-status-');

        const { stdout, stderr } = spawnBin('omega', ['status', '--json'], targetDir);

        ctx.expect(stdout, 'the target\'s framework never ran').not.toMatch(/WEB-CLI-RAN/);
        ctx.expect(stderr, stderr).not.toMatch(/refusing|runs at the brand root/);
        const report = JSON.parse(stdout);
        ctx.expect(report.brandRoot).toBe(scratch);
        ctx.expect(JSON.stringify(report.inTarget).includes('"site"'), `inTarget names the target: ${stdout}`).toBeTruthy();

        fs.rmSync(scratch, { recursive: true, force: true });
      },
    },

    {
      name: '#1031 status reads only: no boot prelude and no freshness heal runs, so the origin, the brand and stdout stay clean',
      run: (ctx) => {
        // An origin the heal would move, a gh that answers with the move, and the manager linked to this checkout
        const { scratch } = stageBrandWithTarget('omega-manager-bin-status-prelude-');
        const origin = 'https://github.com/old-owner/acme-omega.git';
        const git = (...args) => spawnSync('git', ['-C', scratch, ...args], { encoding: 'utf8' }).stdout.trim();
        git('init', '-q');
        git('remote', 'add', 'origin', origin);
        const ghDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-moved-gh-'));
        const ghLog = path.join(ghDir, 'calls.log');
        fs.writeFileSync(path.join(ghDir, 'gh'), `#!/bin/sh\necho "$@" >> "${ghLog}"\necho '{"full_name":"moved-owner/acme-omega"}'\n`, { mode: 0o755 });
        const env = { ...process.env, PATH: [ghDir, process.env.PATH].join(path.delimiter) };
        delete env.OMEGA_SKIP_FRESHNESS;
        const before = snapshot(scratch);

        const { stdout, stderr } = spawnBin('omega', ['status', '--json'], scratch, env);

        ctx.expect(() => JSON.parse(stdout), `stdout is one JSON object:\n${stdout}\n${stderr}`).not.toThrow();
        ctx.expect(git('remote', 'get-url', 'origin'), 'the origin heal never ran').toBe(origin);
        ctx.expect(fs.existsSync(ghLog), 'gh was never asked').toBe(false);
        ctx.expect(snapshot(scratch), 'no file under the brand changed').toEqual(before);

        fs.rmSync(scratch, { recursive: true, force: true });
        fs.rmSync(ghDir, { recursive: true, force: true });
      },
    },

    {
      name: '#1031 case 10: `omega status` typed in a folder with no brand is the manager\'s',
      run: (ctx) => {
        const scratch = fs.realpathSync(scratchRepo('omega-manager-bin-status-nobrand-'));
        fs.writeFileSync(path.join(scratch, 'notes.txt'), 'not a brand\n');

        const { stdout, stderr } = spawnBin('omega', ['status', '--json'], scratch);

        ctx.expect(stderr).toMatch(/running @omega\.js\/manager/);
        ctx.expect(JSON.parse(stdout).state, stdout).toBe('unrelated');

        fs.rmSync(scratch, { recursive: true, force: true });
      },
    },

    {
      name: '#1031 case 10: `omega onboard` typed inside a target is the manager\'s',
      run: (ctx) => {
        // A fake claude and gh, so the wizard's machine checks never reach the real ones
        ctx.after(createMachine({
          marketplaces: { omega: { source: 'github', repo: 'Omega-JS-Stack/omega' } },
          installed: { 'omega@omega': MANIFEST.version },
          published: MANIFEST.version,
        }).activate());
        activateGh();
        const { scratch, targetDir } = stageBrandWithTarget('omega-manager-bin-onboard-');

        const { status, stdout, stderr } = spawnBin('omega', ['onboard', '--dry-run'], targetDir);

        ctx.expect(status, `${stdout}\n${stderr}`).toBe(0);
        ctx.expect(stdout, 'the target\'s framework never ran').not.toMatch(/WEB-CLI-RAN/);
        ctx.expect(stdout, 'the manager\'s wizard answered').toMatch(/Onboarding/);
        ctx.expect(stdout, 'and wrote nothing').toMatch(/Dry run/);

        fs.rmSync(scratch, { recursive: true, force: true });
      },
    },

    {
      name: 'help: every verb the manager owns in the verb table is in its help list',
      run: (ctx) => {
        const scratch = scratchRepo('omega-manager-bin-help-');
        const { stdout } = runBin(ctx.expect, 'omega', ['help'], scratch);

        const owned = VERBS.filter((row) => row.owners.includes('@omega.js/manager') && row.name !== 'help');
        const unlisted = owned.map((row) => row.name).filter((name) => !new RegExp(`omega ${name}\\b`).test(stdout));
        ctx.expect(unlisted, `verbs the help list leaves out:\n${stdout}`).toEqual([]);

        fs.rmSync(scratch, { recursive: true, force: true });
      },
    },

    {
      name: 'bin: inside a target, `omega migrate` refuses and prints the brand root form',
      run: (ctx) => {
        const { scratch, targetDir } = stageBrandWithTarget('omega-manager-bin-migrate-target-');

        const { status, stdout, stderr } = spawnBin('omega', ['migrate'], targetDir);

        ctx.expect(status, stderr).toBe(1);
        ctx.expect(stdout).not.toMatch(/WEB-CLI-RAN/);
        ctx.expect(stderr.includes(`cd ${scratch} && npx omega migrate`), stderr).toBeTruthy();
        ctx.expect(stderr, 'a brand-wide verb picks no target').not.toMatch(/--target=/);

        fs.rmSync(scratch, { recursive: true, force: true });
      },
    },
  ],
});
