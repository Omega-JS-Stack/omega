/**
 * Update service tests — the REAL install/build handler against temp brand
 * monorepos, with real `npm run build` spawns (a one-liner that appends to
 * dist/, so every run is counted on disk). What they pin is the incremental
 * contract (#445): the two fingerprints — the target's own files and its
 * installed `@omega.js/*` frameworks, in both the npm-install and the
 * local-link lane — the converged skip that follows when neither moved, the
 * `--force` override, and the missing/corrupt cache falling back to a full
 * run that rewrites the file.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const targets = require('../src/services/update/write/targets.js');

// Counted on disk: dist/ is excluded from the fingerprint sweep, so the build
// recording itself never dirties the target's own input set.
const BUILD_SCRIPT = "node -e \"const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.appendFileSync('dist/builds.txt','x')\"";

/**
 * Stage a brand root with one web target that declares @omega.js/web, plus the
 * installed framework it resolves to (a plain directory = the npm-install
 * lane; `linked` symlinks it from outside the brand = the local-link lane).
 */
function stageBrand({ linked = false, version = '0.1.0' } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-update-test-')));
  const targetPath = path.join(root, 'targets', 'website');

  jetpack.write(path.join(targetPath, 'package.json'), {
    name: 'website',
    private: true,
    scripts: { build: BUILD_SCRIPT },
    dependencies: { '@omega.js/web': `^${version}` },
  });
  jetpack.write(path.join(targetPath, 'src', 'index.md'), '# home\n');

  // The merge-chain layers above the target — part of the build's input set
  jetpack.write(path.join(root, 'config', 'omega.json5'), `{ brand: { id: 'fixture', name: 'Fixture' } }`);
  jetpack.write(path.join(root, '.env'), 'KEY="value"\n');

  const installedPath = path.join(root, 'node_modules', '@omega.js', 'web');
  const frameworkPath = linked ? path.join(root, '..', `${path.basename(root)}-framework`) : installedPath;

  jetpack.write(path.join(frameworkPath, 'package.json'), { name: '@omega.js/web', version });
  jetpack.write(path.join(frameworkPath, 'dist', 'build.js'), 'module.exports = 1;\n');

  if (linked) {
    jetpack.dir(path.dirname(installedPath));
    fs.symlinkSync(path.resolve(frameworkPath), installedPath);
  }

  return { root, targetPath, frameworkPath };
}

/** Run the update service's write handler over the staged brand. */
function run(root, targetPath, options = {}) {
  return targets({
    brandRoot: root,
    targets: [{ name: 'website', path: targetPath, target: 'web' }],
    options,
  });
}

/** How many times the target's build script has run. */
function buildCount(targetPath) {
  return (jetpack.read(path.join(targetPath, 'dist', 'builds.txt')) || '').length;
}

function readCacheFile(root) {
  return jetpack.read(path.join(root, '.omega', 'cache', 'update.json'), 'json');
}

/** The one build step the handler records for the target. */
function buildStep(result) {
  return result.output.results.website.steps.find((step) => step.phase === 'build');
}

// ─── Converged skip ──────────────────────────────────────────────────────────

test('an unchanged target skips its build and the cache records both fingerprints', async () => {
  const { root, targetPath } = stageBrand();

  const first = await run(root, targetPath);
  assert.equal(buildCount(targetPath), 1, 'first run builds');
  assert.equal(buildStep(first).skipped, undefined, 'first run really built');

  const second = await run(root, targetPath);
  assert.equal(buildCount(targetPath), 1, 'converged rerun builds nothing');
  assert.deepEqual(
    { skipped: buildStep(second).skipped, reason: buildStep(second).reason, success: buildStep(second).success },
    { skipped: true, reason: 'converged', success: true },
  );

  const cache = readCacheFile(root);
  assert.equal(cache.version, 2); // v2: the per-target map key is `targets` (#455)
  assert.ok(cache.targets.website.files, 'target-file fingerprint cached');
  assert.ok(cache.targets.website.frameworks, 'framework fingerprint cached');
  assert.ok(cache.targets.website.updatedAt, 'stamped');
});

// ─── Target files ────────────────────────────────────────────────────────────

test('a changed target source file triggers the build again', async () => {
  const { root, targetPath } = stageBrand();

  await run(root, targetPath);
  jetpack.write(path.join(targetPath, 'src', 'index.md'), '# home, edited\n');
  await run(root, targetPath);

  assert.equal(buildCount(targetPath), 2, 'a source edit is fresh input');
});

