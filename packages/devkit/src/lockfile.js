/**
 * lockfile: regenerate an install root's OWN package-lock.json
 * ([#938](https://github.com/Omega-JS-Stack/omega/issues/938)).
 *
 * ONE helper for its three callers: the pack step (`pack-local`, the staged
 * shape), `omega i local` (`linkLocalPackages`) and `omega i live`
 * (`restoreRegistrySpecs`).
 *
 * Two things a plain `npm install` gets wrong here, and this answers both:
 *   - `--prefix` makes npm treat `root` as the install root. Without it, npm in
 *     a directory that is itself a WORKSPACE of an outer root (every in-repo
 *     brand, under the omega monorepo's `brands/*`) climbs to that outer root
 *     and writes ITS lockfile, leaving the brand's own untouched.
 *   - npm KEEPS a locked link whose target's version satisfies a registry spec,
 *     so a lock from the local era (`link: true` into a checkout already at the
 *     published number) would survive the flip. Every @omega.js entry the
 *     deploy gate would refuse (`brandLockfileDrift`) is dropped first, with its
 *     link target, so npm resolves those afresh and keeps every other pin.
 *   - npm also honors a STALE path entry, a folder the lock names that is no
 *     longer on disk (a renamed target), and re-creates whatever link its
 *     dependencies declare. Those entries go first, with everything under them
 *     and every `node_modules/` link pointing into them.
 *
 * Transactional: a failed npm run writes the lock back byte for byte.
 */
const fs = require('fs');
const path = require('path');
const jetpack = require('fs-jetpack');

const { safeInstall } = require('./safe-install.js');
const { brandLockfileDrift, staleLockPaths } = require('./brand-version.js');

/** A path equal to base, or nested beneath it. */
const under = (value, base) => value === base || value.startsWith(`${base}/`);

/**
 * Drop every stale path entry (`staleLockPaths`), everything nested under it,
 * and every `node_modules/` entry whose `resolved` points into it.
 *
 * @param {object} lock - The parsed lock (mutated).
 * @param {string} root - The install root the keys are relative to.
 * @returns {string[]} The stale paths dropped (the outermost of each tree).
 */
function dropStalePaths(lock, root) {
  const stale = staleLockPaths({ root, packages: lock.packages });
  const outermost = stale.filter((key) => !stale.some((other) => other !== key && under(key, other)));

  for (const [key, entry] of Object.entries(lock.packages)) {
    const pointsInto = entry && typeof entry.resolved === 'string' && outermost.some((base) => under(entry.resolved, base));
    if (outermost.some((base) => under(key, base)) || pointsInto) delete lock.packages[key];
  }

  return outermost;
}

/**
 * Drop every lock entry `drift` names, plus a dropped link's target entry and
 * everything nested under it (the checkout's own dependencies).
 *
 * @param {object} lock - The parsed lock (mutated).
 * @param {Array<{ key: string|null, entry: object|undefined }>} drift - What the gate refused.
 * @returns {string[]} The names whose entries were dropped.
 */
function dropDrift(lock, drift) {
  const dropped = [];

  for (const { name, key, entry } of drift) {
    // An absent entry has nothing to drop (npm adds it from the manifest), and
    // one inside a stale path is already gone with it.
    if (!key || !lock.packages[key]) continue;

    delete lock.packages[key];
    dropped.push(name);

    if (entry.link && entry.resolved) {
      for (const other of Object.keys(lock.packages)) {
        if (under(other, entry.resolved)) delete lock.packages[other];
      }
    }
  }

  return dropped;
}

/**
 * Regenerate `root`'s package-lock.json from its manifests, lock-only: no
 * scripts, no node_modules writes.
 *
 * @param {object} options
 * @param {string} options.root - The install root whose lock is regenerated.
 * @param {function} [options.log] - Line sink (silent when omitted).
 * @returns {Promise<void>}
 */
async function regenerateLockfile({ root, log }) {
  const { lockPath, lock, drift } = brandLockfileDrift({ root });
  const original = lock ? jetpack.read(lockPath) : null;

  if (lock && lock.packages) {
    const pruned = dropStalePaths(lock, root);
    const dropped = dropDrift(lock, drift);

    if (pruned.length || dropped.length) {
      jetpack.write(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    }
    if (log && pruned.length) log(`Pruned the lock entries of folders no longer on disk (${pruned.join(', ')}) so npm stops honoring what they declare`);
    if (log && dropped.length) log(`Dropped the stale lock entries of ${dropped.join(', ')} so npm resolves them from the manifests`);
  }

  if (log) log(`Regenerating ${path.basename(root)}/package-lock.json...`);

  // The REAL path: npm writes a link's `resolved` relative to the physical
  // directory, so a prefix spelled through an alias (macOS /var for
  // /private/var, a symlinked brand dir) reads those paths from the wrong place.
  const prefix = fs.realpathSync(root);

  try {
    await safeInstall(
      `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --prefix "${prefix}"`,
      { log: false, config: { cwd: prefix } },
    );
  } catch (error) {
    if (original !== null) jetpack.write(lockPath, original);
    throw error;
  }
}

module.exports = { regenerateLockfile };
