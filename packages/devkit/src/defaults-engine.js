// applyDefaults(config) — the shared OMEGA defaults-scaffolding engine.
//
// Every framework ships a defaults tree (src/defaults/ → dist/defaults/) that
// setup copies into the consumer project. The copy rules lived as two divergent
// implementations (BXM's gulp FILE_MAP task — the real one — and EM's plain-fs
// copyDefaults; UJM carries a third copy of the BXM shape). This is the single
// plain-fs engine, a normalized superset of both.
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
//   merge      bool           JSON5 defaults-merge with the existing file
//   mergeLines bool           OMEGA marker-section line merge (.env/.gitignore/AGENTS.md)
//   retire     bool           brand-context per-app doc retirement: NEVER scaffold
//                             the file; an existing framework-owned-only copy is
//                             DELETED (one-time heal — the brand root is the doc
//                             home), a copy carrying consumer content stays with a
//                             loud move-it warning (never destroyed)
//
// Engine built-ins (not expressed in the file map):
//   - `_.name` segments lose the leading `_` (dotfiles ship past npm's filter)
//   - non-final segments starting `_` (but not `_.`) are ARCHIVE dirs — skipped
//     (reference material that ships in the framework package, e.g. EM's `_mas/`)
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
const jetpack = require('fs-jetpack');
const { minimatch } = require('minimatch');
const { mergeLineBasedFiles, hasSectionMarkers, getCustomSection } = require('./merge-line-files');

// Files with these extensions copy byte-for-byte and never go through
// template/merge/transform (matches BXM's binary detection list).
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
 *   non-binary file after per-rule processing (BXM's site-token templating pass)
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
        logger.warn(`[defaults] Retired ${finalRelative} — framework-owned per-app doc; in a brand monorepo the BRAND ROOT (AGENTS.md / CHANGELOG.md / docs/) is the one doc home`);
      } else {
        result.skipped.push(finalRelative);
        logger.warn(`[defaults] Kept ${finalRelative} — it carries consumer content. Per-app docs are retired in brand monorepos: move that content to the brand root (AGENTS.md notes / brand CHANGELOG.md / brand docs/), then delete the file`);
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
    // rendered framework defaults against the consumer's file (EM semantic).
    if (options.template) {
      contents = renderTemplate(contents, options.template);
    }

    if (options.merge && exists) {
      try {
        const JSON5 = require('json5');
        const merged = mergeJson5Defaults(JSON5.parse(jetpack.read(destination)), JSON5.parse(contents));
        contents = JSON5.stringify(merged, null, 2);
        didMerge = true;
      } catch (error) {
        logger.error(`[defaults] Error merging config file ${finalRelative}: ${error.message}`);
        // Fall through to normal processing.
      }
    }

    if (options.mergeLines && exists) {
      try {
        contents = mergeLineBasedFiles(jetpack.read(destination), contents, item.name);
        didMerge = true;
      } catch (error) {
        logger.error(`[defaults] Error merging line-based file ${finalRelative}: ${error.message}`);
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
    logger.log(`[defaults] ${didMerge ? 'Merged' : 'Scaffolded'} → ${finalRelative}`);
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

// Last-match-wins option resolution across the file map (BXM's getFileOptions).
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

// Minimal `{{ key.path }}` substitution (EM's tolerant renderer — the standard).
// Unknown keys render as the original `{{ ... }}` string, so non-template content
// with literal braces (e.g. GitHub Actions `${{ secrets.X }}`) survives.
function renderTemplate(content, context) {
  if (typeof content !== 'string' || !content.includes('{{')) return content;
  return content.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (full, keyPath) => {
    const value = keyPath.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), context);
    return (value === undefined || value === null) ? full : String(value);
  });
}

// JSON5 defaults merge (BXM's mergeConfigs): framework defaults provide shape and
// order; the consumer's values win unless they're the literal string 'default';
// consumer-only keys survive at every nesting level.
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

    // Consumer-only keys survive at every level.
    for (const key in source) {
      if (!Object.prototype.hasOwnProperty.call(newDefaults, key)) {
        target[key] = source[key];
      }
    }
  }

  mergeNested(merged, existingConfig, newConfig);

  return merged;
}

module.exports = { applyDefaults, mergeJson5Defaults, renderTemplate };
