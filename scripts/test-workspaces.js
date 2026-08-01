/**
 * Sound workspace test aggregation — the root `npm test` spine.
 *
 * Why not `npm run test --workspaces --if-present`: npm 11 does NOT
 * propagate a mid-list workspace failure to its own exit code (observed
 * 2026-07-14: spikes/bakeoff-astro failed 14 tests, npm exited 0 because
 * the LAST workspace passed) — a real package failure could ride a green
 * root run. This runner spawns each workspace's test script itself,
 * streams output, and fails if ANY workspace fails, with a per-workspace
 * summary at the end.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Workspace globs are the simple `<dir>/*` kind — expand directly.
// packages/* ONLY: the apps/* workspaces are covered by the root chain's own
// dedicated stages (sandbox e2e via test:e2e, its backend corpus via
// test:corpus) — expanding them here ran the heaviest cross-stack e2e twice
// per root `npm test`.
const workspaceDirs = (rootPackage.workspaces || []).filter((pattern) => pattern.startsWith('packages/')).flatMap((pattern) => {
  const base = pattern.replace(/\/\*$/, '');
  const parent = path.join(ROOT, base);
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent)
    .map((name) => path.join(parent, name))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')));
});

const testable = workspaceDirs.filter((dir) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  return Boolean(pkg.scripts?.test);
});

const results = [];
for (const dir of testable) {
  const name = path.relative(ROOT, dir);
  console.log(`\n━━━ ${name} ━━━`);
  const startedAt = Date.now();
  const run = spawnSync('npm', ['test'], { cwd: dir, stdio: 'inherit', shell: false });
  results.push({ name, code: run.status ?? 1, seconds: Math.round((Date.now() - startedAt) / 1000) });
}

console.log('\n━━━ workspace test summary ━━━');
let failed = false;
for (const result of results) {
  const ok = result.code === 0;
  if (!ok) failed = true;
  console.log(`  ${ok ? '✓' : '✗'} ${result.name}${ok ? '' : ` (exit ${result.code})`} [${result.seconds}s]`);
}

process.exit(failed ? 1 : 0);
