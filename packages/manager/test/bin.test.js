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
const test = require('node:test');
const assert = require('node:assert/strict');
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
 * @param {string} name - Bin file name under bin/.
 * @param {string[]} args - CLI arguments.
 * @param {string} cwd - Working directory the dispatcher resolves from.
 * @returns {{ stdout: string, stderr: string }}
 */
function runBin(name, args, cwd) {
  const result = spawnBin(name, args, cwd);
  assert.equal(result.status, 0, `bin/${name} ${args.join(' ')} exited ${result.status}\n${result.stderr}`);
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

test('package: the manager declares the frameworks\' three bins, and ships them', () => {
  // Parity with every framework's bin block — `mgr` is the same file as
  // `omega`, and the retired `omega-manager` name never comes back.
  assert.deepEqual(MANIFEST.bin, {
    omega: 'bin/omega',
    omg: 'bin/omg',
    mgr: 'bin/omega',
  });
  assert.ok(MANIFEST.files.includes('bin/'), 'the published tarball carries the bin files');

  for (const relative of new Set(Object.values(MANIFEST.bin))) {
    const abs = path.join(PKG, relative);
    assert.ok(fs.existsSync(abs), `${relative} exists`);
    assert.match(fs.readFileSync(abs, 'utf8'), /^#!\/usr\/bin\/env node\n/, `${relative} is a node script`);
    assert.ok(fs.statSync(abs).mode & 0o111, `${relative} is executable`);
  }
});

test('bin: a fresh dir with nothing installed answers with the manager CLI (npx omega onboard\'s home)', () => {
  const scratch = scratchRepo('omega-manager-bin-fresh-');

  const { stdout, stderr } = runBin('omega', [], scratch);

  assert.match(stdout, /OMEGA — brand orchestration/, 'the manager\'s own help, not another package\'s');
  assert.match(stdout, /omega onboard/, 'the verb a stranger with an empty clone needs');
  // The bootstrap note only the dispatcher prints — the bin routes through
  // omega-bin, it is not hard-wired straight to the manager CLI.
  assert.match(stderr, /no target context found[\s\S]*running @omega\.js\/manager/);

  fs.rmSync(scratch, { recursive: true, force: true });
});

test('bin: omg is the same entry as omega', () => {
  const scratch = scratchRepo('omega-manager-bin-omg-');

  assert.equal(runBin('omg', [], scratch).stdout, runBin('omega', [], scratch).stdout);

  fs.rmSync(scratch, { recursive: true, force: true });
});

test('bin: at a brand root with the manager installed, the bin runs the INSTALLED manager\'s CLI', () => {
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

  const { stdout, stderr } = runBin('omega', [], scratch);

  assert.match(stdout, /omega onboard/, 'the manager CLI answered at the brand root');
  assert.doesNotMatch(stderr, /no target context found/, 'the brand root IS a context');
  assert.doesNotMatch(stderr, /is not installed/, 'and its manager resolved from there');

  fs.rmSync(scratch, { recursive: true, force: true });
});

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

test('bin: inside a target, the manager\'s bin hands a verb the target owns to the target\'s framework', () => {
  // The manager winning npm's bin link inside a target never runs the manager there
  const { scratch, targetDir } = stageBrandWithTarget('omega-manager-bin-target-');

  const { status, stdout, stderr } = spawnBin('omega', ['build'], targetDir);

  assert.equal(status, 0, stderr);
  assert.match(stdout, /WEB-CLI-RAN/, 'the target\'s framework ran in place');
  assert.doesNotMatch(stdout, /brand orchestration/, 'the manager did not');

  fs.rmSync(scratch, { recursive: true, force: true });
});

test('bin: inside a target, a brand-wide verb refuses and prints the brand root form', () => {
  const { scratch, targetDir } = stageBrandWithTarget('omega-manager-bin-brandwide-');

  const { status, stdout, stderr } = spawnBin('omega', ['install', 'local'], targetDir);

  assert.equal(status, 1, stderr);
  assert.doesNotMatch(stdout, /WEB-CLI-RAN/, 'the target\'s framework never ran');
  assert.doesNotMatch(stdout, /brand orchestration/, 'nor did the manager');
  assert.ok(stderr.includes(`cd ${scratch} && npx omega install local`), stderr);

  fs.rmSync(scratch, { recursive: true, force: true });
});

test('bin: at the brand root, `omega test --target=` still dispatches to the manager', () => {
  // The picker is the manager's to read: an unknown token earns ITS refusal,
  // naming the brand's real targets, and no target CLI starts.
  const { scratch } = stageBrandWithTarget('omega-manager-bin-picker-');

  const { status, stdout, stderr } = spawnBin('omega', ['test', '--target=nope'], scratch);

  assert.notEqual(status, 0);
  assert.doesNotMatch(stdout, /WEB-CLI-RAN/);
  assert.match(`${stdout}${stderr}`, /Unknown --target token "nope": this brand's targets are site\. Nothing ran\./);

  fs.rmSync(scratch, { recursive: true, force: true });
});

test('bin: at the brand root, `omega migrate` runs the manager\'s ONE verb: a report, exit 1 while steps are due', () => {
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

  assert.equal(status, 1, `${stdout}\n${stderr}`);
  assert.match(stdout, /remove slapform/, 'the config pass reported the retired key');
  assert.match(stdout, /rename OAUTH2_GOOGLE_CLIENT_ID → CONNECTIONS_GOOGLE_CLIENT_ID/, 'the env pass reported the renamed key');
  assert.ok(!`${stdout}${stderr}`.includes('bin-value-marker'), 'an env value never reaches the report');
  assert.equal(fs.readFileSync(path.join(scratch, '.env'), 'utf8'), env, 'a report writes no .env either');
  assert.match(stdout, /^site/m, 'the walk visited the target, headed by its name');
  assert.match(stdout, /error\s+@omega\.js\/web exposes no migrate entry \(update it\)/, 'a framework with no migrate entry is a loud error line, never a skip');
  assert.doesNotMatch(stdout, /WEB-CLI-RAN/, 'no framework CLI started: the leg runs in-process');
  assert.match(stdout.trimEnd().split('\n').pop(), /docs\/shared\/breaking-changes\.md/, 'the report ends on the register line');
  assert.equal(fs.readFileSync(path.join(scratch, 'config', 'omega.json5'), 'utf8'), before, 'a report writes nothing');

  fs.rmSync(scratch, { recursive: true, force: true });
});

test('#1031 case 10: `omega status` typed inside a target is the manager\'s, reporting from the brand root', () => {
  const { scratch, targetDir } = stageBrandWithTarget('omega-manager-bin-status-');

  const { stdout, stderr } = spawnBin('omega', ['status', '--json'], targetDir);

  assert.doesNotMatch(stdout, /WEB-CLI-RAN/, 'the target\'s framework never ran');
  assert.doesNotMatch(stderr, /refusing|runs at the brand root/, stderr);
  const report = JSON.parse(stdout);
  assert.equal(report.brandRoot, scratch);
  assert.ok(JSON.stringify(report.inTarget).includes('"site"'), `inTarget names the target: ${stdout}`);

  fs.rmSync(scratch, { recursive: true, force: true });
});

test('#1031 status reads only: no boot prelude and no freshness heal runs, so the origin, the brand and stdout stay clean', () => {
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

  assert.doesNotThrow(() => JSON.parse(stdout), `stdout is one JSON object:\n${stdout}\n${stderr}`);
  assert.equal(git('remote', 'get-url', 'origin'), origin, 'the origin heal never ran');
  assert.equal(fs.existsSync(ghLog), false, 'gh was never asked');
  assert.deepEqual(snapshot(scratch), before, 'no file under the brand changed');

  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(ghDir, { recursive: true, force: true });
});

test('#1031 case 10: `omega status` typed in a folder with no brand is the manager\'s', () => {
  const scratch = fs.realpathSync(scratchRepo('omega-manager-bin-status-nobrand-'));
  fs.writeFileSync(path.join(scratch, 'notes.txt'), 'not a brand\n');

  const { stdout, stderr } = spawnBin('omega', ['status', '--json'], scratch);

  assert.match(stderr, /running @omega\.js\/manager/);
  assert.equal(JSON.parse(stdout).state, 'unrelated', stdout);

  fs.rmSync(scratch, { recursive: true, force: true });
});

test('#1031 case 10: `omega onboard` typed inside a target is the manager\'s', (t) => {
  // A fake claude and gh, so the wizard's machine checks never reach the real ones
  t.after(createMachine({
    marketplaces: { omega: { source: 'github', repo: 'Omega-JS-Stack/omega' } },
    installed: { 'omega@omega': MANIFEST.version },
    published: MANIFEST.version,
  }).activate());
  activateGh();
  const { scratch, targetDir } = stageBrandWithTarget('omega-manager-bin-onboard-');

  const { status, stdout, stderr } = spawnBin('omega', ['onboard', '--dry-run'], targetDir);

  assert.equal(status, 0, `${stdout}\n${stderr}`);
  assert.doesNotMatch(stdout, /WEB-CLI-RAN/, 'the target\'s framework never ran');
  assert.match(stdout, /Onboarding/, 'the manager\'s wizard answered');
  assert.match(stdout, /Dry run/, 'and wrote nothing');

  fs.rmSync(scratch, { recursive: true, force: true });
});

test('help: every verb the manager owns in the verb table is in its help list', () => {
  const scratch = scratchRepo('omega-manager-bin-help-');
  const { stdout } = runBin('omega', ['help'], scratch);

  const owned = VERBS.filter((row) => row.owners.includes('@omega.js/manager') && row.name !== 'help');
  const unlisted = owned.map((row) => row.name).filter((name) => !new RegExp(`omega ${name}\\b`).test(stdout));
  assert.deepEqual(unlisted, [], `verbs the help list leaves out:\n${stdout}`);

  fs.rmSync(scratch, { recursive: true, force: true });
});

test('bin: inside a target, `omega migrate` refuses and prints the brand root form', () => {
  const { scratch, targetDir } = stageBrandWithTarget('omega-manager-bin-migrate-target-');

  const { status, stdout, stderr } = spawnBin('omega', ['migrate'], targetDir);

  assert.equal(status, 1, stderr);
  assert.doesNotMatch(stdout, /WEB-CLI-RAN/);
  assert.ok(stderr.includes(`cd ${scratch} && npx omega migrate`), stderr);
  assert.doesNotMatch(stderr, /--target=/, 'a brand-wide verb picks no target');

  fs.rmSync(scratch, { recursive: true, force: true });
});
