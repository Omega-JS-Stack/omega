/**
 * Local publish rehearsal — `npm run release:check`.
 *
 * The mechanical gate for the publish-proving checkpoint: proves every
 * publishable would survive `npm publish` TODAY, without publishing
 * anything. CI's pack-smoke (ci.yml) is the dispatch-lane mirror of this;
 * this script is the laptop lane, so the red shows up here before it can
 * burn a CI dispatch or a real publish.
 *
 * Per publishable package:
 *   1. `npm pack` it (runs the package's REAL prepare — src→dist copy +
 *      vendoring; npm packs private:true packages fine, it only refuses to
 *      publish them, which is the latch working as designed)
 *   2. install the tarball into a scratch project — `overrides` pin the
 *      published @omega.js runtime deps (client, backend) to their local
 *      tarballs so nothing resolves against the (empty) registry
 *   3. `require.resolve('<name>')` from the scratch project
 *   4. scan the installed tree for raw PRIVATE @omega.js references
 *      (devkit/config/account/template-kit) — vendoring must have rewritten
 *      or eliminated every one; published runtime deps (@omega.js/client,
 *      @omega.js/backend) are legitimate package requires and are skipped
 *
 * Flags:
 *   --only=web,manager   check a subset (client/backend still pack — their
 *                        tarballs feed the overrides)
 *   --keep               keep the scratch dir for inspection
 */

// Libraries
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Constants
const ROOT = path.join(__dirname, '..');
const PUBLISHABLES = ['backend', 'client', 'desktop', 'extension', 'manager', 'web'];
const PRIVATE_PACKAGES = ['devkit', 'config', 'account', 'template-kit'];
// Always packed even under --only: overrides point at these tarballs
const OVERRIDE_PACKAGES = ['client', 'backend'];

// The ways shipped code can reference an @omega.js package (mirrors
// devkit/tools/vendor.js REFERENCE_PATTERNS + ci.yml's pack-smoke grep).
const PRIVATE_REFERENCE = new RegExp(
  `(?:require(?:\\.resolve)?\\(\\s*|from\\s+|import\\s*\\(\\s*|import\\s+)` +
  `['"]@omega\\.js\\/(${PRIVATE_PACKAGES.join('|')})(?:['"/])`
);

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
 * Scan an installed package tree for raw private @omega.js references.
 * Walks .js/.cjs/.mjs files, skipping nested node_modules.
 * @param {string} dir - Installed package root.
 * @returns {{ hits: string[], files: number, bytes: number }}
 */
function scanInstalledTree(dir) {
  const hits = [];
  let files = 0;
  let bytes = 0;

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      files += 1;
      bytes += fs.statSync(full).size;
      if (!/\.(js|cjs|mjs)$/.test(entry.name)) continue;
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (PRIVATE_REFERENCE.test(line)) {
          hits.push(`${path.relative(dir, full)}:${i + 1}`);
        }
      });
    }
  };

  walk(dir);
  return { hits, files, bytes };
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
    const scan = scanInstalledTree(installedDir);
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

main();
