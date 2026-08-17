/**
 * The manager's own `omega`/`omg`/`mgr` bins (#276). A fresh brand-template
 * clone runs `npx omega onboard` before a single app framework is installed —
 * with no `bin` declared, npx fell through to an unrelated public npm package.
 * @omega.js/manager therefore ships the same three bins the frameworks do,
 * through the same omega-bin dispatcher, so the manager winning npm's hoist
 * link at a brand root is still correct inside an app.
 *
 * Real processes, real bin files: what npm links is exactly what runs here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
  const result = spawnSync(process.execPath, [path.join(PKG, 'bin', name), ...args], {
    cwd,
    encoding: 'utf8',
    // The local-dist freshness heal can rebuild and re-exec — a monorepo-dev
    // convenience, not part of this contract. Its documented hatch keeps the
    // run hermetic.
    env: Object.assign({}, process.env, { OMEGA_SKIP_FRESHNESS: '1' }),
  });
  assert.equal(result.status, 0, `bin/${name} ${args.join(' ')} exited ${result.status}\n${result.stderr}`);
  return result;
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
    omega: './bin/omega',
    omg: './bin/omg',
    mgr: './bin/omega',
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
  assert.match(stderr, /no app context found[\s\S]*running @omega\.js\/manager/);

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
    JSON.stringify({ name: 'acme', private: true, workspaces: ['apps/*'], devDependencies: { '@omega.js/manager': '*' } })
  );
  fs.writeFileSync(path.join(scratch, 'config', 'omega.json5'), '{ brand: { id: "acme" } }\n');
  fs.mkdirSync(path.join(scratch, 'node_modules', '@omega.js'), { recursive: true });
  fs.symlinkSync(PKG, path.join(scratch, 'node_modules', '@omega.js', 'manager'), 'dir');

  const { stdout, stderr } = runBin('omega', [], scratch);

  assert.match(stdout, /omega onboard/, 'the manager CLI answered at the brand root');
  assert.doesNotMatch(stderr, /no app context found/, 'the brand root IS a context');
  assert.doesNotMatch(stderr, /is not installed/, 'and its manager resolved from there');

  fs.rmSync(scratch, { recursive: true, force: true });
});

test('bin: inside an app of ANOTHER framework, the manager\'s bin dispatches to that framework', () => {
  // Why the manager wires through the dispatcher instead of straight to its own
  // CLI: in a brand monorepo npm hoists all five packages' `omega` bins and one
  // arbitrary winner gets the .bin link. The manager winning must still run the
  // app's framework.
  const scratch = scratchRepo('omega-manager-bin-app-');
  const appDir = path.join(scratch, 'apps', 'site');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify({ name: 'acme-website', devDependencies: { '@omega.js/web': '*' } })
  );

  // Fake installed framework, hoisted to the brand root (resolution walks up).
  const fwDir = path.join(scratch, 'node_modules', '@omega.js', 'web');
  fs.mkdirSync(fwDir, { recursive: true });
  fs.writeFileSync(
    path.join(fwDir, 'package.json'),
    JSON.stringify({ name: '@omega.js/web', exports: { './cli': './cli.js' } })
  );
  fs.writeFileSync(path.join(fwDir, 'cli.js'), "module.exports = { run() { console.log('WEB-CLI-RAN'); } };");

  const { stdout } = runBin('omega', ['build'], appDir);

  assert.match(stdout, /WEB-CLI-RAN/, 'the app\'s framework ran');
  assert.doesNotMatch(stdout, /OMEGA — brand orchestration/, 'the manager CLI never fired inside an app');

  fs.rmSync(scratch, { recursive: true, force: true });
});
