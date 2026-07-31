// Vendors the monorepo's DOCS into a publishable package at prepare time, so a
// published install carries knowledge that matches the installed version
// ([#64](https://github.com/Omega-JS-Stack/omega/issues/64)) instead of
// pointing at a monorepo tree the consumer doesn't have.
//
// Runs from tools/vendor.js (the prepare `after` hook every framework already
// wires), so there is ONE docs+modules lane, not two.
//
// For each publishable (@omega.js/backend, client, desktop, extension, manager,
// web), from the package's cwd it:
//   1. Copies the monorepo's guide tree `docs/<package>/` FLAT into the
//      package's own `docs/` — the guide lands at `docs/index.md`, beside the
//      package's committed deep docs it points at
//   2. Copies `docs/shared/` (the cross-framework contracts) to `docs/shared/`
//   3. Rewrites the guide's monorepo-relative links to the shipped layout:
//      `../../packages/<self>/` → `../` (so `docs/architecture.md` and
//      `README.md` both land) and `../shared/` → `shared/`
//   4. For @omega.js/manager ONLY: copies the Claude plugin to
//      `claude-plugin/` and writes a package-root `.claude-plugin/marketplace.json`
//      listing it by the package-relative `./claude-plugin` source, so a
//      consumer brand can enable the plugin straight from its node_modules
//      ([#62](https://github.com/Omega-JS-Stack/omega/issues/62)). The copy
//      ships without the plugin's `.mcp.json` — that server lives outside the
//      plugin, in the monorepo ([#144](https://github.com/Omega-JS-Stack/omega/issues/144))
//
// Everything it writes is GENERATED (gitignored per package) and idempotent:
// each destination is cleared before it is rewritten, so a deleted source doc
// never survives as a stale shipped copy.

const path = require('path');
const jetpack = require('fs-jetpack');
const { resolveMonorepoRoot } = require('../src/local.js');
const Logger = require('../src/logger');

const logger = new Logger('devkit-vendor-docs');

// The packages that ship docs — the six publishables. The private packages
// (devkit, config, account, template-kit) are vendored INTO these and never
// ship a tree of their own.
const DOCUMENTED_PACKAGES = ['backend', 'client', 'desktop', 'extension', 'manager', 'web'];

// The Claude plugin: source in the monorepo, destination inside the manager
// package, and the marketplace that points at it there.
const PLUGIN_PACKAGE = 'manager';
const PLUGIN_SOURCE = 'agent-plugins/claude';
const PLUGIN_DIR = 'claude-plugin';
const MARKETPLACE_FILE = path.join('.claude-plugin', 'marketplace.json');
// Monorepo-only: the MCP server it declares lives outside the plugin (#144).
const MCP_FILE = '.mcp.json';

/**
 * Rewrite a guide file's monorepo-relative links to the shipped layout.
 * Applies to the guide tree's TOP level only, where the mapping is exact.
 *
 * @param {string} contents - The guide markdown as written in the monorepo
 * @param {string} short - The package's short name ('web', 'backend', …)
 * @returns {string} - The markdown as it ships inside the package
 */
function rewriteGuideLinks(contents, short) {
  return contents
    .split(`../../packages/${short}/`).join('../')
    .split('../shared/').join('shared/');
}

/**
 * Copy the monorepo docs (and, for the manager, the Claude plugin) into a
 * publishable package.
 *
 * @param {object} [options]
 * @param {string} [options.cwd] - The package root (defaults to process.cwd())
 * @param {string} [options.monorepoRoot] - Monorepo root (test seam; resolved otherwise)
 * @returns {{ docs: string[], plugin: boolean }}
 */
