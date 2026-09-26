// applyDefaults(config) — the shared OMEGA defaults-scaffolding engine.
//
// Every framework ships a defaults tree (src/defaults/ → dist/defaults/) that
// setup copies into the consumer project. This is the single plain-fs engine
// every framework's scaffold runs.
//
// File-map rules: minimatch patterns (dot:true) matched against the RAW path
// relative to defaultsDir, last-match-wins option merging. Per-rule options:
//   overwrite  bool|fn(item)  default true — write even if the destination exists
//   skip       bool|fn(item)  default false — never process this file
//   name       fn(item)       rename the output file
//   path       fn(item)       re-destination the output (relative dir)
//   template   object         render `{{ key.path }}` tokens with this data
//                             (tolerant: unknown keys survive verbatim, so GitHub
//                             Actions' `${{ secrets.X }}` passes through)
//   merge      bool           JSON5 defaults-merge with the existing file, written
//                             through @omega.js/config's comment-preserving editor
//                             (only the differing keys change; comments stay)
//   mergeLines bool           OMEGA marker-section line merge (.env/.gitignore/AGENTS.md)
//   retire     bool           brand-context per-target doc retirement: NEVER scaffold
//                             the file; an existing framework-owned-only copy is
//                             DELETED (one-time heal — the brand root is the doc
//                             home), a copy carrying consumer content stays with a
//                             loud move-it warning (never destroyed)
//
// Engine built-ins (not expressed in the file map):
//   - `_.name` segments lose the leading `_` (dotfiles ship past npm's filter)
//   - non-final segments starting `_` (but not `_.`) are ARCHIVE dirs — skipped
//     (reference material that ships in the framework package, e.g. desktop's `_mas/`)
//   - `.gitkeep` creates the destination directory, the file itself never copies
//   - `.DS_Store` never copies
//   - text writes are skipped when the destination is byte-identical (idempotent
//     re-runs report zero writes)
//   - a destination carrying the OMEGA section markers when the current template
//     no longer does is a PRIOR-GENERATION generated file: framework-owned, so
//     `retire` sweeps it and `overwrite: false` still heals it
//   - binary files (by extension) copy verbatim — never templated/merged/transformed

const path = require('path');
const fs = require('fs');
const { isDeepStrictEqual } = require('node:util');
const jetpack = require('fs-jetpack');
const { minimatch } = require('minimatch');
const { mergeLineBasedFiles, hasSectionMarkers, getCustomSection } = require('./merge-line-files');

// Files with these extensions copy byte-for-byte and never go through
// template/merge/transform.
const BINARY_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|ico|woff|woff2|ttf|otf|eot|pdf|zip|tar|gz|mp3|mp4|avi|mov)$/i;

const RULE_DEFAULTS = {
  overwrite: true,
  skip: false,
  name: null,
  path: null,
  template: null,
  merge: false,
  mergeLines: false,
  retire: false,
  rule: null,
};

/**
 * Scaffold a framework defaults tree into a consumer project.
 *
 * @param {object} config
 * @param {string} config.defaultsDir - Absolute root of the defaults tree (e.g. <framework>/dist/defaults)
 * @param {string} config.outputDir - Absolute consumer project root to scaffold into
 * @param {Object<string, object>} [config.fileMap] - minimatch pattern → rule options (see header)
 * @param {string[]} [config.files] - Only process these absolute source paths (watch single-file mode)
 * @param {Function} [config.transform] - `(contents, item) => contents` global hook, run on every
 *   non-binary file after per-rule processing (e.g. extension's site-token templating pass)
 * @param {object} [config.logger] - `{ log, warn, error }` (defaults to console)
 * @returns {{ written: string[], merged: string[], skipped: string[], removed: string[] }} destination-relative paths per outcome
 */
