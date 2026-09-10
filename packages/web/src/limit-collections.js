/**
 * Dev-mode collection limiting (#190) — the successor to
 * jekyll-uj-powertools' limit-collections generator: a brand whose blog runs
 * to thousands of documents samples that collection LOCALLY so the dev build
 * stays fast. Config is `targets.web.dev.limitCollections`
 * ({ posts: 50, randomize: true }).
 *
 * The sample is chosen from the collection's files on disk at configure time
 * and everything outside it is dropped by a preprocessor (an explicit `false`
 * skips the template), so a limited collection costs nothing at all — no
 * pages, no collection entries, no taxonomy terms. Development builds only:
 * a production build always ships the whole site, and it never samples even
 * when the key is set. The config is still VALIDATED in production, so a
 * typo fails on `omega build` too.
 */
const fs = require('node:fs');
const path = require('node:path');
const Logger = require('@omega.js/devkit/logger');
const { isProduction } = require('./mode-helpers.js');

const logger = new Logger('limit-collections');

// The engine's content collections ↔ the consumer dir each one's documents
// live in, plus the order collections.js lists them in: posts and updates
// read newest-first, team and alternatives ascend. Dated post filenames sort
// by date, so a path sort reproduces both orders — first-N keeps the
// documents the site shows FIRST.
const COLLECTIONS = {
  posts: { dir: '_posts', newestFirst: true },
  alternatives: { dir: '_alternatives', newestFirst: false },
  team: { dir: '_team', newestFirst: false },
  updates: { dir: '_updates', newestFirst: true },
};

// The sampling flag rides in the same map as the limits (legacy parity) — no
// collection is ever named `randomize`.
const RANDOMIZE_KEY = 'randomize';

/**
 * The samplable collections: the engine's own, plus the brand's declared ones
 * (#207), whose documents live in `_<name>/` and list URL-ascending.
 * @param {Array<object>} [collections] - the brand's collections (readCollections' output)
 * @returns {object} collection name → { dir, newestFirst }
 */
function samplable(collections) {
  const map = { ...COLLECTIONS };
  for (const collection of collections || []) {
    map[collection.name] = { dir: collection.dir, newestFirst: false };
  }
  return map;
}

// The template extensions the engine's collection lanes render.
const DOCUMENT_EXT = /\.(md|html|liquid)$/;

/**
 * Read and validate the `dev.limitCollections` config block. Every problem is
 * an ERROR, not a warning: an unlimited collection is indistinguishable from
 * a working config until someone counts the pages.
 * @param {object} [config] - the raw dev.limitCollections value
 * @param {Array<object>} [collections] - the brand's own collections (readCollections' output)
 * @returns {{ entries: Array<{ name: string, limit: number }>, randomize: boolean }|null} null when unset
 * @throws {Error} on an unknown collection name, a non-positive limit, or a non-boolean randomize
 */
function readLimits(config, collections) {
  if (config === undefined || config === null) return null;

  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(
      `targets.web.dev.limitCollections must be a map of collection name → max documents `
      + `— got ${Array.isArray(config) ? 'array' : typeof config}`,
    );
  }

  const entries = [];
  const known = samplable(collections);

  for (const [name, value] of Object.entries(config)) {
    if (name === RANDOMIZE_KEY) {
      if (typeof value !== 'boolean') {
        throw new Error(`targets.web.dev.limitCollections.${RANDOMIZE_KEY} must be a boolean — got ${typeof value}`);
      }
      continue;
    }

    if (!known[name]) {
      throw new Error(
        `targets.web.dev.limitCollections.${name} is not an OMEGA collection `
        + `— the collections are ${Object.keys(known).join(', ')}`,
      );
    }

    if (!Number.isInteger(value) || value < 1) {
      throw new Error(
        `targets.web.dev.limitCollections.${name} must be a positive integer (max documents) `
        + `— got ${JSON.stringify(value)}`,
      );
    }

    entries.push({ name, limit: value });
  }

  return { entries, randomize: config[RANDOMIZE_KEY] === true };
}

/**
 * Sample a collection's documents down to `limit`. Deterministic first-N by
 * default; `randomize` shuffles first, so the sample spreads across the whole
 * collection (categories, authors, years) instead of one slice of it. No seed
 * — a dev build is free to draw a different sample each boot.
 * @param {string[]} documents - the collection's documents, in collection order
 * @param {number} limit - max documents to keep
 * @param {boolean} [randomize] - draw a random sample instead of the first N
 * @returns {string[]} the kept documents (the input itself when it already fits)
 */
function sampleDocuments(documents, limit, randomize) {
  if (documents.length <= limit) return documents;
  if (!randomize) return documents.slice(0, limit);

  // Fisher–Yates over a copy — the caller's list is never reordered.
  const pool = [...documents];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, limit);
}

/**
 * A collection's documents on disk, in the order the collection lists them.
 * @param {string} consumerDir - the consumer site (Eleventy input dir)
 * @param {string} name - collection name (a samplable() key)
 * @param {Array<object>} [collections] - the brand's own collections (readCollections' output)
 * @returns {string[]} absolute file paths
 */
function collectionDocuments(consumerDir, name, collections) {
  const known = samplable(collections);
  const root = path.join(consumerDir, known[name].dir);
  if (!fs.existsSync(root)) return [];

  const documents = fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && DOCUMENT_EXT.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();

  return known[name].newestFirst ? documents.reverse() : documents;
}

/**
 * Apply the configured dev limits to an Eleventy config: validate, sample,
 * log what was cut, and skip the documents outside the sample.
 * @param {object} eleventyConfig
 * @param {object} options
 * @param {string} options.consumerDir - the consumer site (Eleventy input dir)
 * @param {object} [options.limits] - the raw dev.limitCollections config
 * @param {Array<object>} [options.collections] - the brand's own collections (readCollections' output)
 * @param {string} [options.environment] - the build's environment (#717, read through the one surface) — production never samples
 * @returns {{ dropped: Set<string>, limited: Array<{ name: string, kept: number, total: number }> }|null} null when nothing is limited
 */
function applyCollectionLimits(eleventyConfig, options) {
  const config = readLimits(options.limits, options.collections);
  if (!config || !config.entries.length || isProduction.call(options)) return null;

  const dropped = new Set();
  const limited = [];

  for (const { name, limit } of config.entries) {
    const documents = collectionDocuments(options.consumerDir, name, options.collections);
    if (documents.length <= limit) continue;

    const kept = new Set(sampleDocuments(documents, limit, config.randomize));
    for (const document of documents) {
      if (!kept.has(document)) dropped.add(document);
    }
    limited.push({ name, kept: kept.size, total: documents.length });

    // Loud, every build: a sampled site must never read as the whole site.
    logger.warn(
      `${name}: SAMPLED to ${kept.size} of ${documents.length} documents`
      + `${config.randomize ? ' (random sample)' : ''} — this build is not the whole site `
      + `(targets.web.dev.limitCollections; production builds never sample)`,
    );
  }

  if (!dropped.size) return null;

  // An explicit `false` drops the template before it renders. Virtual
  // templates (sample content, default pages) carry no path on disk, so they
  // are never in the drop set and ride through untouched.
  eleventyConfig.addPreprocessor('omega-limit-collections', '*', (data) => {
    if (dropped.has(path.resolve(data.page.inputPath))) return false;
    return undefined;
  });

  return { dropped, limited };
}

module.exports = { applyCollectionLimits, readLimits, sampleDocuments, collectionDocuments, COLLECTIONS };
