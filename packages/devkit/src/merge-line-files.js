// Merge line-based files (.env, .gitignore, CLAUDE.md) during framework setup —
// the OMEGA marker-section protocol. Canonical version is EM's (it added .env
// double-quote normalization and order-safe key substitution over the older
// BXM/UJM inline copies) plus @omega.js/backend's custom-key promotion (a key the framework
// newly adopts into its Default section is promoted UP from the user's Custom
// section with their value, instead of appearing empty in Default and set in
// Custom).
//
// Convention (the ONE OMEGA marker grammar — `<comment> ========== <Label> ==========`,
// comment token per file type; the rules-file managed block is the `//` flavor of the
// same family, owned by @omega.js/backend — see plans/marker-harmonization.md):
//
//   # ========== Default Values ==========
//   # framework-managed; overwritten on every setup
//   KEY1=
//   KEY2="value with spaces"
//
//   # ========== Custom Values ==========
//   # user's section; preserved verbatim across setups
//   USER_SECRET="my-secret"
//
// Behavior:
//   - The Default section is replaced with the new framework's defaults.
//   - Keys that already had values (in either Default or Custom) keep those values
//     in the same section they were in.
//   - Keys the user added to the Default section that are NOT in the new framework's
//     defaults migrate to the Custom section (so framework cleanups don't lose user data).
//   - .env values are normalized to **double-quoted** form on every merge:
//       KEY=raw-value         →   KEY="raw-value"
//       KEY="already-quoted"  →   KEY="already-quoted"  (left alone)
//       KEY=                  →   KEY=                  (empty stays empty/unquoted)
//     This protects values containing spaces, #, $, or other shell-meaningful chars.
//   - .env COMMENTED PLACEHOLDERS (`# KEY=` in the template's Default section)
//     mark keys the framework knows but ships no value for (the env cascade
//     supplies values from stronger layers — dogfood friction #20). On merge:
//     an existing NON-EMPTY value for that key (either section) keeps its line
//     in Default; an existing EMPTY value (`KEY=` / `KEY=""`) converges to the
//     commented placeholder instead of migrating to Custom.
//   - .gitignore: same logic, line-based instead of key-based (no quoting).
//   - CLAUDE.md: same logic as .gitignore (line-based, no quoting). The markers
//     render as visible H1 headings in markdown — that's intentional UX.
//   - First setup (no existing file): the framework template lands as-is.

const DEFAULT_MARKER = '# ========== Default Values ==========';
const CUSTOM_MARKER  = '# ========== Custom Values ==========';

