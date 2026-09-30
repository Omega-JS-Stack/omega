// Vendors the monorepo's top-level docs/ into @omega.js/manager at prepare
// time, the one package every brand installs, so brand agents read docs that
// match the installed version. The tree ships whole, links that leave it are
// retargeted, and the Claude plugin plus its marketplace ride along.
// Runs from tools/vendor.js's prepare hook; the manager's workspace step calls
// syncDocs too, to keep a locally linked manager's copy current.

const fs = require('fs');
const path = require('path');
const jetpack = require('fs-jetpack');
const { resolveMonorepoRoot } = require('../src/local.js');
const Logger = require('../src/logger');

const logger = new Logger('devkit-vendor-docs');

// The one package that ships docs and the plugin.
const HOST_PACKAGE = 'manager';
const DOCS_DIR = 'docs';
// The map every agent entry imports, inside the docs tree.
const MAP_FILE = path.join(DOCS_DIR, 'omega.md');

// The Claude plugin: source in the monorepo, destination inside the manager
// package, and the marketplace that points at it there.
const PLUGIN_SOURCE = 'agent-plugins/claude';
const PLUGIN_DIR = 'claude-plugin';
const MARKETPLACE_FILE = path.join('.claude-plugin', 'marketplace.json');

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
// A web URL, an anchor, a site path (`/pricing`) or a build alias (`@post/a.jpg`).
const NOT_A_PATH = /^([a-z][a-z0-9+.-]*:|#|\/|@)/i;

/**
 * Rewrite one doc's links for the copy inside the manager package. A link
 * inside `docs/` keeps its shape, since the tree ships whole. A link out of it:
 *
 * | In the monorepo | Shipped as |
 * |---|---|
 * | `packages/<pkg>/<rest>` | the sibling package in the installed `@omega.js` scope |
 * | `agent-plugins/claude/<rest>` | the plugin copy inside the manager |
 * | anything else (`brands/`, root files) | the link text alone |
 *
 * A sibling that isn't installed or never publishes leaves a dead relative
 * link, which beats a monorepo path that resolves nowhere. A locally linked
 * manager sits in `packages/`, so the same links land on the live sources.
 *
 * @param {string} contents - The doc as written in the monorepo
 * @param {string} relativeFile - Its path inside `docs/` (posix separators)
 * @returns {string} - The doc as it ships inside the manager package
 */
function rewriteDocLinks(contents, relativeFile) {
  const fromDir = path.posix.dirname(path.posix.join(DOCS_DIR, relativeFile));
  const shippedDir = path.posix.join(HOST_PACKAGE, fromDir);

  return contents.replace(LINK, (link, text, target) => {
    if (NOT_A_PATH.test(target)) {
      return link;
    }
    const hash = target.indexOf('#');
    const bare = hash === -1 ? target : target.slice(0, hash);
    const anchor = hash === -1 ? '' : target.slice(hash);
    const resolved = path.posix.normalize(path.posix.join(fromDir, bare));

    if (resolved === DOCS_DIR || resolved.startsWith(`${DOCS_DIR}/`)) {
      return link;
    }
    let shipped = null;
    if (resolved.startsWith('packages/')) {
      shipped = resolved.slice('packages/'.length);
    } else if (resolved === PLUGIN_SOURCE || resolved.startsWith(`${PLUGIN_SOURCE}/`)) {
      shipped = path.posix.join(HOST_PACKAGE, PLUGIN_DIR, resolved.slice(PLUGIN_SOURCE.length));
    }
    if (shipped === null) {
      return text;
    }
    return `[${text}](${path.posix.relative(shippedDir, shipped)}${anchor})`;
  });
}

// Every file under `dir`, as posix paths relative to it. Dotfiles (a stray
// .DS_Store) are not docs.
function listFiles(dir) {
  if (jetpack.exists(dir) !== 'dir') {
    return [];
  }
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
}

/**
 * Make `<packageDir>/docs` match the monorepo's `docs/`: write only the files
 * whose shipped content differs, remove the files the source no longer has,
 * and prune the folders that removal empties.
 *
 * @param {object} options
 * @param {string} options.monorepoRoot - The monorepo root holding `docs/`
 * @param {string} options.packageDir - The manager package root to write into
 * @param {boolean} [options.dryRun] - Report the same changes, write nothing
 * @returns {{ written: string[], removed: string[] }} - Paths inside `docs/`
 */
function syncDocs({ monorepoRoot, packageDir, dryRun = false }) {
  const sourceDir = path.join(monorepoRoot, DOCS_DIR);
  if (jetpack.exists(sourceDir) !== 'dir') {
    throw new Error(`[devkit vendor-docs] Missing docs source: ${sourceDir}`);
  }
  const destDir = path.join(packageDir, DOCS_DIR);
  const sources = listFiles(sourceDir);
  const written = [];

  for (const relative of sources) {
    const raw = fs.readFileSync(path.join(sourceDir, relative));
    const content = relative.endsWith('.md') ? Buffer.from(rewriteDocLinks(raw.toString('utf8'), relative)) : raw;
    const destination = path.join(destDir, relative);
    if (jetpack.exists(destination) === 'file' && fs.readFileSync(destination).equals(content)) {
      continue;
    }
    if (!dryRun) {
      jetpack.write(destination, content);
    }
    written.push(relative);
  }

  const wanted = new Set(sources);
  const removed = listFiles(destDir).filter((relative) => !wanted.has(relative));
  if (!dryRun) {
    for (const relative of removed) {
      jetpack.remove(path.join(destDir, relative));
      // A folder another prepare already pruned lists as undefined and ends the walk.
      let dir = path.dirname(path.join(destDir, relative));
      while (dir !== destDir && jetpack.list(dir)?.length === 0) {
        jetpack.remove(dir);
        dir = path.dirname(dir);
      }
    }
  }

  return { written, removed };
}

/**
 * Vendor the docs and the Claude plugin into @omega.js/manager. Any other
 * package is a no-op.
 *
 * @param {object} [options]
 * @param {string} [options.cwd] - The package root (defaults to process.cwd())
 * @param {string} [options.monorepoRoot] - Monorepo root (test seam; resolved otherwise)
 * @returns {{ docs: string[], removed: string[], plugin: boolean }}
 */
function vendorDocs(options) {
  options = options || {};
  const cwd = path.resolve(options.cwd || process.cwd());

  const hostPackage = jetpack.read(path.join(cwd, 'package.json'), 'json');
  if (!hostPackage) {
    throw new Error(`[devkit vendor-docs] No package.json found in ${cwd}`);
  }
  if (hostPackage.name !== `@omega.js/${HOST_PACKAGE}`) {
    return { docs: [], removed: [], plugin: false };
  }

  const monorepoRoot = options.monorepoRoot ? path.resolve(options.monorepoRoot) : resolveMonorepoRoot();
  const { written, removed } = syncDocs({ monorepoRoot, packageDir: cwd });

  // The plugin, whole: its hooks, skills and `.mcp.json` address themselves
  // through CLAUDE_PLUGIN_ROOT, so nothing in the shipped copy reaches outside it.
  jetpack.remove(path.join(cwd, PLUGIN_DIR));
  jetpack.copy(path.join(monorepoRoot, PLUGIN_SOURCE), path.join(cwd, PLUGIN_DIR));

  // The root marketplace stays the SSOT for name/owner/description; only the
  // source moves, from the monorepo path to the in-package one.
  const marketplace = jetpack.read(path.join(monorepoRoot, MARKETPLACE_FILE), 'json');
  marketplace.plugins = marketplace.plugins.map((entry) => (entry.source === `./${PLUGIN_SOURCE}`
    ? { ...entry, source: `./${PLUGIN_DIR}` }
    : entry));
  jetpack.write(path.join(cwd, MARKETPLACE_FILE), `${JSON.stringify(marketplace, null, 2)}\n`);

  logger.log(`Vendored docs/ (${written.length} written, ${removed.length} removed) + the Claude plugin into ${hostPackage.name}`);

  return { docs: written, removed, plugin: true };
}

module.exports = vendorDocs;
module.exports.syncDocs = syncDocs;
module.exports.rewriteDocLinks = rewriteDocLinks;
module.exports.HOST_PACKAGE = HOST_PACKAGE;
module.exports.MAP_FILE = MAP_FILE;
module.exports.PLUGIN_DIR = PLUGIN_DIR;
module.exports.MARKETPLACE_FILE = MARKETPLACE_FILE;
