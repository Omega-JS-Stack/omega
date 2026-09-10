// framework-deps — the ONE reader of a framework's declared dependency set (#87).
//
// The contract it serves: a CONSUMER may import any library the framework declares
// by BARE specifier, and it resolves from the FRAMEWORK's own installation — the
// framework's copy wins (one copy per bundle, shared with the framework code that
// uses it), and anything the framework does not declare is untouched and fails with
// the bundler's normal resolution error.
//
// `bundle.js` wires the esbuild resolve hook around this reader, so every
// framework bundling through it gets the contract (it was @omega.js/web's own
// hook in packages/web/src/assets.js until #736). @omega.js/desktop bundles
// through the same hook since #737, @omega.js/extension since #738 — where it
// replaced webpack's `resolve.modules` ordering, which also won for the
// transitives the framework merely carries, a trade this reader does NOT make.
// See docs/devkit/index.md and #87.

const fs = require('fs');
const path = require('path');

/**
 * The set of libraries a consumer may import by BARE specifier: every package the
 * framework declares as a dependency — no hand-curated list, the declared set IS
 * the list. `@omega.js/*` deps are excluded: the client is wired explicitly by each
 * framework and the private packages are vendored, so neither resolves through
 * node_modules here.
 * @param {string} frameworkRoot - the framework package's root (the dir holding its package.json)
 * @returns {string[]} dependency names
 */
function frameworkDependencyNames(frameworkRoot) {
  const pkg = JSON.parse(fs.readFileSync(path.join(frameworkRoot, 'package.json'), 'utf8'));
  return Object.keys(pkg.dependencies || {}).filter((name) => !name.startsWith('@omega.js/'));
}

/**
 * A matcher for those names: the bare specifier and any subpath of it
 * (`chart.js`, `chart.js/auto`), and nothing else — so the hook stays off every
 * other import the bundler resolves.
 * @param {string[]} names - dependency names
 * @returns {RegExp} the matcher
 */
function frameworkDepsPattern(names) {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^(${escaped.join('|')})(/|$)`);
}

module.exports = { frameworkDependencyNames, frameworkDepsPattern };
