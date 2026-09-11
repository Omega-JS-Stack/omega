/**
 * pack-local: make a tree's `file:` dependencies installable somewhere else
 * ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
 *
 * A remote install can only resolve what travels with it: a dependency spelled
 * `file:../../../../packages/web` resolves to nothing on a runner or inside
 * Cloud Build, and an install that runs `npm ci` also demands a
 * package-lock.json matching the uploaded shape.
 *
 * This stages an INSTALL ROOT in place: packs each LOCAL package the install
 * needs into `<dir>/omega_modules/*.tgz` (npm pack runs the package's own
 * prepare, so the tarball always reflects current source), respells every
 * manifest that names one, and regenerates the lockfile against that shape.
 * `restore()` puts each touched manifest and the lockfile back verbatim and
 * removes the tarball folder, and a FAILING stage restores before it throws,
 * so a stopped deploy never leaves a half-staged tree.
 *
 * `dir` is any install root: a brand root with workspaces, a standalone target,
 * or a backend's generated functions folder. What gets packed is three things,
 * not one:
 *
 *   1. the outside-the-dir `file:` deps of `<dir>/package.json` AND of every
 *      workspace member manifest (npm resolves the whole workspace on any
 *      install, so one linked member breaks the install of a clean one). Each
 *      manifest's spec is respelled relative to ITSELF.
 *   2. transitively, each packed package's own @omega.js runtime deps that
 *      resolve through a node_modules SYMLINK. @omega.js/client is a real
 *      runtime dependency of @omega.js/backend, never vendored and unpublished
 *      under the publish latch, so packing only the framework left the lock
 *      regen asking the registry for it (404, no deploy, #331). Those are
 *      redirected by an `overrides` entry on the ROOT manifest, npm honoring
 *      overrides at the install root only.
 *   3. the overrides the ENCLOSING workspace root carries, when `dir` is itself
 *      inside a staged tree. A member installed on its own is its own install
 *      root, so an override it inherited has to travel with it.
 *
 * A spec that already points at a `.tgz` is COPIED, never packed again: that is
 * the SECOND HOP, where the runner stages a target out of the snapshot it was
 * handed and the sources are a machine away. It is also what makes the module
 * idempotent, a staged dir spelling every local dep inside itself and therefore
 * collecting nothing on a re-stage.
 */

// Libraries
const fs = require('fs');
const path = require('path');
const jetpack = require('fs-jetpack');
const powertools = require('node-powertools');
const chalk = require('chalk').default;

// Constants
const STAGING_DIR = 'omega_modules';
const SCOPE = '@omega.js/';
const FILE_SPEC = 'file:';
const DEP_BLOCKS = ['dependencies', 'devDependencies'];

/**
 * Is `target` inside `dir` (or the dir itself)?
 * @param {string} dir - The install root.
 * @param {string} target - An absolute path.
 * @returns {boolean} True when the install already carries it.
 */
function isInside(dir, target) {
  return target === dir || (target + path.sep).startsWith(dir + path.sep);
}

/** A `file:` spec for a path, always POSIX-spelled (npm reads no backslashes). */
function fileSpec(from, target) {
  return FILE_SPEC + path.relative(from, target).split(path.sep).join('/');
}

/**
 * Resolve a LINKED local package: the first node_modules entry walking up from
 * `fromDir` (mirroring Node resolution, since npm workspaces and `omega i local`
 * hoist to the brand/monorepo root), and only when that entry is a SYMLINK. A
 * symlink IS the local-era shape, and the registry may have no copy of what it
 * points at; a real directory is a registry install the remote can fetch itself.
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

/** The workspace globs a manifest declares, in either supported spelling. */
function workspaceGlobs(pkg) {
  const workspaces = (pkg || {}).workspaces;
  if (!workspaces) {
    return [];
  }

  return Array.isArray(workspaces) ? workspaces : (workspaces.packages || []);
}

/**
 * Every manifest an install of `dir` resolves: the root's, then each workspace
 * member's.
 * @param {string} dir - The install root.
 * @param {object} pkg - Its parsed package.json.
 * @returns {Array<{ dir: string, file: string, pkg: object, root: boolean }>} The manifests.
 */
