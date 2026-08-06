/**
 * Brand agent-docs chain (Ian 2026-07-20, amended 2026-07-27): every brand
 * root carries an AGENTS.md whose FIRST line imports the TOP-LEVEL omega
 * AGENTS.md — the map, the one agent entry — through the scope path
 * `node_modules/@omega.js/AGENTS.md`, plus a one-line CLAUDE.md pointer
 * (`@AGENTS.md`). The scope file is a symlink this service maintains: it
 * resolves the framework monorepo through the installed manager package and
 * links straight at the live top-level map; a published install has no
 * monorepo, so it links at the map the prepare lane vendored into the package
 * (`docs/AGENTS.md`). Idempotent: create when missing, heal a missing/stale
 * first-line import in place, never touch consumer content below the import.
 */
const { join, dirname } = require('node:path');
const fs = require('node:fs');
const jetpack = require('fs-jetpack');

const GUIDE_SUBPATH = 'node_modules/@omega.js/AGENTS.md';
const IMPORT_LINE = `@${GUIDE_SUBPATH}`;
const CLAUDE_POINTER = '@AGENTS.md';

const SCOPE_PREFIXES = ['', '../', '../../', '../../../'];

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
 * The @omega.js scope directory serving this brand: the brand's own
 * node_modules normally, an ancestor's when hoisted (npm workspaces).
 *
 * @param {string} brandRoot - Absolute brand monorepo root
 * @returns {{prefix: string, scopeDir: string}|null}
 */
function findScope(brandRoot) {
  for (const prefix of SCOPE_PREFIXES) {
    const scopeDir = join(brandRoot, prefix, 'node_modules', '@omega.js');
    if (jetpack.exists(scopeDir) !== 'dir') continue;
    // Only a scope that can back the import counts: the map link is already
    // there, or the manager package is present for ensureGuideLink to resolve
    // it. An empty dir from a partial install would leave the import dangling
    // while the real scope sits a level up (#153).
    if (jetpack.exists(join(scopeDir, 'AGENTS.md')) !== false
      || jetpack.exists(join(scopeDir, 'manager')) !== false) {
      return { prefix, scopeDir };
    }
  }
  return null;
}

/**
 * Resolve the import line for THIS brand — the depth that reaches the scope
 * directory holding `@omega.js/AGENTS.md`. Falls back to the canonical
 * brand-local path when nothing is installed yet (pre-install).
 *
 * @param {string} brandRoot - Absolute brand monorepo root
 * @returns {string} - The `@<relative path>` import line
 */
function resolveImportLine(brandRoot) {
  const scope = findScope(brandRoot);
  return scope ? `@${scope.prefix}${GUIDE_SUBPATH}` : IMPORT_LINE;
}

/**
 * Ensure `node_modules/@omega.js/AGENTS.md` links at the omega map. The
 * installed manager package's real path (the local-era file: symlink) names
 * both candidates, in this order: the monorepo's LIVE map two dirs up, then
 * the copy the prepare lane vendors into the package (`docs/AGENTS.md`, #144).
 * The live map wins wherever it exists, so a locally linked brand never lands
 * on the generated copy sitting in that same monorepo's packages/manager.
 * Neither present (pre-install) → the link is left alone and the step skips.
 *
 * @param {string} brandRoot - Absolute brand monorepo root
 * @returns {'present'|'created'|'healed'|'skipped'} - What happened
 */
function ensureGuideLink(brandRoot) {
  const scope = findScope(brandRoot);
  if (!scope) {
    return 'skipped';
  }

  let mapFile;
  try {
    const managerReal = fs.realpathSync(join(scope.scopeDir, 'manager'));
    mapFile = [
      join(dirname(dirname(managerReal)), 'AGENTS.md'),
      join(managerReal, 'docs', 'AGENTS.md'),
    ].find((candidate) => jetpack.exists(candidate) === 'file');
  } catch {
    return 'skipped';
  }
  if (!mapFile) {
    return 'skipped';
  }

  const linkPath = join(scope.scopeDir, 'AGENTS.md');
  try {
    if (fs.readlinkSync(linkPath) === mapFile) {
      return 'present';
    }
  } catch {
    // Not a symlink (missing, or a stale regular file) — fall through and place it.
  }

  const existed = jetpack.exists(linkPath) !== false;
  jetpack.remove(linkPath);
  fs.symlinkSync(mapFile, linkPath);
  return existed ? 'healed' : 'created';
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
    '',
    `# ${brandName} — brand notes`,
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
  const hasCruft = lines.some((line, i) => i > 0 && isImportLine(line));

  if (lines[0].trim() === importLine && !hasCruft) {
    return 'present';
  }

  // Heal: the resolved import goes to the top; drop any stray/stale-depth
  // import copy so heals never stack cruft
  const body = lines.filter((line) => !isImportLine(line));
  jetpack.write(file, [importLine, ...(body[0]?.trim() === '' ? [] : ['']), ...body].join('\n'));
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
  CLAUDE_POINTER,
  isImportLine,
  findScope,
  resolveImportLine,
  ensureGuideLink,
  renderAgentsMd,
  ensureAgentsMd,
  ensureClaudePointer,
};
