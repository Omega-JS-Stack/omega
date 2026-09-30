// Merge line-based files (.env, .gitignore, .gitattributes, AGENTS.md) through
// the OMEGA marker sections: the framework rewrites Default on every run, the
// consumer's Custom stays verbatim, and a file with no markers yet converges
// once, its consumer lines landing under Custom. The protocol (the grammar and its
// flavors, the .env value rules, placeholders, promotion, the first converge)
// lives in docs/devkit/index.md.

const { joinEnvUnits, envKey, normalizeEnvLine, findKeyLine, parsePlaceholderKey, isMachineComment, envValueIsEmpty } = require('./env-lines');

const DEFAULT_MARKER = '# ========== Default Values ==========';
const CUSTOM_MARKER  = '# ========== Custom Values ==========';

// The markdown flavor of the one grammar: an HTML comment renders as nothing.
const MARKDOWN_DEFAULT_MARKER = '<!-- ========== Default Values ========== -->';
const MARKDOWN_CUSTOM_MARKER  = '<!-- ========== Custom Values ========== -->';

// Framework text earlier generations wrote, one pattern per line, each block
// scoped to the file type that shipped it: Custom boilerplate (the retired
// per-framework AGENTS.md's included), and old .env headers and group notes,
// which only an unmarked .env's first converge strips.
const SHIPPED = [
  { file: '.gitignore', lines: [/^# Add your custom ignore patterns below this line$/, /^# \.\.\.$/] },
  { file: '.gitignore', lines: [/^# Add your own ignores below\. This section is preserved across (framework re-syncs|`npx omega setup` runs|`npx mgr setup` runs)\.$/] },
  { file: '.gitignore', lines: [/^# \.\.\.$/] },
  { file: 'AGENTS.md', lines: [/^## Project-specific notes$/, /^Add anything specific to THIS project here\. Edits below this line are preserved across (runs|framework re-syncs|`npx omega setup` runs)\.$/] },
  { file: 'AGENTS.md', lines: [/^<!-- Add your project-specific notes below this line -->$/] },
  {
    file: '.env',
    lines: [
      /^# .+(?: \u2014|:) brand secrets \(gitignored; loaded before every omega(?:-manager)? run\)\.$/,
      /^# Uncomment and fill what this brand uses\. Services without their credentials$/,
      /^# skip cleanly, so add these as the brand adopts each service\.$/,
    ],
  },
  {
    file: '.env',
    lines: [
      /^# .+(?: \u2014|:) COMPANY secrets \(gitignored; loaded UNDER every (?:managed brand's own \.env|brand of this company)\)\.$/,
      /^# Precedence: shell env > brand \.env > this file\. Put here only what every brand$/,
      /^# shares(?: \u2014 anything|\. Anything) brand-specific belongs in that brand's \.env, never here\.$/,
    ],
  },
  {
    file: '.env',
    lines: [
      /^# one per stream; disperse composes each target its own GOOGLE_ANALYTICS_SECRET\), and the$/,
      /^# Auto-generated and persisted here on the first real run \u2014 leave unset:$/,
      /^# ACCOUNT_PASSWORD_SEED, CSC_KEY_PASSWORD$/,
    ],
  },
];

function mergeLineBasedFiles(existingContent, newContent, fileName) {
  const isEnvFile = fileName === '.env';
  const markers = sectionMarkers(fileName);

  const hasMarkers = hasSectionMarkers(existingContent, fileName);
  // .env merges by logical line: a quoted value spanning lines is one unit
  const toLines = (content) => (isEnvFile ? joinEnvUnits(content.split('\n')) : content.split('\n'));
  const existingLines = toLines(existingContent);
  const newLines      = toLines(newContent);

  // Parse new content. We only use its default section (custom is the user's domain).
  const { defaultLines: newDefault } = splitSections(newLines, markers);
  const newDefaultKeys = new Set(isEnvFile ? newDefault.map((line) => envKey(line) || parsePlaceholderKey(line.trim())).filter(Boolean) : []);

  let existingDefault = [];
  let existingCustom = [];
  if (hasMarkers) {
    const sections = splitSections(existingLines, markers);
    existingDefault = sections.defaultLines;
    const shipped = !isEnvFile && isShippedBlock(sections.customLines, fileName);
    existingCustom = withPreamble(sections.preamble, shipped ? [''] : sections.customLines);
  } else if (isEnvFile) {
    existingDefault = existingLines.filter((line) => !isMarkerLine(line, markers));
  } else {
    existingCustom = convergeUnmarked(existingLines, newDefault, markers, fileName);
  }
  const keysOf = (lines) => new Set(isEnvFile ? lines.map(envKey).filter(Boolean) : []);
  const existingDefaultKeys = keysOf(existingDefault);
  const existingCustomKeys = keysOf(existingCustom);

  // Build the merged default section: walk new defaults in order, substituting the
  // user's existing value for any key they had set in either section.
  const mergedDefault  = [];
  const emit = (line) => mergedDefault.push(isEnvFile ? normalizeEnvLine(line) : line);

  for (const line of newDefault) {
    const trimmed = line.trim();

    if (isEnvFile && trimmed && !trimmed.startsWith('#')) {
      const key = envKey(line);
      if (key) {
        if (existingDefaultKeys.has(key)) {
          emit(findKeyLine(existingDefault, key));
          continue;
        }
        if (existingCustomKeys.has(key)) {
          // The framework newly adopted a key the user had in their Custom section.
          // Promote it UP into Default with the user's value, and drop the Custom copy
          // (handled below) so the key isn't duplicated / left empty.
          emit(findKeyLine(existingCustom, key));
          continue;
        }
      }
      emit(line);
    } else if (!isEnvFile && trimmed && !trimmed.startsWith('#')) {
      // .gitignore: just keep the new line.
      mergedDefault.push(line);
    } else {
      // Comment or blank. For .env, a `# KEY=""` placeholder claims the key:
      // an existing set value keeps its line, an empty one converges away.
      const placeholderKey = isEnvFile ? parsePlaceholderKey(trimmed) : null;

      if (placeholderKey) {
        const existingLine = existingDefaultKeys.has(placeholderKey)
          ? findKeyLine(existingDefault, placeholderKey)
          : existingCustomKeys.has(placeholderKey)
            ? findKeyLine(existingCustom, placeholderKey)
            : null;

        if (existingLine && !envValueIsEmpty(existingLine)) {
          emit(existingLine);
          continue;
        }
      }

      mergedDefault.push(line);
    }
  }

  // A line the new framework block does not carry drops, except an .env key
  // holding a value: the consumer's data, so it moves under Custom. An unmarked
  // .env's first converge also carries every consumer comment there.
  const known = new Set([...newDefaultKeys, ...existingCustomKeys]);
  const migratedToCustom = !isEnvFile
    ? []
    : hasMarkers
      ? existingDefault.filter((line) => isValuedUnknown(line, known)).map(normalizeEnvLine)
      : convergeUnmarkedEnv(existingDefault, newDefault, known);

  // Custom stays verbatim but for .env quoting and dropping a key promoted UP
  // into Default. A key set in both sections keeps both lines: dotenv reads the
  // last one, the Custom line, so dropping it would change the value.
  const finalCustom = isEnvFile
    ? existingCustom
        .filter((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return true;
          const key = envKey(line);
          return !(key && newDefaultKeys.has(key) && !existingDefaultKeys.has(key));
        })
        .map((line) => normalizeEnvLine(line))
    : existingCustom;

  const result = [];
  result.push(markers.defaultMarker);
  result.push(...mergedDefault);
  // Insert a single blank line before CUSTOM_MARKER, but only if the merged default
  // doesn't already end with one (otherwise we'd accumulate an extra blank line on
  // every merge, breaking idempotency on the first re-run after a fresh `jetpack.copy`).
  if (mergedDefault.length === 0 || mergedDefault[mergedDefault.length - 1].trim() !== '') {
    result.push('');
  }
  result.push(markers.customMarker);
  if (migratedToCustom.length > 0) {
    result.push(...migratedToCustom);
  }
  result.push(...finalCustom);
  // A converged file ends on a newline like every marked one
  if (!hasMarkers && result[result.length - 1] !== '') {
    result.push('');
  }

  return result.join('\n');
}

// Split a file on its marker lines: the lines above the first marker, the
// Default section and the Custom section.
function splitSections(lines, markers) {
  const sections = { preamble: [], defaultLines: [], customLines: [] };
  let into = sections.preamble;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === markers.defaultMarker) { into = sections.defaultLines; continue; }
    if (trimmed === markers.customMarker)  { into = sections.customLines;  continue; }
    into.push(line);
  }
  return sections;
}

function isMarkerLine(line, markers) {
  const trimmed = line.trim();
  return trimmed === markers.defaultMarker || trimmed === markers.customMarker;
}

// Blank lines at either end dropped, a run of blanks inside collapsed to one.
function tidyParagraphs(lines) {
  const tidy = [];
  for (const line of lines) {
    if (!line.trim() && (tidy.length === 0 || !tidy[tidy.length - 1].trim())) continue;
    tidy.push(line);
  }
  if (tidy.length > 0 && !tidy[tidy.length - 1].trim()) tidy.pop();
  return tidy;
}

// A marked file's lines above its Default marker open its Custom section.
function withPreamble(preamble, custom) {
  const lead = tidyParagraphs(preamble);
  if (lead.length === 0) return custom;
  const start = custom.findIndex((line) => line.trim());
  return start < 0 ? [...lead, ''] : [...lead, '', ...custom.slice(start)];
}

// A marker-less file's first converge: paragraph by paragraph, a line the new
// framework block carries is the framework's, a paragraph whose every entry is
// one goes whole (its comments were a framework header), and the rest land
// under Custom in order, one blank line between paragraphs.
function convergeUnmarked(lines, newDefault, markers, fileName) {
  const framework = new Set(newDefault.map((line) => line.trim()).filter(Boolean));
  // The grammar's comment token opens every marker: `#`, or `<!--` in markdown
  const commentToken = markers.defaultMarker.split(' ')[0];
  const paragraphs = [[]];
  for (const line of lines) {
    const trimmed = line.trim();
    if (isMarkerLine(line, markers)) continue;
    if (trimmed) paragraphs[paragraphs.length - 1].push(line);
    else if (paragraphs[paragraphs.length - 1].length > 0) paragraphs.push([]);
  }

  const custom = [];
  for (const paragraph of paragraphs) {
    const entries = paragraph.filter((line) => !line.trim().startsWith(commentToken));
    if (entries.length > 0 && entries.every((line) => framework.has(line.trim()))) continue;

    const kept = paragraph.filter((line) => !framework.has(line.trim()) && !isShipped(line, fileName));
    if (kept.length === 0) continue;
    if (custom.length > 0) custom.push('');
    custom.push(...kept);
  }
  custom.push('');
  return custom;
}

// An .env key the framework block does not know, holding a value.
function isValuedUnknown(line, known) {
  const key = envKey(line);
  return Boolean(key) && !known.has(key) && !envValueIsEmpty(line.trim());
}

// An unmarked .env's first converge, in file order with its paragraphs: every
// comment but the framework's own and a run directly above a known key or its
// placeholder, and every valued key the framework block does not know.
function convergeUnmarkedEnv(lines, newDefault, known) {
  const framework = new Set(newDefault.map((line) => line.trim()).filter(Boolean));
  const kept = [];
  let run = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') && !isMachineComment(trimmed) && !framework.has(trimmed)) {
      if (!isShipped(line, '.env')) run.push(line);
      continue;
    }
    const key = envKey(line) || parsePlaceholderKey(trimmed);
    if (!key || !known.has(key)) kept.push(...run);
    if (isValuedUnknown(line, known)) kept.push(normalizeEnvLine(line));
    if (!trimmed) kept.push('');
    run = [];
  }
  kept.push(...run);
  return tidyParagraphs(kept);
}

/**
 * Is this line framework text an earlier generation shipped in this file type?
 * @param {string} line
 * @param {string} fileName - The file's name (e.g. `.gitignore`, `AGENTS.md`, `.env`)
 * @returns {boolean}
 */
function isShipped(line, fileName) {
  return SHIPPED.some((entry) => entry.file === fileName && entry.lines.some((shipped) => shipped.test(line.trim())));
}

// Is this Custom section exactly one block this file type shipped?
function isShippedBlock(lines, fileName) {
  const body = lines.map((line) => line.trim()).filter(Boolean);
  return SHIPPED.some((entry) => entry.file === fileName && entry.lines.length === body.length && entry.lines.every((shipped, i) => shipped.test(body[i])));
}

/**
 * The marker pair a file speaks, by file type: markdown takes the HTML-comment
 * flavor of the one grammar, every other line file the `#` flavor.
 * @param {string} [fileName] - The file's name (e.g. `AGENTS.md`, `.gitignore`)
 * @returns {{ defaultMarker: string, customMarker: string }}
 */
function sectionMarkers(fileName) {
  return typeof fileName === 'string' && fileName.endsWith('.md')
    ? { defaultMarker: MARKDOWN_DEFAULT_MARKER, customMarker: MARKDOWN_CUSTOM_MARKER }
    : { defaultMarker: DEFAULT_MARKER, customMarker: CUSTOM_MARKER };
}

/**
 * Check whether a file already carries both section markers (i.e. has been
 * through the merge protocol at least once). Setup validators use this to
 * distinguish legacy/no-marker files from protocol-managed ones.
 * @param {string} content
 * @param {string} [fileName] - Selects the marker flavor (default: the `#` flavor)
 * @returns {boolean}
 */
function hasSectionMarkers(content, fileName) {
  if (typeof content !== 'string') return false;
  const { defaultMarker, customMarker } = sectionMarkers(fileName);
  const lines = content.split('\n').map((line) => line.trim());
  const at = lines.indexOf(defaultMarker);
  return at >= 0 && lines.indexOf(customMarker, at + 1) > at;
}

/**
 * Extract the consumer-owned Custom section of a marker file (everything after
 * the Custom marker line), or '' when there is no marker. The defaults engine's
 * `retire` rule uses this to judge whether a per-target doc carries consumer
 * content or is framework-owned-only.
 * @param {string} content
 * @param {string} [fileName] - Selects the marker flavor (default: the `#` flavor)
 * @returns {string}
 */
function getCustomSection(content, fileName) {
  if (typeof content !== 'string') return '';
  const { customMarker } = sectionMarkers(fileName);
  const lines = content.split('\n');
  const at = lines.findIndex((line) => line.trim() === customMarker);
  return at < 0 ? '' : ['', ...lines.slice(at + 1)].join('\n');
}

module.exports = {
  mergeLineBasedFiles,
  normalizeEnvLine,
  hasSectionMarkers,
  getCustomSection,
  sectionMarkers,
  isShipped,
  DEFAULT_MARKER,
  CUSTOM_MARKER,
};