function vendorDocs(options) {
  options = options || {};
  const cwd = path.resolve(options.cwd || process.cwd());

  const hostPackage = jetpack.read(path.join(cwd, 'package.json'), 'json');
  if (!hostPackage) {
    throw new Error(`[devkit vendor-docs] No package.json found in ${cwd}`);
  }

  const short = (hostPackage.name || '').startsWith('@omega.js/')
    ? hostPackage.name.slice('@omega.js/'.length)
    : null;
  if (!short || !DOCUMENTED_PACKAGES.includes(short)) {
    return { docs: [], plugin: false };
  }

  const monorepoRoot = options.monorepoRoot ? path.resolve(options.monorepoRoot) : resolveMonorepoRoot();
  const guideDir = path.join(monorepoRoot, 'docs', short);
  const sharedDir = path.join(monorepoRoot, 'docs', 'shared');
  for (const source of [guideDir, sharedDir]) {
    if (jetpack.exists(source) !== 'dir') {
      throw new Error(`[devkit vendor-docs] Missing docs source for ${hostPackage.name}: ${source}`);
    }
  }

  const docsDir = path.join(cwd, 'docs');
  const written = [];

  // The guide tree, flat into docs/ — every entry is generated, so each one is
  // cleared first (a renamed source doc leaves no stale shipped copy).
  for (const entry of jetpack.list(guideDir)) {
    const source = path.join(guideDir, entry);
    const destination = path.join(docsDir, entry);
    jetpack.remove(destination);
    if (jetpack.exists(source) === 'dir') {
      jetpack.copy(source, destination);
    } else {
      jetpack.write(destination, rewriteGuideLinks(jetpack.read(source), short));
    }
    written.push(`docs/${entry}`);
  }

  // The shared contracts, verbatim — they are read as a set, not rewritten.
  jetpack.remove(path.join(docsDir, 'shared'));
  jetpack.copy(sharedDir, path.join(docsDir, 'shared'));
  written.push('docs/shared/');

  // The Claude plugin rides along in the manager package: it is the one
  // package every brand installs, and its hooks and skills address themselves
  // through CLAUDE_PLUGIN_ROOT. The one file that reached OUTSIDE the plugin
  // is dropped below, so the shipped copy is self-contained.
  let plugin = false;
  if (short === PLUGIN_PACKAGE) {
    jetpack.remove(path.join(cwd, PLUGIN_DIR));
    jetpack.copy(path.join(monorepoRoot, PLUGIN_SOURCE), path.join(cwd, PLUGIN_DIR));

    // …minus the MCP declaration: it points at the monorepo's own
    // packages/mcp-router, which is not in the publish set, so in a consumer
    // install the path doesn't exist and the server fails to start every
    // session. Shipping the plugin WITHOUT it is the deliberate call until
    // [#144](https://github.com/Omega-JS-Stack/omega/issues/144) resolves how
    // the router reaches consumers. The live monorepo plugin keeps its copy.
    jetpack.remove(path.join(cwd, PLUGIN_DIR, MCP_FILE));

    // The root marketplace stays the SSOT for name/owner/description — only the
    // source moves, from the monorepo path to the in-package one.
    const marketplace = jetpack.read(path.join(monorepoRoot, MARKETPLACE_FILE), 'json');
    marketplace.plugins = marketplace.plugins.map((entry) => (entry.source === `./${PLUGIN_SOURCE}`
      ? { ...entry, source: `./${PLUGIN_DIR}` }
      : entry));
    jetpack.write(path.join(cwd, MARKETPLACE_FILE), `${JSON.stringify(marketplace, null, 2)}\n`);
    plugin = true;
  }

  logger.log(`Vendored ${written.length} docs path(s)${plugin ? ' + the Claude plugin' : ''} into ${hostPackage.name}`);

  return { docs: written, plugin };
}

module.exports = vendorDocs;
module.exports.DOCUMENTED_PACKAGES = DOCUMENTED_PACKAGES;
module.exports.PLUGIN_DIR = PLUGIN_DIR;
module.exports.MARKETPLACE_FILE = MARKETPLACE_FILE;
module.exports.MCP_FILE = MCP_FILE;