function mergeLineBasedFiles(existingContent, newContent, fileName) {
  const isEnvFile = fileName === '.env';

  const existingLines = existingContent.split('\n');
  const newLines      = newContent.split('\n');

  // Parse existing into default + custom sections.
  const { defaultLines: existingDefault, customLines: existingCustom, existingDefaultKeys, existingCustomKeys }
    = splitSections(existingLines, isEnvFile);

  // Parse new content. We only use its default section (custom is the user's domain).
  const { defaultLines: newDefault, customLines: newCustom } = splitSections(newLines, isEnvFile);

  // Build the merged default section: walk new defaults in order, substituting the
  // user's existing value for any key they had set in either section.
  const newDefaultKeys = new Set();
  const mergedDefault  = [];
  const emit = (line) => mergedDefault.push(isEnvFile ? normalizeEnvLine(line) : line);

  for (const line of newDefault) {
    const trimmed = line.trim();

    if (isEnvFile && trimmed && !trimmed.startsWith('#')) {
      const key = trimmed.split('=')[0].trim();
      if (key) {
        newDefaultKeys.add(key);
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
      // Comment / blank — for .env, a `# KEY=` placeholder claims the key:
      // an existing set value keeps its line, an empty one converges away.
      const placeholderKey = isEnvFile ? parsePlaceholderKey(trimmed) : null;

      if (placeholderKey) {
        newDefaultKeys.add(placeholderKey);

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

  // User-added stuff in their Default section that the new framework doesn't know about
  // → migrate to Custom so it's preserved without being clobbered next setup.
  const migratedToCustom = [];
  for (const line of existingDefault) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (isEnvFile) {
      const key = trimmed.split('=')[0].trim();
      if (key && !newDefaultKeys.has(key) && !existingCustomKeys.has(key)) {
        migratedToCustom.push(normalizeEnvLine(line));
      }
    } else {
      // .gitignore: line not in new defaults → migrate.
      const inNew = newLines.some((nl) => nl.trim() === trimmed);
      if (!inNew) {
        migratedToCustom.push(line);
      }
    }
  }

  // The user's Custom section is preserved — except (a) .env values get normalized
  // to double-quoted form for consistent quoting, and (b) any key that was promoted
  // UP into the Default section above is dropped here so it isn't duplicated. Keys
  // present in BOTH sections are NOT dropped (the Default copy's value won there,
  // so removing the Custom copy would silently change dotenv's effective value).
  const finalCustom = isEnvFile
    ? existingCustom
        .filter((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return true;
          const key = trimmed.split('=')[0].trim();
          return !(key && newDefaultKeys.has(key) && !existingDefaultKeys.has(key));
        })
        .map((line) => normalizeEnvLine(line))
    : existingCustom;

  const result = [];
  result.push(DEFAULT_MARKER);
  result.push(...mergedDefault);
  // Insert a single blank line before CUSTOM_MARKER, but only if the merged default
  // doesn't already end with one (otherwise we'd accumulate an extra blank line on
  // every merge — breaking idempotency on the first re-run after a fresh `jetpack.copy`).
  if (mergedDefault.length === 0 || mergedDefault[mergedDefault.length - 1].trim() !== '') {
    result.push('');
  }
  result.push(CUSTOM_MARKER);
  if (migratedToCustom.length > 0) {
    result.push(...migratedToCustom);
  }
  result.push(...finalCustom);

  return result.join('\n');
}

// Normalize a single .env line:
//   - Comments / blanks unchanged
//   - KEY=  (empty value) unchanged
//   - KEY="..." (already double-quoted) unchanged
//   - KEY=raw-value → KEY="raw-value" (with embedded " and \ escaped)
//   - KEY='single' → KEY="single"  (canonicalize single → double)
function normalizeEnvLine(line) {
  if (typeof line !== 'string') return line;

  // Preserve comments and blank lines verbatim.
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return line;

  // Capture leading whitespace so we don't lose indentation.
  const leadingMatch = line.match(/^(\s*)/);
  const leading = leadingMatch ? leadingMatch[1] : '';

  const eqIdx = trimmed.indexOf('=');
  if (eqIdx < 0) return line; // no `=` — not a KEY=VALUE line

  const key = trimmed.slice(0, eqIdx).trim();
  let value = trimmed.slice(eqIdx + 1);

  // Strip trailing whitespace + inline comment-after-value (rare; we only strip a # that follows a space).
  // We do NOT strip # inside quoted values. Detect that by checking if value starts with a quote.
  if (value.length === 0) {
    return `${leading}${key}=`;
  }

  // Already double-quoted? Leave alone (preserves user's exact contents).
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return `${leading}${key}=${value}`;
  }

  // Single-quoted → canonicalize to double-quoted.
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    const inner = value.slice(1, -1);
    return `${leading}${key}="${escapeForDoubleQuote(inner)}"`;
  }

  // Raw value → wrap.
  return `${leading}${key}="${escapeForDoubleQuote(value)}"`;
}

function escapeForDoubleQuote(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function splitSections(lines, isEnvFile) {
  const defaultLines = [];
  const customLines  = [];
  const existingDefaultKeys = new Set();
  const existingCustomKeys  = new Set();

  let mode = null; // null | 'default' | 'custom'
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === DEFAULT_MARKER) { mode = 'default'; continue; }
    if (trimmed === CUSTOM_MARKER)  { mode = 'custom';  continue; }

    // Lines before any marker are treated as default (legacy / fresh files).
    if (mode === 'custom') {
      customLines.push(line);
      if (isEnvFile && trimmed && !trimmed.startsWith('#')) {
        const key = trimmed.split('=')[0].trim();
        if (key) existingCustomKeys.add(key);
      }
    } else {
      defaultLines.push(line);
      if (isEnvFile && trimmed && !trimmed.startsWith('#')) {
        const key = trimmed.split('=')[0].trim();
        if (key) existingDefaultKeys.add(key);
      }
    }
  }

  return { defaultLines, customLines, existingDefaultKeys, existingCustomKeys };
}

function findKeyLine(lines, key) {
  const re = new RegExp(`^\\s*${key}\\s*=`);
  for (const line of lines) {
    if (re.test(line)) return line;
  }
  return `${key}=`;
}

// `# KEY=` (nothing after the =) → KEY; any other comment → null.
function parsePlaceholderKey(trimmed) {
  const match = trimmed.match(/^#\s*([A-Za-z_][A-Za-z0-9_]*)=\s*$/);
  return match ? match[1] : null;
}

// KEY= / KEY="" / KEY='' (whitespace tolerated) count as empty.
function envValueIsEmpty(line) {
  const eqIdx = line.indexOf('=');
  if (eqIdx < 0) return true;
  const value = line.slice(eqIdx + 1).trim();
  return value === '' || value === '""' || value === "''";
}

/**
 * Check whether a file already carries both section markers (i.e. has been
 * through the merge protocol at least once). Setup validators use this to
 * distinguish legacy/no-marker files from protocol-managed ones.
 * @param {string} content
 * @returns {boolean}
 */
function hasSectionMarkers(content) {
  return typeof content === 'string'
    && content.includes(DEFAULT_MARKER)
    && content.includes(CUSTOM_MARKER);
}

module.exports = { mergeLineBasedFiles, normalizeEnvLine, hasSectionMarkers, DEFAULT_MARKER, CUSTOM_MARKER };
