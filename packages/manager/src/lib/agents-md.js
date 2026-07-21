/**
 * Brand agent-docs chain (Ian 2026-07-20): every brand root carries an
 * AGENTS.md whose FIRST line imports the framework-owned guide shipped
 * inside @omega.js/manager, plus a one-line CLAUDE.md pointer (`@AGENTS.md`).
 * The import path is RELATIVE (node_modules/...) so it works on any machine,
 * and in the local era the file: symlink makes it resolve straight to the
 * monorepo's live file. Idempotent: create when missing, heal a missing
 * first-line import in place, never touch consumer content below the import.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const GUIDE_SUBPATH = 'node_modules/@omega.js/manager/AGENTS.md';
const IMPORT_LINE = `@${GUIDE_SUBPATH}`;
const MARKER_LINE = '<!-- ^ OMEGA framework agent guide — maintained by `npm start`; keep this import first. Non-Claude agents: read that file directly. Brand notes below are yours. -->';
const CLAUDE_POINTER = '@AGENTS.md';

/**
 * Is this line an import of the framework guide (any relative depth)?
 *
 * @param {string} line - A single file line
 * @returns {boolean}
 */
function isImportLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('@') && trimmed.endsWith(GUIDE_SUBPATH);
}

/**
 * Resolve the import line for THIS brand: the guide normally sits in the
 * brand's own node_modules, but in-repo brands hoist to an ancestor (npm
 * workspaces) — walk up until the file exists. Falls back to the canonical
 * brand-local path when nothing resolves yet (pre-install).
 *
 * @param {string} brandRoot - Absolute brand monorepo root
 * @returns {string} - The `@<relative path>` import line
 */
function resolveImportLine(brandRoot) {
  const prefixes = ['', '../', '../../', '../../../'];
  for (const prefix of prefixes) {
    if (jetpack.exists(join(brandRoot, prefix, GUIDE_SUBPATH)) === 'file') {
      return `@${prefix}${GUIDE_SUBPATH}`;
    }
  }
  return IMPORT_LINE;
}

/**
 * Render a fresh brand AGENTS.md.
 *
 * @param {string} brandName - Display name for the brand-notes heading
 * @returns {string} - Full file content
 */
function renderAgentsMd(brandName, importLine = IMPORT_LINE) {
  return [
    importLine,
    MARKER_LINE,
    '',
    `# ${brandName} — brand notes`,
    '',
    'Everything below the import is yours — the framework never rewrites it.',
    '',
  ].join('\n');
}

/**
 * Ensure the brand-root AGENTS.md exists with the framework import as its
 * first line. Existing consumer content is preserved verbatim; a stray copy
 * of the import lower in the file is removed when healing (no duplicates).
 *
 * @param {string} brandRoot - Absolute brand monorepo root
 * @param {string} brandName - Display name used when creating fresh
 * @returns {'present'|'created'|'healed'} - What happened
 */
function ensureAgentsMd(brandRoot, brandName) {
  const file = join(brandRoot, 'AGENTS.md');
  const importLine = resolveImportLine(brandRoot);
  const existing = jetpack.read(file);

  if (existing === undefined) {
    jetpack.write(file, renderAgentsMd(brandName, importLine));
    return 'created';
  }

  const lines = existing.split('\n');
  if (lines[0].trim() === importLine) {
    return 'present';
  }

  // Heal: the resolved import (+ marker) goes to the top; drop any stray or
  // stale-depth import copy so repeated heals never stack duplicates
  const body = lines.filter((line) => !isImportLine(line) && line.trim() !== MARKER_LINE);
  jetpack.write(file, [importLine, MARKER_LINE, ...(body[0]?.trim() === '' ? [] : ['']), ...body].join('\n'));
  return 'healed';
}

/**
 * Ensure the brand-root CLAUDE.md is the one-line `@AGENTS.md` pointer.
 * A content-bearing CLAUDE.md is NEVER clobbered — that content belongs in
 * AGENTS.md (the caller warns with the move-it message).
 *
 * @param {string} brandRoot - Absolute brand monorepo root
 * @returns {'present'|'created'|'content-bearing'} - What happened
 */
function ensureClaudePointer(brandRoot) {
  const file = join(brandRoot, 'CLAUDE.md');
  const existing = jetpack.read(file);

  if (existing === undefined) {
    jetpack.write(file, `${CLAUDE_POINTER}\n`);
    return 'created';
  }

  const meaningful = existing.split('\n').map((line) => line.trim()).filter(Boolean);
  if (meaningful.includes(CLAUDE_POINTER)) {
    return 'present';
  }

  return 'content-bearing';
}

module.exports = {
  GUIDE_SUBPATH,
  IMPORT_LINE,
  MARKER_LINE,
  CLAUDE_POINTER,
  isImportLine,
  resolveImportLine,
  renderAgentsMd,
  ensureAgentsMd,
  ensureClaudePointer,
};