function applyDefaults(config) {
  config = config || {};

  const defaultsDir = config.defaultsDir;
  const outputDir = config.outputDir;
  const fileMap = config.fileMap || {};
  const only = config.files ? config.files.map((f) => path.resolve(f)) : null;
  const transform = config.transform || null;
  const logger = config.logger || console;

  if (!defaultsDir || !outputDir) {
    throw new Error('[devkit defaults-engine] defaultsDir and outputDir are required');
  }
  if (!jetpack.exists(defaultsDir)) {
    throw new Error(`[devkit defaults-engine] defaultsDir does not exist: ${defaultsDir}`);
  }

  const result = { written: [], merged: [], skipped: [], removed: [] };

  for (const source of walkFiles(defaultsDir)) {
    if (only && !only.includes(source)) {
      continue;
    }

    const relative = path.relative(defaultsDir, source).split(path.sep).join('/');
    const segments = relative.split('/');
    const basename = segments[segments.length - 1];

    // Archive dirs: any non-final `_x` segment (but `_.x` files are renames, not archives).
    const dirSegments = segments.slice(0, -1);
    if (dirSegments.some((s) => s.startsWith('_') && !s.startsWith('_.'))) {
      continue;
    }

    if (basename === '.DS_Store') {
      continue;
    }

    // `.gitkeep` → ensure the directory exists, never copy the file itself.
    if (basename === '.gitkeep') {
      jetpack.dir(path.join(outputDir, ...strippedSegments(segments).slice(0, -1)));
      continue;
    }

    const options = resolveOptions(relative, fileMap);

    // Item passed to rule functions — built from the `_.`-stripped path.
    const stripped = strippedSegments(segments);
    const item = {
      source: path.dirname(source),
      name: stripped[stripped.length - 1],
      destination: stripped.slice(0, -1).join('/'),
    };

    if (typeof options.name === 'function') {
      item.name = options.name(item);
    }
    if (typeof options.path === 'function') {
      item.destination = options.path(item);
    }
    if (typeof options.skip === 'function') {
      options.skip = options.skip(item);
    }
    if (typeof options.overwrite === 'function') {
      options.overwrite = options.overwrite(item);
    }

    const finalRelative = path.join(item.destination, item.name);
    const destination = path.join(outputDir, finalRelative);
    const exists = jetpack.exists(destination);
    const isBinary = BINARY_EXTENSIONS.test(item.name);

    if (options.skip) {
      result.skipped.push(finalRelative);
      continue;
    }

    // Retire: the file never scaffolds. An existing framework-owned-only copy
    // is deleted (one-time heal); consumer content is never destroyed.
    if (options.retire) {
      if (!exists) {
        result.skipped.push(finalRelative);
        continue;
      }

      let owned;
      if (isBinary) {
        owned = jetpack.read(source, 'buffer').equals(jetpack.read(destination, 'buffer'));
      } else {
        // Render the template through the same pipeline the scaffold used, so
        // an untouched consumer copy compares equal.
        let rendered = jetpack.read(source);
        if (options.template) {
          rendered = renderTemplate(rendered, options.template);
        }
        if (transform) {
          rendered = transform(rendered, item);
        }
        owned = isFrameworkOwned(jetpack.read(destination), rendered);
      }

      if (owned) {
        jetpack.remove(destination);
        pruneEmptyDirs(path.dirname(destination), outputDir);
        result.removed.push(finalRelative);
        logger.warn(`Retired ${finalRelative} — framework-owned per-target doc; in a brand monorepo the BRAND ROOT (AGENTS.md / CHANGELOG.md / docs/) is the one doc home`);
      } else {
        result.skipped.push(finalRelative);
        logger.warn(`Kept ${finalRelative} — it carries consumer content. Per-target docs are retired in brand monorepos: move that content to the brand root (AGENTS.md notes / brand CHANGELOG.md / brand docs/), then delete the file`);
      }
      continue;
    }

    // Binary: copy or preserve — no content processing.
    if (isBinary) {
      if (exists && !options.overwrite) {
        result.skipped.push(finalRelative);
        continue;
      }
      jetpack.copy(source, destination, { overwrite: true });
      result.written.push(finalRelative);
      continue;
    }

    let contents = jetpack.read(source);
    let didMerge = false;

    // Per-rule template render happens BEFORE merging, so merges compare
    // rendered framework defaults against the consumer's file.
    if (options.template) {
      contents = renderTemplate(contents, options.template);
    }

    if (options.merge && exists) {
      try {
        contents = mergeJson5Text(jetpack.read(destination), contents);
        didMerge = true;
      } catch (error) {
        logger.error(`Error merging config file ${finalRelative}: ${error.message}`);
        // Fall through to normal processing.
      }
    }

    if (options.mergeLines && exists) {
      try {
        contents = mergeLineBasedFiles(jetpack.read(destination), contents, item.name);
        didMerge = true;
      } catch (error) {
        logger.error(`Error merging line-based file ${finalRelative}: ${error.message}`);
      }
    }

    // Preserve the consumer's file unless a rule says otherwise — except a
    // prior-generation marker artifact, which the framework owns and heals to
    // the current template even under `overwrite: false` (the standalone twin
    // of the retire sweep below).
    if (exists && !options.overwrite && !didMerge && !isLegacyMarkerArtifact(jetpack.read(destination), contents)) {
      result.skipped.push(finalRelative);
      continue;
    }

    if (transform) {
      contents = transform(contents, item);
    }

    // Idempotency: identical content is not a write.
    if (exists && jetpack.read(destination) === contents) {
      result.skipped.push(finalRelative);
      continue;
    }

    jetpack.write(destination, contents);
    (didMerge ? result.merged : result.written).push(finalRelative);
    logger.log(`${didMerge ? 'Merged' : 'Scaffolded'} → ${finalRelative}`);
  }

  return result;
}

