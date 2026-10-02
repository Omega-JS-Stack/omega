/**
 * The breaking-changes register (docs/shared/breaking-changes.md), as the
 * brand-root verbs read it: where the installed copy lives (`omega migrate`
 * ends on it), and which dated entries a brand-root `omega update` names
 * after it moved the manager pin.
 */
const fs = require('node:fs');
const path = require('node:path');

const { resolveFrameworkPackage } = require('./framework-bin.js');

// A dated section heading; the legacy sections carry no date and never match
const DATED_HEADING = /^## (\d{4}-\d{2}-\d{2}): (.+)$/gm;
// The heading's trailing issue link(s): ` ([#1009](url))` or ` ([#999](url), [#1000](url))`
const ISSUE_LINKS = /\s+\(\[#\d+\].*\)$/;

/**
 * The register the brand-root verbs point at: the copy inside the installed
 * manager. A brand-shaped root with no installed manager runs this bundled one
 * (the dispatcher's documented fallback), so its own copy is the one that matches.
 *
 * @param {string} brandRoot
 * @returns {string}
 */
function registerPath(brandRoot) {
  const installed = resolveFrameworkPackage(brandRoot, '@omega.js/manager');
  const root = installed ? fs.realpathSync(installed.dir) : path.join(__dirname, '..', '..');
  return path.join(root, 'docs', 'shared', 'breaking-changes.md');
}

/**
 * The dated entries on or after a day, in file order (the register is newest first).
 *
 * @param {string} registerText - The register's markdown.
 * @param {string} sinceIso - An ISO timestamp; only its UTC day counts.
 * @returns {Array<{ date: string, title: string }>}
 */
function dueEntries(registerText, sinceIso) {
  const since = sinceIso.slice(0, 10);
  return [...registerText.matchAll(DATED_HEADING)]
    .filter((match) => match[1] >= since)
    .map((match) => ({ date: match[1], title: match[2].replace(ISSUE_LINKS, '') }));
}

/**
 * The by-hand block's lines. `entries` null means the publish day of `from`
 * is unknown, so the block is the one line naming the file; an empty list prints nothing.
 *
 * @param {object} options
 * @param {string} options.from - The version the brand moved from.
 * @param {Array<{ date: string, title: string }>|null} options.entries - dueEntries, or null.
 * @param {string} options.file - The installed register's path.
 * @returns {string[]}
 */
function formatDueSteps({ from, entries, file }) {
  if (entries === null) return [`By-hand steps for every shape OMEGA changed since ${from}: ${file}`];
  if (entries.length === 0) return [];

  return [
    `By-hand steps since ${from} (${entries.length}):`,
    ...entries.map((entry) => `  ${entry.date}: ${entry.title}`),
    `Each entry's step is in: ${file}`,
  ];
}

module.exports = { registerPath, dueEntries, formatDueSteps };
