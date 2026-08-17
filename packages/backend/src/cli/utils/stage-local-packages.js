/**
 * stage-local-packages — make `file:` dependencies deployable to Cloud Functions.
 *
 * Cloud Build can only install what is inside the uploaded functions folder — a
 * dependency like `file:../../../../../packages/backend` resolves to nothing
 * remotely, and GCF's buildpack runs `npm ci`, which also demands a
 * package-lock.json matching the uploaded shape.
 *
 * This stages the functions dir IN PLACE: packs each LOCAL package the upload
 * needs into functions/omega_modules/*.tgz (npm pack runs the package's own
 * prepare, so the tarball always reflects current source), respells
 * package.json to point at the tarballs, and regenerates the lockfile against
 * that shape. `restore()` puts the original package.json + package-lock.json
 * back verbatim and removes the tarball folder — and a FAILING stage restores
 * before it throws, so a stopped deploy never leaves a half-staged folder.
 *
 * "Local" is two things, not one: the outside-the-folder `file:` deps of the
 * functions manifest, AND — transitively — each packed package's own @omega.js
 * runtime deps that resolve through a node_modules SYMLINK. @omega.js/client is
 * a real runtime dependency of @omega.js/backend, never vendored and unpublished
 * under the publish latch, so packing only the framework left the lock regen
 * asking the registry for it (404, no deploy — #331).
 */

const fs = require('fs');
const path = require('path');
const jetpack = require('fs-jetpack');
const powertools = require('node-powertools');
const chalk = require('chalk').default;

const STAGING_DIR = 'omega_modules';
const SCOPE = '@omega.js/';

/**
 * Resolve a LINKED local package: the first node_modules entry walking up from
 * `fromDir` (mirroring Node resolution — npm workspaces and `mgr i local` hoist
 * to the brand/monorepo root), and only when that entry is a SYMLINK. A symlink
 * IS the local-era shape, and the registry may have no copy of what it points
 * at; a real directory is a registry install Cloud Build can fetch itself.
 * @param {string} name - Package name.
 * @param {string} fromDir - Directory whose manifest declares it.
 * @returns {string|null} Absolute real path of the linked checkout, or null.
 */
function resolveLinkedPackage(name, fromDir) {
  let current = path.resolve(fromDir);

  while (true) {
    const candidate = path.join(current, 'node_modules', name);
    const entry = jetpack.inspect(candidate);

    if (entry) {
      if (entry.type !== 'symlink') {
        return null;
      }
      const real = fs.realpathSync(candidate);
      return jetpack.exists(path.join(real, 'package.json')) ? real : null;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Every local package the upload must carry, in pack order — direct first, then
 * the linked @omega.js packages they pull in (the closure grows as the loop
 * walks it, so a link behind a link rides too).
 * @param {object} options
 * @param {string} options.functionsPath - The functions folder being staged.
 * @param {object} options.pkg - Its parsed package.json.
 * @returns {Array<{name: string, dir: string, spec?: string, block?: string}>}
 *   `block`/`spec` present = a DIRECT dep, respelled in the manifest; absent =
 *   a linked transitive dep, redirected by an override.
 */
function collectTargets({ functionsPath, pkg }) {
  const targets = [];
  const seen = new Set();

  // Direct: file: specs resolving OUTSIDE the functions dir — Cloud Build can't follow those
  for (const block of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(pkg[block] || {})) {
      if (!spec.startsWith('file:')) {
        continue;
      }

      const resolved = path.resolve(functionsPath, spec.slice('file:'.length));
      if (!(resolved + path.sep).startsWith(functionsPath + path.sep)) {
        targets.push({ name, spec, block, dir: resolved });
        seen.add(name);
      }
    }
  }

  // Transitive: each packed package's linked @omega.js runtime deps
  for (let index = 0; index < targets.length; index++) {
    const manifest = jetpack.read(path.join(targets[index].dir, 'package.json'), 'json');

    for (const name of Object.keys((manifest || {}).dependencies || {})) {
      if (!name.startsWith(SCOPE) || seen.has(name)) {
        continue;
      }

      const dir = resolveLinkedPackage(name, targets[index].dir);
      if (!dir) {
        continue; // Registry-installed (or absent) — npm resolves it the normal way
      }

      seen.add(name);
      targets.push({ name, dir });
    }
  }

  return targets;
}

async function stageLocalPackages({ functionsPath, log = () => {} }) {
  const packagePath = path.join(functionsPath, 'package.json');
  const lockPath = path.join(functionsPath, 'package-lock.json');
  const stagingPath = path.join(functionsPath, STAGING_DIR);

  const pkg = jetpack.read(packagePath, 'json');
  if (!pkg) {
    return { staged: [], restore: async () => {} };
  }

  const targets = collectTargets({ functionsPath, pkg });

  if (!targets.length) {
    return { staged: [], restore: async () => {} };
  }

  // Originals — restored verbatim after deploy, and after a failure
  const originalPackage = jetpack.read(packagePath);
  const originalLock = jetpack.read(lockPath);

  const restore = async () => {
    jetpack.write(packagePath, originalPackage);

    if (originalLock === undefined) {
      jetpack.remove(lockPath);
    } else {
      jetpack.write(lockPath, originalLock);
    }

    jetpack.remove(stagingPath);
  };

  try {
    jetpack.remove(stagingPath);
    jetpack.dir(stagingPath);

    const overrides = {};

    for (const target of targets) {
      if (!jetpack.exists(path.join(target.dir, 'package.json'))) {
        throw new Error(`Local dependency ${target.name} (${target.spec || 'linked'}) has no package.json at ${target.dir}`);
      }

      log(`  ${chalk.dim('→')} Packing local package ${chalk.cyan(target.name)}...`);

      const output = await powertools.execute(
        `npm pack --pack-destination "${stagingPath}" --foreground-scripts=false`,
        { log: false, config: { cwd: target.dir } },
      );

      const filename = String(output).trim().split('\n').pop().trim();
      if (!filename.endsWith('.tgz') || !jetpack.exists(path.join(stagingPath, filename))) {
        throw new Error(`npm pack for ${target.name} did not produce a tarball (got: ${filename || 'nothing'})`);
      }

      const staged = `file:${STAGING_DIR}/${filename}`;
      if (target.block) {
        pkg[target.block][target.name] = staged;
      } else {
        // A packed package still declares its own REGISTRY spec internally
        // (`@omega.js/client: ^0.1.0`) — only an override redirects that nested
        // resolution to the artifact beside it.
        overrides[target.name] = staged;
      }

      log(`  ${chalk.green('✓')} Staged ${chalk.cyan(target.name)} → ${STAGING_DIR}/${filename}`);
    }

    if (Object.keys(overrides).length > 0) {
      pkg.overrides = Object.assign({}, pkg.overrides, overrides);
    }

    jetpack.write(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

    // Cloud Build runs `npm ci` — the uploaded lockfile must match the staged shape
    log(`  ${chalk.dim('→')} Regenerating package-lock.json for the staged shape...`);
    jetpack.remove(lockPath);
    await powertools.execute(
      'npm install --package-lock-only --ignore-scripts --no-audit --no-fund',
      { log: false, config: { cwd: functionsPath } },
    );
  } catch (error) {
    // Loud and clean: the deploy stops here, and the functions folder goes back
    // exactly as it was rather than sitting half-staged.
    await restore();
    throw new Error(`Local-package staging failed — nothing deployed, ${path.basename(functionsPath)}/ restored:\n${error.message}`);
  }

  return { staged: targets.map((target) => target.name), restore };
}

module.exports = stageLocalPackages;