test('build output, logs and machinery dirs never count as target input', async () => {
  const { root, targetPath } = stageBrand();

  await run(root, targetPath);
  jetpack.write(path.join(targetPath, 'dist', 'index.html'), '<html></html>');
  jetpack.write(path.join(targetPath, '.temp', 'scratch.json'), { a: 1 });
  jetpack.write(path.join(targetPath, 'logs', 'website.log'), 'noise');
  jetpack.write(path.join(targetPath, 'firebase-debug.log'), 'noise');
  jetpack.write(path.join(targetPath, 'node_modules', 'left-pad', 'index.js'), '//');
  await run(root, targetPath);

  assert.equal(buildCount(targetPath), 1, 'excluded paths leave the target converged');
});

test('a brand-level config or .env edit triggers the build again', async () => {
  const { root, targetPath } = stageBrand();

  await run(root, targetPath);
  jetpack.write(path.join(root, 'config', 'omega.json5'), `{ brand: { id: 'fixture', name: 'Fixture, renamed' } }`);
  await run(root, targetPath);
  assert.equal(buildCount(targetPath), 2, 'a brand config edit is fresh input');

  jetpack.write(path.join(root, '.env'), 'KEY="changed value"\n');
  await run(root, targetPath);
  assert.equal(buildCount(targetPath), 3, 'a brand .env edit is fresh input');
});

test('#681: a brand `.env.<environment>` overlay edit triggers the build again', async () => {
  const { root, targetPath } = stageBrand();

  await run(root, targetPath);

  // The overlay is a real layer of the cascade (#586) and it carries the values
  // that DIFFER per environment, which is exactly what a build bakes in. The
  // chain fingerprinted the base `.env` by exact path only, so editing the
  // overlay left the target converged and the build served the old key.
  jetpack.write(path.join(root, '.env.development'), 'KEY="from the overlay"\n');
  await run(root, targetPath);
  assert.equal(buildCount(targetPath), 2, 'a new brand overlay is fresh input');

  jetpack.write(path.join(root, '.env.development'), 'KEY="edited in the overlay"\n');
  await run(root, targetPath);
  assert.equal(buildCount(targetPath), 3, 'a brand overlay edit is fresh input');

  await run(root, targetPath);
  assert.equal(buildCount(targetPath), 3, 'an untouched overlay leaves the target converged');
});

// ─── Frameworks ──────────────────────────────────────────────────────────────

test('an installed framework version bump triggers the build again', async () => {
  const { root, targetPath, frameworkPath } = stageBrand();

  await run(root, targetPath);
  jetpack.write(path.join(frameworkPath, 'package.json'), { name: '@omega.js/web', version: '0.2.0' });
  await run(root, targetPath);

  assert.equal(buildCount(targetPath), 2, 'a new installed version is fresh input');
});

test('a locally linked framework rebuild triggers the build again', async () => {
  const { root, targetPath, frameworkPath } = stageBrand({ linked: true });

  await run(root, targetPath);
  await run(root, targetPath);
  assert.equal(buildCount(targetPath), 1, 'a link with untouched dist stays converged');

  jetpack.write(path.join(frameworkPath, 'dist', 'build.js'), 'module.exports = 2; // rebuilt\n');
  await run(root, targetPath);

  assert.equal(buildCount(targetPath), 2, "the link target's build output is fresh input");
});

// ─── Overrides ───────────────────────────────────────────────────────────────

test('--force rebuilds a converged target', async () => {
  const { root, targetPath } = stageBrand();

  await run(root, targetPath);
  const forced = await run(root, targetPath, { force: true });

  assert.equal(buildCount(targetPath), 2, 'force ignores the cache');
  assert.equal(buildStep(forced).skipped, undefined, 'forced run really built');
});

test('a corrupt cache is treated as fresh and rewritten', async () => {
  const { root, targetPath } = stageBrand();

  await run(root, targetPath);
  jetpack.write(path.join(root, '.omega', 'cache', 'update.json'), '{ not json');
  await run(root, targetPath);

  assert.equal(buildCount(targetPath), 2, 'an unreadable cache means a full run');
  assert.ok(readCacheFile(root).targets.website.files, 'and the file is rebuilt');
});

test('a dry run neither builds nor writes the cache', async () => {
  const { root, targetPath } = stageBrand();

  const result = await run(root, targetPath, { dryRun: true });

  assert.equal(buildCount(targetPath), 0, 'dry run builds nothing');
  assert.equal(buildStep(result).dryRun, true);
  assert.equal(jetpack.exists(path.join(root, '.omega', 'cache', 'update.json')), false, 'no cache written');
});