// Judge whether an existing consumer file is framework-owned-only (safe to
// retire). Marker files are judged by their Custom section — empty,
// whitespace-only, or exactly the template's shipped boilerplate all count as
// untouched. Marker-less files must match the rendered template outright.
function isFrameworkOwned(existing, rendered) {
  if (hasSectionMarkers(existing)) {
    if (isLegacyMarkerArtifact(existing, rendered)) return true;
    const existingCustom = getCustomSection(existing).trim();
    return existingCustom === '' || existingCustom === getCustomSection(rendered).trim();
  }
  return existing.trim() === rendered.trim();
}

// A generation change: the destination carries the OMEGA marker grammar — which
// only this framework's own scaffold writes — while the current template has
// dropped it. That file is a PRIOR GENERATION's generated copy (e.g. the
// content-bearing CLAUDE.md written before it became the one-line `@AGENTS.md`
// pointer), so comparing it against the current render can never match and the
// framework, not the consumer, owns it.
function isLegacyMarkerArtifact(existing, rendered) {
  return hasSectionMarkers(existing) && !hasSectionMarkers(rendered);
}

// Remove now-empty ancestor dirs of a retired file, stopping at (and never
// removing) rootDir — a retired docs/README.md takes its empty docs/ with it.
function pruneEmptyDirs(dir, rootDir) {
  const root = path.resolve(rootDir);
  let current = path.resolve(dir);
  while (current !== root && current.startsWith(root + path.sep)) {
    if ((jetpack.list(current) || []).length > 0) return;
    jetpack.remove(current);
    current = path.dirname(current);
  }
}

// Depth-first file walk that never follows symlinks.
function* walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      yield* walkFiles(abs);
    } else if (entry.isFile()) {
      yield abs;
    }
  }
}

// `_.name` → `.name` on every segment (dotfiles ship past npm's tarball filter).
function strippedSegments(segments) {
  return segments.map((s) => (s.startsWith('_.') ? s.slice(1) : s));
}

// Last-match-wins option resolution across the file map.
function resolveOptions(relativePath, fileMap) {
  let options = { ...RULE_DEFAULTS };

  for (const pattern in fileMap) {
    if (minimatch(relativePath, pattern, { dot: true })) {
      options = { ...options, ...fileMap[pattern] };
      options.rule = pattern;
    }
  }

  return options;
}

