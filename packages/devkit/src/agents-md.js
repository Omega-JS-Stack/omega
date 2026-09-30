/**
 * The ONE builder of a project-root AGENTS.md, a brand root and a framework
 * used alone alike, written through the one marker engine: the Default section
 * imports the installed manager's AGENTS.md (which imports the omega map from
 * the docs the manager ships), the Custom section holds the project's own
 * notes, verbatim. Every older shape converges once, its notes kept under
 * Custom. A brand target carries none: its brand root is the doc home.
 */
const { join } = require('node:path');
const fs = require('node:fs');
const jetpack = require('fs-jetpack');
const { mergeLineBasedFiles, hasSectionMarkers, getCustomSection, isShipped, sectionMarkers, DEFAULT_MARKER } = require('./merge-line-files');

const FILE_NAME = 'AGENTS.md';
const GUIDE_SUBPATH = 'node_modules/@omega.js/manager/AGENTS.md';
const IMPORT_LINE = `@${GUIDE_SUBPATH}`;
// The retired scope-level link: an import of it is healed away and the link
// itself removed.
const RETIRED_SUBPATH = 'node_modules/@omega.js/AGENTS.md';

const SCOPE_PREFIXES = ['', '../', '../../', '../../../'];

// The skeleton heading earlier builders wrote under the import.
const NOTES_HEADING = /^# .+: (project|brand) notes$/;

/**
 * Is this line an import of the manager's AGENTS.md or the retired scope link
 * (any relative depth)?
 *
 * @param {string} line - A single file line
 * @returns {boolean}
 */
function isImportLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('@') && (trimmed.endsWith(GUIDE_SUBPATH) || trimmed.endsWith(RETIRED_SUBPATH));
}

/**
 * The @omega.js scope directory serving this project: its own node_modules
 * normally, an ancestor's when hoisted (npm workspaces). Only a scope holding
 * the manager counts: an empty dir from a partial install would leave the
 * import dangling while the real scope sits a level up.
 *
 * @param {string} root - Absolute project root
 * @returns {{prefix: string, scopeDir: string}|null}
 */
function findScope(root) {
  for (const prefix of SCOPE_PREFIXES) {
    const scopeDir = join(root, prefix, 'node_modules', '@omega.js');
    if (jetpack.exists(join(scopeDir, 'manager')) === 'dir') {
      return { prefix, scopeDir };
    }
  }
  return null;
}

/**
 * Resolve the import line for THIS project: the depth that reaches the scope
 * holding the manager. Falls back to the canonical project-local path when
 * the manager is not installed, so the line still names where the docs live.
 *
 * @param {string} root - Absolute project root
 * @returns {string} - The `@<relative path>` import line
 */
function resolveImportLine(root) {
  const scope = findScope(root);
  return scope ? `@${scope.prefix}${GUIDE_SUBPATH}` : IMPORT_LINE;
}

/**
 * Remove the retired `node_modules/@omega.js/AGENTS.md` link (or a stale file
 * in its place) from the scope serving this brand.
 *
 * @param {string} brandRoot - Absolute brand monorepo root
 * @param {{ dryRun?: boolean }} [options] - dryRun: the same verdict, nothing removed
 * @returns {'removed'|'absent'} - What happened
 */
function removeRetiredLink(brandRoot, { dryRun = false } = {}) {
  const scope = findScope(brandRoot);
  const link = scope && join(scope.scopeDir, 'AGENTS.md');
  if (!link || !fs.lstatSync(link, { throwIfNoEntry: false })) {
    return 'absent';
  }
  if (!dryRun) {
    fs.rmSync(link, { force: true });
  }
  return 'removed';
}

/**
 * Render a fresh project-root AGENTS.md: the import under the Default marker,
 * then the Custom marker and nothing below it.
 *
 * @param {string} [importLine] - The resolved import line
 * @returns {string} - Full file content
 */
function renderAgentsMd(importLine = IMPORT_LINE) {
  const { defaultMarker, customMarker } = sectionMarkers(FILE_NAME);
  return `${defaultMarker}\n${importLine}\n\n${customMarker}\n`;
}

/**
 * Is this the retired per-framework template? It OPENS with the `#` Default
 * marker; a file that merely quotes the markers in its notes is not one.
 *
 * @param {string} content - The AGENTS.md content
 * @returns {boolean}
 */
function isRetiredTemplate(content) {
  return content.split('\n')[0].trim() === DEFAULT_MARKER && hasSectionMarkers(content);
}