function collectManifests(dir, pkg) {
  const manifests = [{ dir, file: path.join(dir, 'package.json'), pkg, root: true }];

  for (const pattern of workspaceGlobs(pkg)) {
    for (const match of jetpack.find(dir, { matching: `${pattern}/package.json`, files: true }) || []) {
      const file = path.resolve(match);
      // An install never reads a manifest out of node_modules as a member
      if (file.split(path.sep).includes('node_modules')) {
        continue;
      }

      const member = jetpack.read(file, 'json');
      if (member) {
        manifests.push({ dir: path.dirname(file), file, pkg: member, root: false });
      }
    }
  }

  return manifests;
}

/**
 * The nearest ancestor manifest declaring workspaces: the install root `dir`
 * belonged to before it became one of its own, and therefore the home of the
 * overrides it inherits.
 * @param {string} dir - The install root being staged.
 * @returns {{ dir: string, pkg: object }|null} The enclosing workspace root.
 */
function enclosingWorkspaceRoot(dir) {
  let current = path.dirname(path.resolve(dir));

  while (true) {
    const pkg = jetpack.read(path.join(current, 'package.json'), 'json');
    if (pkg && workspaceGlobs(pkg).length) {
      return { dir: current, pkg };
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Every local package the install must carry, and where each one is named.
 *
 * Two shapes ride together: an ENTRY is one place a manifest names a package
 * (respelled in place, or redirected by an override on the root), and a SOURCE
 * is the package itself (packed or copied exactly once, however many entries
 * name it).
 *
 * @param {object} options - Options.
 * @param {string} options.dir - The install root being staged.
 * @param {Array<object>} options.manifests - collectManifests() output.
 * @returns {{ entries: Array<object>, sources: Array<{ name: string, from: string }> }}
 *   Sources in pack order: direct first, then the linked ones they pull in.
 */
function collectTargets({ dir, manifests }) {
  const entries = [];
  const sources = [];
  const claimed = new Set();
  const rootManifest = manifests[0];

  const add = (entry) => {
    entries.push(entry);
    if (!claimed.has(entry.name)) {
      claimed.add(entry.name);
      sources.push({ name: entry.name, from: entry.from });
    }
  };

  // Direct: file: specs resolving OUTSIDE the dir, per manifest. A spec already
  // pointing inside is what the install carries, so it stays as it is.
  for (const manifest of manifests) {
    for (const block of DEP_BLOCKS) {
      for (const [name, spec] of Object.entries(manifest.pkg[block] || {})) {
        if (!spec.startsWith(FILE_SPEC)) {
          continue;
        }

        const from = path.resolve(manifest.dir, spec.slice(FILE_SPEC.length));
        if (!isInside(dir, from)) {
          add({ name, from, manifest, block });
        }
      }
    }
  }

  // Inherited: the overrides of the workspace root this dir is a member of, the
  // ones npm would have applied to it there (the second hop's linked client).
  const enclosing = enclosingWorkspaceRoot(dir);
  const inherited = enclosing ? enclosing.pkg.overrides || {} : {};
  const ownOverrides = rootManifest.pkg.overrides || {};

  for (const [name, spec] of Object.entries({ ...inherited, ...ownOverrides })) {
    if (typeof spec !== 'string' || !spec.startsWith(FILE_SPEC) || claimed.has(name)) {
      continue;
    }

    const base = ownOverrides[name] === spec ? rootManifest.dir : enclosing.dir;
    const from = path.resolve(base, spec.slice(FILE_SPEC.length));
    if (!isInside(dir, from)) {
      add({ name, from, manifest: rootManifest, block: null });
    }
  }

  // Transitive: each packed package's linked @omega.js runtime deps. A copied
  // tarball has none to walk: whatever it needed was resolved a hop ago and
  // rides along as an inherited override.
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    if (source.from.endsWith('.tgz')) {
      continue;
    }

    const manifest = jetpack.read(path.join(source.from, 'package.json'), 'json');
    for (const name of Object.keys((manifest || {}).dependencies || {})) {
      if (!name.startsWith(SCOPE) || claimed.has(name)) {
        continue;
      }

      const from = resolveLinkedPackage(name, source.from);
      if (!from) {
        continue; // Registry-installed (or absent): npm resolves it the normal way
      }

      add({ name, from, manifest: rootManifest, block: null });
    }
  }

  return { entries, sources };
}

/**
 * Stage an install root's local packages into it.
 *
 * @param {object} options - Options.
 * @param {string} options.dir - The install root: a brand root, a target, or a
 *   generated functions folder.
 * @param {Function} [options.log] - One line per step (silent by default).
 * @returns {Promise<{ staged: string[], restore: Function }>} The packed names,
 *   and the restore that puts the tree back exactly as it was found.
 */
async function stageLocalPackages({ dir, log = () => {} }) {
  const root = path.resolve(dir);
  const lockPath = path.join(root, 'package-lock.json');
  const stagingPath = path.join(root, STAGING_DIR);

  const pkg = jetpack.read(path.join(root, 'package.json'), 'json');
  if (!pkg) {
    return { staged: [], restore: async () => {} };
  }

  const manifests = collectManifests(root, pkg);
  const rootManifest = manifests[0];
  const { entries, sources } = collectTargets({ dir: root, manifests });

  if (!sources.length) {
    return { staged: [], restore: async () => {} };
  }

  // Originals, restored verbatim after the deploy and after a failure
  const touched = [...new Set(entries.map((entry) => entry.manifest))];
  const originals = touched.map((manifest) => ({ file: manifest.file, contents: jetpack.read(manifest.file) }));
  const originalLock = jetpack.read(lockPath);

  const restore = async () => {
    for (const original of originals) {
      jetpack.write(original.file, original.contents);
    }

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

    const tarballs = {};

    for (const source of sources) {
      // A `.tgz` was packed a hop ago, by the stage that produced the tree this
      // one is staging out of: copying it keeps the artifact identical and asks
      // nothing of sources that are a machine away.
      if (source.from.endsWith('.tgz')) {
        if (!jetpack.exists(source.from)) {
          throw new Error(`Local dependency ${source.name} names a tarball that is not there: ${source.from}`);
        }

        const filename = path.basename(source.from);
        jetpack.copy(source.from, path.join(stagingPath, filename));
        tarballs[source.name] = filename;
        log(`  ${chalk.green('✓')} Copied ${chalk.cyan(source.name)} → ${STAGING_DIR}/${filename}`);
        continue;
      }

      if (!jetpack.exists(path.join(source.from, 'package.json'))) {
        throw new Error(`Local dependency ${source.name} has no package.json at ${source.from}`);
      }

      log(`  ${chalk.dim('→')} Packing local package ${chalk.cyan(source.name)}...`);

      const output = await powertools.execute(
        `npm pack --pack-destination "${stagingPath}" --foreground-scripts=false`,
        { log: false, config: { cwd: source.from } },
      );

      const filename = String(output).trim().split('\n').pop().trim();
      if (!filename.endsWith('.tgz') || !jetpack.exists(path.join(stagingPath, filename))) {
        throw new Error(`npm pack for ${source.name} did not produce a tarball (got: ${filename || 'nothing'})`);
      }

      tarballs[source.name] = filename;
      log(`  ${chalk.green('✓')} Staged ${chalk.cyan(source.name)} → ${STAGING_DIR}/${filename}`);
    }

    const overrides = {};

    for (const entry of entries) {
      const tarball = path.join(stagingPath, tarballs[entry.name]);

      if (entry.block) {
        // Relative to the manifest that names it: a member's spec climbs out of
        // its own folder, the root's does not.
        entry.manifest.pkg[entry.block][entry.name] = fileSpec(entry.manifest.dir, tarball);
      } else {
        // A packed package still declares its own REGISTRY spec internally
        // (`@omega.js/client: ^0.1.0`), so only an override redirects that
        // nested resolution to the artifact beside it.
        overrides[entry.name] = fileSpec(root, tarball);
      }
    }

    if (Object.keys(overrides).length > 0) {
      rootManifest.pkg.overrides = Object.assign({}, rootManifest.pkg.overrides, overrides);
    }

    for (const manifest of touched) {
      jetpack.write(manifest.file, `${JSON.stringify(manifest.pkg, null, 2)}\n`);
    }

    // A remote install runs `npm ci`, so the uploaded lockfile must match the
    // staged shape. `--prefix` is what makes npm treat THIS dir as the install
    // root: run inside a workspace it would otherwise climb to the workspace
    // root and write that one's lockfile instead.
    log(`  ${chalk.dim('→')} Regenerating package-lock.json for the staged shape...`);
    jetpack.remove(lockPath);
    await powertools.execute(
      `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --prefix "${root}"`,
      { log: false, config: { cwd: root } },
    );
  } catch (error) {
    // Loud and clean: the deploy stops here, and the tree goes back exactly as
    // it was rather than sitting half-staged.
    await restore();
    throw new Error(`Local-package staging failed, nothing deployed and ${path.basename(root)}/ restored:\n${error.message}`);
  }

  return { staged: sources.map((source) => source.name), restore };
}

module.exports = { stageLocalPackages, STAGING_DIR };