// Minimal `{{ key.path }}` substitution, tolerant of unknown keys.
// Unknown keys render as the original `{{ ... }}` string, so non-template content
// with literal braces (e.g. GitHub Actions `${{ secrets.X }}`) survives.
function renderTemplate(content, context) {
  if (typeof content !== 'string' || !content.includes('{{')) return content;
  return content.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (full, keyPath) => {
    const value = keyPath.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), context);
    return (value === undefined || value === null) ? full : String(value);
  });
}

// JSON5 defaults merge: framework defaults provide shape and
// order; the consumer's values win unless they're the literal string 'default';
// consumer-only keys survive at every nesting level, EXCEPT one holding the
// 'default' sentinel, which is the framework's own unset marker and drops (#926).
// A JSON5 file carries no framework-block marker, so that sentinel is the only
// signal telling a key the framework retired from a key the consumer added.
function mergeJson5Defaults(existingConfig, newConfig) {
  const merged = { ...newConfig };

  function mergeNested(target, source, newDefaults) {
    for (const key in newDefaults) {
      if (Object.prototype.hasOwnProperty.call(newDefaults, key)) {
        const newValue = newDefaults[key];
        const existingValue = source[key];

        if (typeof newValue === 'object' && newValue !== null && !Array.isArray(newValue)) {
          target[key] = target[key] || {};
          mergeNested(target[key], existingValue || {}, newValue);
        } else if (Object.prototype.hasOwnProperty.call(source, key) && existingValue !== 'default') {
          target[key] = existingValue;
        } else {
          target[key] = newValue;
        }
      }
    }

    // Consumer-only keys survive at every level, except a leftover 'default'
    // sentinel: that is the framework's unset marker for a key it no longer
    // declares, so it leaves with the key (#926).
    for (const key in source) {
      if (!Object.prototype.hasOwnProperty.call(newDefaults, key) && source[key] !== 'default') {
        target[key] = source[key];
      }
    }
  }

  mergeNested(merged, existingConfig, newConfig);

  return merged;
}

// The merge WRITE: the consumer's JSON5 is hand-edited, so the merged object is
// never re-stringified over it (that stripped every comment and the trailing
// newline, #928). The merge result is diffed against the file on disk and the
// differences go through @omega.js/config's comment-preserving editor, so only
// the changed value spans move, every other byte survives, and an unchanged merge
// returns the source untouched so the engine's idempotency check skips the write.
// Output always ends with exactly one newline.
function mergeJson5Text(existingText, defaultsText) {
  const JSON5 = require('json5');
  const { applyConfigEdits, applyConfigRemovals } = require('@omega.js/config');

  const existing = JSON5.parse(existingText);
  const merged = mergeJson5Defaults(existing, JSON5.parse(defaultsText));

  const edits = {};
  const removals = [];
  diffConfigPaths(existing, merged, '', edits, removals);

  // Nothing to change is not a write: the file goes back byte for byte, final
  // newline included or not, so a rerun never touches it.
  if (removals.length === 0 && Object.keys(edits).length === 0) {
    return existingText;
  }

  const written = applyConfigEdits(applyConfigRemovals(existingText, removals), edits);

  return written.replace(/\n*$/, '\n');
}

// Diff the merged object against the one on disk into editor operations: dot-paths
// to set (a leaf whose value differs, plus a key or whole branch the file lacks)
// and dot-paths to delete (a key the merge dropped, #926's `default` sentinel).
// Two objects at the same path recurse; anything else (primitive, array, or a
// branch landing where the file has no object) is one value the editor writes whole.
function diffConfigPaths(existing, merged, prefix, edits, removals) {
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

  for (const key of Object.keys(merged)) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    const nextValue = merged[key];
    const priorValue = existing[key];

    if (isObject(nextValue) && isObject(priorValue)) {
      diffConfigPaths(priorValue, nextValue, keyPath, edits, removals);
    } else if (!isDeepStrictEqual(priorValue, nextValue)) {
      edits[keyPath] = nextValue;
    }
  }

  for (const key of Object.keys(existing)) {
    if (!Object.prototype.hasOwnProperty.call(merged, key)) {
      removals.push(prefix ? `${prefix}.${key}` : key);
    }
  }
}

module.exports = { applyDefaults, mergeJson5Defaults, renderTemplate };