/**
 * The notes a consumer wrote in an AGENTS.md of any shape, trimmed: the Custom
 * section of a marked or retired-template file, else the whole file, minus
 * every line a framework wrote (the import, the skeleton heading, shipped
 * boilerplate).
 *
 * @param {string} content - The AGENTS.md content
 * @returns {string} - '' when the file holds nothing the framework did not write
 */
function consumerNotes(content) {
  const source = hasSectionMarkers(content, FILE_NAME)
    ? getCustomSection(content, FILE_NAME)
    : isRetiredTemplate(content) ? getCustomSection(content) : content;
  return source.split('\n')
    .filter((line) => !isImportLine(line) && !NOTES_HEADING.test(line.trim()) && !isShipped(line, FILE_NAME))
    .join('\n')
    .trim();
}

/**
 * Ensure the project-root AGENTS.md is the marked shape with the resolved
 * import. A marked file goes through the engine (the Default section healed,
 * the Custom section verbatim); any other shape converges, its notes landing
 * under Custom in order.
 *
 * @param {string} root - Absolute project root
 * @param {{ dryRun?: boolean }} [options] - dryRun: the same verdict, nothing written
 * @returns {'present'|'created'|'healed'|'converged'} - What happened
 */
function ensureAgentsMd(root, { dryRun = false } = {}) {
  const file = join(root, FILE_NAME);
  const template = renderAgentsMd(resolveImportLine(root));
  const existing = jetpack.read(file);

  if (existing === undefined) {
    if (!dryRun) jetpack.write(file, template);
    return 'created';
  }

  const marked = hasSectionMarkers(existing, FILE_NAME);
  const next = mergeLineBasedFiles(marked ? existing : consumerNotes(existing), template, FILE_NAME);
  if (next === existing) {
    return 'present';
  }
  if (!dryRun) jetpack.write(file, next);
  return marked ? 'healed' : 'converged';
}

/**
 * Keep a brand target free of any AGENTS.md: the brand root is its doc home. A
 * copy holding nothing the consumer wrote is removed; one with notes stays.
 *
 * @param {string} targetDir - Absolute brand target root
 * @returns {'absent'|'removed'|'kept'} - What happened
 */
function retireAgentsMd(targetDir) {
  const file = join(targetDir, 'AGENTS.md');
  const existing = jetpack.read(file);

  if (existing === undefined) {
    return 'absent';
  }
  if (consumerNotes(existing)) {
    return 'kept';
  }
  jetpack.remove(file);
  return 'removed';
}

/**
 * A framework scaffold's AGENTS.md step, recorded into the defaults engine's
 * result and logged the way the engine logs: a standalone project root gets
 * the builder's file; a brand target gets none.
 *
 * @param {object} options
 * @param {string} options.outputDir - Absolute project or target root
 * @param {boolean} options.standalone - True when no brand root sits above it
 * @param {{written: string[], merged: string[], skipped: string[], removed: string[]}} options.result - The engine result to record into
 * @param {object} [options.logger] - `{ log, warn }` (defaults to console)
 */
function scaffoldAgentsMd({ outputDir, standalone, result, logger = console }) {
  if (!standalone) {
    const verdict = retireAgentsMd(outputDir);
    if (verdict === 'removed') {
      result.removed.push('AGENTS.md');
      logger.warn('Retired AGENTS.md: a brand target carries none, the brand root AGENTS.md is the one doc home');
    } else if (verdict === 'kept') {
      result.skipped.push('AGENTS.md');
      logger.warn('Kept AGENTS.md: it carries consumer content. A brand target carries no AGENTS.md: move those notes under the Custom marker of the brand root AGENTS.md, then delete the file');
    }
    return;
  }

  const verdict = ensureAgentsMd(outputDir);
  if (verdict === 'created') {
    result.written.push('AGENTS.md');
    logger.log('Scaffolded → AGENTS.md');
  } else if (verdict === 'healed') {
    result.merged.push('AGENTS.md');
    logger.log('Healed → AGENTS.md: the Default section imports the manager, your Custom section kept');
  } else if (verdict === 'converged') {
    result.merged.push('AGENTS.md');
    logger.warn('Converged AGENTS.md to the marker sections: the manager import under Default, your notes under Custom');
  } else {
    result.skipped.push('AGENTS.md');
  }
}

module.exports = {
  GUIDE_SUBPATH,
  IMPORT_LINE,
  RETIRED_SUBPATH,
  isImportLine,
  findScope,
  resolveImportLine,
  removeRetiredLink,
  renderAgentsMd,
  ensureAgentsMd,
  retireAgentsMd,
  scaffoldAgentsMd,
};
