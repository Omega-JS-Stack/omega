/**
 * stage-local-packages — make `file:` dependencies deployable to Cloud Functions.
 *
 * Cloud Build can only install what is inside the uploaded functions folder — a
 * dependency like `file:../../../../../packages/backend` resolves to nothing
 * remotely, and GCF's buildpack runs `npm ci`, which also demands a
 * package-lock.json matching the uploaded shape.
 *
 * This stages the functions dir IN PLACE: packs each outside-the-folder file:
 * dependency into functions/omega_modules/*.tgz (npm pack runs the package's
 * own prepare, so the tarball always reflects current source), respells
 * package.json to point at the tarballs, and regenerates the lockfile against
 * that shape. `restore()` puts the original package.json + package-lock.json
 * back verbatim and removes the tarball folder.
 */

const path = require('path');
const jetpack = require('fs-jetpack');
const powertools = require('node-powertools');
const chalk = require('chalk').default;

const STAGING_DIR = 'omega_modules';

async function stageLocalPackages({ functionsPath, log = () => {} }) {
  const packagePath = path.join(functionsPath, 'package.json');
  const lockPath = path.join(functionsPath, 'package-lock.json');
  const stagingPath = path.join(functionsPath, STAGING_DIR);

  const pkg = jetpack.read(packagePath, 'json');
  if (!pkg) {
    return { staged: [], restore: async () => {} };
  }

  // file: specs resolving OUTSIDE the functions dir — Cloud Build can't follow those
  const targets = [];
  for (const block of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(pkg[block] || {})) {
      if (!spec.startsWith('file:')) {
        continue;
      }

      const resolved = path.resolve(functionsPath, spec.slice('file:'.length));
      if (!(resolved + path.sep).startsWith(functionsPath + path.sep)) {
        targets.push({ name, spec, block, dir: resolved });
      }
    }
  }

  if (!targets.length) {
    return { staged: [], restore: async () => {} };
  }

  // Originals — restored verbatim after deploy
  const originalPackage = jetpack.read(packagePath);
  const originalLock = jetpack.read(lockPath);

  jetpack.remove(stagingPath);
  jetpack.dir(stagingPath);

  for (const target of targets) {
    if (!jetpack.exists(path.join(target.dir, 'package.json'))) {
      throw new Error(`Local dependency ${target.name} (${target.spec}) has no package.json at ${target.dir}`);
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

    pkg[target.block][target.name] = `file:${STAGING_DIR}/${filename}`;
    log(`  ${chalk.green('✓')} Staged ${chalk.cyan(target.name)} → ${STAGING_DIR}/${filename}`);
  }

  jetpack.write(packagePath, JSON.stringify(pkg, null, 2) + '\n');

  // Cloud Build runs `npm ci` — the uploaded lockfile must match the staged shape
  log(`  ${chalk.dim('→')} Regenerating package-lock.json for the staged shape...`);
  jetpack.remove(lockPath);
  await powertools.execute(
    'npm install --package-lock-only --ignore-scripts --no-audit --no-fund',
    { log: false, config: { cwd: functionsPath } },
  );

  const restore = async () => {
    jetpack.write(packagePath, originalPackage);

    if (originalLock === undefined) {
      jetpack.remove(lockPath);
    } else {
      jetpack.write(lockPath, originalLock);
    }

    jetpack.remove(stagingPath);
  };

  return { staged: targets.map((target) => target.name), restore };
}

module.exports = stageLocalPackages;
