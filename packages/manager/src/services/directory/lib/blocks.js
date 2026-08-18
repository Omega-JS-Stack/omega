/**
 * The directory payload — brand IDENTITY plus the opt-in BLOCKS the brand
 * declares — and the list of sections the framework OWNS in the entry.
 *
 * Identity is not optional: a directory entry with no name addresses nothing.
 * The repo slugs come from @omega.js/config's one derivation (#290) — the same
 * `{ owner, name, repo }` the backend hands consumers as
 * `config.resolved.github` — never re-derived here.
 *
 * BLOCKS is the extension point (#246). One entry per publishable block,
 * naming the brand-config section it reads; a block crosses only when the
 * brand DECLARES that section, which is what "opt-in blocks" means. Adding the
 * next block is one entry here plus its schema line in @omega.js/config.
 *
 * Sections are pushed VERBATIM. Nothing is redacted on the way out, because
 * nothing secret can be in them: these are schema-known public config keys and
 * @omega.js/config hard-fails secret-shaped keys before any merge happens.
 */
const { brandRepo } = require('@omega.js/config');

// Block name → the brand-config section it publishes.
const BLOCKS = {
  // Guest-post / link-insertion terms, priced per placement. Legacy
  // omega-manager carried the same shape at `.brands/<id>/config.json`
  // `sponsorships` — the field mapping is in docs/manager/directory.md.
  sponsorships: (config) => config.sponsorships,
};

// Every top-level field of the entry the framework owns, block or not. The
// write masks ALL of them, so a section the brand drops from config is
// removed from the entry too — and every OTHER field of the document (whatever
// the hub itself owns: order counts, moderation state) survives untouched.
const OWNED_SECTIONS = ['brand', 'github', ...Object.keys(BLOCKS)];

/**
 * Whether a config section is declared richly enough to publish. An absent
 * section and an empty one say the same thing: the brand is not offering it.
 *
 * @param {*} section - The raw config value.
 * @returns {boolean}
 */
function isDeclared(section) {
  return Boolean(section)
    && typeof section === 'object'
    && !Array.isArray(section)
    && Object.keys(section).length > 0;
}

/**
 * Build the directory entry for a brand.
 *
 * @param {object} config - The resolved brand config.
 * @returns {object} The entry document — only the sections that resolve.
 */
function buildEntry(config) {
  const entry = {
    brand: {
      id: config.brand.id,
      name: config.brand.name,
    },
  };

  if (config.brand.url) {
    entry.brand.url = config.brand.url;
  }

  // '' unless BOTH halves resolve (#290) — half an address addresses nothing,
  // and an entry is better without the key than with a broken one.
  const github = brandRepo(config);
  if (github.repo) {
    entry.github = github;
  }

  for (const [name, read] of Object.entries(BLOCKS)) {
    const section = read(config);
    if (isDeclared(section)) {
      entry[name] = section;
    }
  }

  return entry;
}

/**
 * The framework-owned slice of the entry as it stands in the directory today —
 * what `buildEntry` output is diffed against. Everything else in the document
 * belongs to the hub and is not this service's business.
 *
 * @param {object|null} current - The document read from the directory.
 * @returns {object} Only the owned sections that are present.
 */
function ownedSlice(current) {
  const slice = {};

  for (const key of OWNED_SECTIONS) {
    if (current && current[key] !== undefined) {
      slice[key] = current[key];
    }
  }

  return slice;
}

module.exports = { BLOCKS, OWNED_SECTIONS, buildEntry, ownedSlice };
