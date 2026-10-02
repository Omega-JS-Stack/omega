/**
 * Local publish rehearsal, `npm run release:check`: the laptop mirror of CI's
 * pack-smoke. Per publishable: `npm pack` (the real prepare, vendoring included),
 * install the tarball into a scratch project with `overrides` pinning client,
 * backend and mcp-router to their local tarballs, `require.resolve` it, and scan
 * the installed tree with scripts/private-refs.js.
 *
 * Flags:
 *   --only=web,manager   check a subset (the override packages still pack)
 *   --keep               keep the scratch dir for inspection
 */

// Libraries
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanTree } = require('./private-refs');

// Constants
const ROOT = path.join(__dirname, '..');
const PUBLISHABLES = ['backend', 'client', 'desktop', 'extension', 'manager', 'mcp-router', 'web'];
// Always packed even under --only: overrides point at these tarballs
const OVERRIDE_PACKAGES = ['client', 'backend', 'mcp-router'];
// The Claude plugin's manifest: its version gates every machine's update.
const PLUGIN_MANIFEST = path.join('agent-plugins', 'claude', '.claude-plugin', 'plugin.json');

/**
 * Run a command, capturing output; returns { ok, output }.
 * @param {string} command - Executable name.
 * @param {string[]} args - Arguments.
 * @param {object} [options] - spawnSync options (cwd etc.).
 * @returns {{ ok: boolean, output: string }}
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return { ok: result.status === 0, output };
}

/**
 * Detect Socket Firewall once — scratch installs route through it when
 * present (same supply-chain lane as safeInstall()/CI's `sfw npm ci`).
 * @returns {boolean}
 */
function hasSfw() {
  return spawnSync('sfw', ['--version'], { stdio: 'ignore' }).status === 0;
}

/**
 * Pack one workspace package into its own destination dir and return the
 * tarball path. Reads the .tgz from disk — npm's stdout is unusable here
 * (prepare logs and shell wrappers interleave with it).
 * @param {string} name - Short package name (e.g. 'web').
 * @param {string} destRoot - Parent dir for per-package tarball dirs.
 * @returns {{ tarball: string|null, output: string }}
 */
function packPackage(name, destRoot) {
  const dest = path.join(destRoot, name);
  fs.mkdirSync(dest, { recursive: true });
  const result = run('npm', ['pack', `--workspace=packages/${name}`, '--pack-destination', dest], { cwd: ROOT });
  const tgz = fs.existsSync(dest) ? fs.readdirSync(dest).find((f) => f.endsWith('.tgz')) : null;
  return { tarball: tgz ? path.join(dest, tgz) : null, output: result.output };
}

/**
 * Lockstep check: the root package.json, every publishable and the Claude
 * plugin manifest carry the SAME version, the one the `chore(release)` commit
 * sets by hand. The plugin's version is what moves every machine's installed
 * copy, so it follows releases too. Reads the manifests, never the packed
 * tarballs, so an off version fails before anything is packed.
 * @param {string} [root] - the monorepo root to read
 * @returns {{ ok: boolean, detail: string }}
 */
function checkLockstepVersions(root = ROOT) {
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).version;
  const family = read(path.join(root, 'package.json'));
  const off = [
    ...PUBLISHABLES.map((name) => ({ name, version: read(path.join(root, 'packages', name, 'package.json')) })),
    { name: 'plugin', version: read(path.join(root, PLUGIN_MANIFEST)) },
  ].filter((entry) => entry.version !== family);

  if (off.length === 0) {
    return { ok: true, detail: family };
  }

  return { ok: false, detail: `root ${family}; ${off.map((entry) => `${entry.name} ${entry.version}`).join(', ')}` };
}

