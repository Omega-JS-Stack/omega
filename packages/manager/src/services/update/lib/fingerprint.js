/**
 * Update fingerprints (#445) — the two input sets that decide whether a target
 * still needs its build, each hashed to one string:
 *
 *   files      — a sweep of the target's own tree (relative path + size + mtime
 *                per file): the assets service's mtime-diff precedent scaled
 *                from a file to a directory. Installed deps, build output,
 *                logs and the machinery dirs are excluded, so a build never
 *                re-dirties its own inputs. The merge-chain files ABOVE the
 *                target (brand and company omega.json5 + .env) fold in too —
 *                the build reads them, and a brand-config edit that left every
 *                target "converged" would serve stale output silently.
 *   frameworks — every declared `@omega.js/*` dependency's installed identity:
 *                the version string for an npm install, and for a LOCAL LINK
 *                (which points into the monorepo, where the version stands
 *                still between builds) the link target's version plus a sweep
 *                of its build output.
 *
 * Both are stat walks — no file contents are ever read.
 */
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jetpack = require('fs-jetpack');

// Never part of a target's input set: installed deps (node_modules), build
// output (dist), run logs (logs), and the machinery `omega build` / `omega
// dev` / firebase write beside the sources (.temp, .omega, .cache, .firebase).
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'logs', '.temp', '.omega', '.cache', '.firebase', '.git']);

/**
 * Hash a directory tree by path + size + mtime. Entries are walked in name
 * order so the digest is machine-independent; anything that is neither a
 * plain file nor a directory (symlinks, sockets) is skipped, as are debug
 * logs and .DS_Store — churn that says nothing about the sources.
 *
 * @param {string} dir - Directory to sweep.
 * @returns {string|null} Hex digest, or null when the directory doesn't exist.
 */
function sweep(dir) {
  if (!jetpack.exists(dir)) {
    return null;
  }

  const hash = createHash('sha1');

  const walk = (current, prefix) => {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1));

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          walk(path.join(current, entry.name), `${prefix}${entry.name}/`);
        }
        continue;
      }

      if (!entry.isFile() || entry.name.endsWith('.log') || entry.name === '.DS_Store') {
        continue;
      }

      const stat = fs.statSync(path.join(current, entry.name));
      hash.update(`${prefix}${entry.name}:${stat.size}:${stat.mtimeMs}\n`);
    }
  };

  walk(dir, '');
  return hash.digest('hex');
}

/**
 * Where does `name` resolve from `fromDir` via the node_modules climb? A
 * manual walk (not require.resolve) so exports-restricted packages and
 * bin-only packages don't false-negative.
 *
 * @param {string} fromDir - Directory to climb from.
 * @param {string} name - Package name.
 * @returns {string|null} The package directory, or null when it doesn't resolve.
 */
function resolvePackageDir(fromDir, name) {
  let dir = path.resolve(fromDir);

  while (true) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Hash the installed identity of every `@omega.js/*` package the target declares.
 *
 * @param {string} targetPath - The target root.
 * @returns {string} Hex digest.
 */
function frameworkFingerprint(targetPath) {
  const pkg = jetpack.read(path.join(targetPath, 'package.json'), 'json');
  const declared = Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies })
    .filter((name) => name.startsWith('@omega.js/'))
    .sort();

  const parts = declared.map((name) => {
    const dir = resolvePackageDir(targetPath, name);
    if (!dir) {
      return `${name}@missing`;
    }

    const version = jetpack.read(path.join(dir, 'package.json'), 'json')?.version || 'unknown';
    if (!fs.lstatSync(dir).isSymbolicLink()) {
      return `${name}@${version}`;
    }

    // A local link resolves into the monorepo: the version never moves there,
    // so the link target's build output is what actually changes under the target.
    const target = fs.realpathSync(dir);
    return `${name}@${version}#${sweep(path.join(target, 'dist')) || 'no-dist'}`;
  });

  return createHash('sha1').update(parts.join('\n')).digest('hex');
}

/**
 * The pair of fingerprints cached per target.
 *
 * Chain entries are labelled (not path-keyed) so the digest survives a brand
 * directory move the way the sweep's relative paths do; an absent file hashes
 * as absent, so growing a .env later dirties the fingerprint like an edit.
 *
 * @param {string} targetPath - The target root.
 * @param {Array<{ label: string, file: string }>} [chainFiles] - Merge-chain
 *   files outside the target tree that its build reads (brand/company config
 *   and .env).
 * @returns {{ files: string, frameworks: string }}
 */
function fingerprintTarget(targetPath, chainFiles = []) {
  const chain = chainFiles.map(({ label, file }) => {
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    return stat ? `${label}:${stat.size}:${stat.mtimeMs}` : `${label}:absent`;
  });

  const files = createHash('sha1')
    .update([sweep(targetPath) || 'missing', ...chain].join('\n'))
    .digest('hex');

  return {
    files,
    frameworks: frameworkFingerprint(targetPath),
  };
}

module.exports = { fingerprintTarget, resolvePackageDir, sweep, EXCLUDED_DIRS };