function main() {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()) : null;

  const checkList = PUBLISHABLES.filter((name) => !only || only.includes(name));
  if (checkList.length === 0) {
    console.error(`release-check: --only matched nothing (valid: ${PUBLISHABLES.join(', ')})`);
    process.exit(1);
  }

  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-release-check-'));
  const tarballRoot = path.join(scratchRoot, 'tarballs');
  const sfw = hasSfw();
  console.log(`release-check: scratch ${scratchRoot} (${sfw ? 'sfw-guarded installs' : 'plain npm installs — sfw not found'})`);

  // 1. Pack — everything being checked, plus the override tarballs
  const packList = [...new Set([...OVERRIDE_PACKAGES, ...checkList])];
  const tarballs = {};
  packList.forEach((name, i) => {
    process.stdout.write(`[${i + 1}/${packList.length}] pack ${name}… `);
    const { tarball, output } = packPackage(name, tarballRoot);
    tarballs[name] = tarball;
    console.log(tarball ? path.basename(tarball) : 'FAILED');
    if (!tarball) {
      console.error(output.trim().split('\n').slice(-15).join('\n'));
    }
  });

  // 2–4. Install each into a scratch project, resolve, scan
  const results = [];
  checkList.forEach((name, i) => {
    const label = `[${i + 1}/${checkList.length}] check ${name}`;
    const result = { name, pack: Boolean(tarballs[name]), install: false, resolve: false, hits: [], files: 0, bytes: 0 };
    results.push(result);

    if (!result.pack) {
      console.log(`${label} — SKIP (pack failed)`);
      return;
    }

    const scratch = path.join(scratchRoot, `scratch-${name}`);
    fs.mkdirSync(scratch, { recursive: true });

    // Overrides pin published @omega.js runtime deps to local tarballs
    // (never the package itself — overriding a direct dep conflicts)
    const overrides = {};
    for (const dep of OVERRIDE_PACKAGES) {
      if (dep !== name && tarballs[dep]) {
        overrides[`@omega.js/${dep}`] = `file:${tarballs[dep]}`;
      }
    }
    fs.writeFileSync(path.join(scratch, 'package.json'), `${JSON.stringify({
      name: `scratch-${name}`,
      private: true,
      overrides,
    }, null, 2)}\n`);

    process.stdout.write(`${label} — install… `);
    const installArgs = ['install', '--no-audit', '--no-fund', '--loglevel=error', tarballs[name]];
    const install = sfw
      ? run('sfw', ['npm', ...installArgs], { cwd: scratch })
      : run('npm', installArgs, { cwd: scratch });
    result.install = install.ok;
    if (!install.ok) {
      console.log('FAILED');
      console.error(install.output.trim().split('\n').slice(-12).join('\n'));
      return;
    }

    const fullName = `@omega.js/${name}`;
    const resolve = run(process.execPath, ['-e', 'require.resolve(process.argv[1])', fullName], { cwd: scratch });
    result.resolve = resolve.ok;

    const installedDir = path.join(scratch, 'node_modules', '@omega.js', name);
    const scan = scanTree(installedDir);
    result.hits = scan.hits;
    result.files = scan.files;
    result.bytes = scan.bytes;

    const mb = (scan.bytes / (1024 * 1024)).toFixed(1);
    console.log(`install ✓ · resolve ${resolve.ok ? '✓' : '✗'} · ${scan.files} files, ${mb}MB · private refs: ${scan.hits.length}`);
    if (!resolve.ok) {
      console.error(resolve.output.trim().split('\n').slice(-6).join('\n'));
    }
    if (scan.hits.length > 0) {
      scan.hits.slice(0, 10).forEach((hit) => console.error(`    raw private ref: ${hit}`));
      if (scan.hits.length > 10) console.error(`    … and ${scan.hits.length - 10} more`);
    }
  });

  // Summary
  console.log('\n━━━ release-check summary ━━━');
  let failed = false;

  // Lockstep (#794): the family ships ONE version number, so a mixed set of
  // manifest versions is a red check here — before a publish can put two
  // numbers on the registry for one release.
  const lockstep = checkLockstepVersions();
  if (!lockstep.ok) failed = true;
  console.log(`  ${lockstep.ok ? '✓' : '✗'} one version across the family (${lockstep.detail})`);

  for (const r of results) {
    const ok = r.pack && r.install && r.resolve && r.hits.length === 0;
    if (!ok) failed = true;
    const detail = !r.pack ? 'pack failed'
      : !r.install ? 'install failed'
      : !r.resolve ? 'resolve failed'
      : r.hits.length > 0 ? `${r.hits.length} raw private refs`
      : `${(r.bytes / (1024 * 1024)).toFixed(1)}MB unpacked`;
    console.log(`  ${ok ? '✓' : '✗'} @omega.js/${r.name} (${detail})`);
  }

  if (keep) {
    console.log(`\nscratch kept: ${scratchRoot}`);
  } else {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }

  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  main();
}

// PUBLISHABLES is the one home of what publishes; the lockstep test reads it.
module.exports = { PUBLISHABLES, checkLockstepVersions };
