// The AMO listing metadata a FIRST Firefox publish has to carry
// ([#884](https://github.com/Omega-JS-Stack/omega/issues/884)).
//
// addons.mozilla.org reuses the FIRST version's listing on every update, so
// `web-ext sign` with credentials alone is enough forever after. Creating the
// listing is the one moment AMO demands a summary, at least one category, and a
// license, and without them the submission comes back "Bad Request" with
// `version.license: this field is required` after a perfectly green build.
// The publish task writes what this composes to `.temp/amo-metadata.json` and
// passes it as `--amo-metadata`.
//
// The category slugs live in @omega.js/config beside the schema rule that
// validates a brand's picks, so the list a brand is checked against and the
// list the store is sent are the same one.

const { AMO_CATEGORIES, schemaDefaults } = require('@omega.js/config');

// AMO's own cap on a listing summary. A longer one is a 400, so it is cut here
// (loudly) rather than at the store.
const AMO_SUMMARY_MAX = 250;

// What AMO calls "all rights reserved", its answer for a closed-source add-on.
const AMO_ALL_RIGHTS_RESERVED = 'all-rights-reserved';

// The SPDX ids AMO accepts on a listed version. Anything else (a compound
// expression, a deprecated id like `GPL-3.0`) has to be picked by hand in the
// AMO dashboard, so it fails here instead of at the store.
const AMO_LICENSES = ['MPL-2.0', 'Apache-2.0', 'MIT', 'ISC', 'BSD-2-Clause', 'GPL-2.0-only', 'GPL-3.0-only', 'LGPL-2.1-only', 'LGPL-3.0-only', 'AGPL-3.0-only', 'Unlicense'];

/**
 * The AMO license id a target's `package.json` license field means.
 *
 * Absent or npm's `UNLICENSED` (the field every OMEGA scaffold writes, npm's
 * word for closed-source commercial code) is AMO's `all-rights-reserved`; an
 * SPDX id AMO accepts passes through untouched. Note that SPDX's `Unlicense`
 * (public domain) is the OPPOSITE of npm's `UNLICENSED`, which is exactly why
 * this is a map and not a passthrough.
 *
 * @param {string} [pkgLicense] - The `license` field of the target's package.json.
 * @returns {string} The AMO license id.
 * @throws {Error} When the id is one AMO does not take, listing the ones it does.
 */
function amoLicense(pkgLicense) {
  const license = typeof pkgLicense === 'string' ? pkgLicense.trim() : '';

  if (!license || license === 'UNLICENSED') {
    return AMO_ALL_RIGHTS_RESERVED;
  }

  if (license === AMO_ALL_RIGHTS_RESERVED || AMO_LICENSES.includes(license)) {
    return license;
  }

  throw new Error(`package.json license "${license}" is not one addons.mozilla.org accepts. Use UNLICENSED (closed source, listed as ${AMO_ALL_RIGHTS_RESERVED}) or one of: ${AMO_LICENSES.join(', ')}`);
}

/**
 * The `--amo-metadata` payload for a first Firefox publish.
 *
 * @param {object} options
 * @param {object} options.config - The resolved config (brand.description, categories).
 * @param {string} [options.license] - The target package.json `license` field.
 * @param {function} [options.warn] - Warning sink (default: silent).
 * @returns {{ summary: object, categories: string[], version: { license: string } }} The metadata AMO needs to CREATE the listing.
 * @throws {Error} When the brand names no description, or a category is not an AMO slug.
 */
function amoMetadata(options) {
  options = options || {};

  const config = options.config || {};
  const warn = options.warn || (() => {});
  const description = config.brand && config.brand.description;

  // The summary is the line the store page leads with, and AMO refuses a
  // listing without one. A brand that named no description has nothing to
  // submit, and a generated stand-in would ship to the live listing.
  if (typeof description !== 'string' || !description.trim()) {
    throw new Error('Cannot create the Firefox listing: set brand.description in config/omega.json5 (it is the store summary).');
  }

  const summary = description.trim();
  const cut = summary.length > AMO_SUMMARY_MAX;

  if (cut) {
    warn(`brand.description is ${summary.length} characters and the AMO summary caps at ${AMO_SUMMARY_MAX} - the listing summary is cut. Shorten it in config/omega.json5 to choose where.`);
  }

  // Absent picks take the schema's own answer rather than a second copy of it
  // here: the default is declared once, on the `categories` rule.
  const categories = config.categories || schemaDefaults('extension').categories;
  const unknown = categories.filter((slug) => !AMO_CATEGORIES.includes(slug));

  if (unknown.length) {
    throw new Error(`categories ${unknown.map((slug) => `"${slug}"`).join(', ')} are not AMO categories. Use one or more of: ${AMO_CATEGORIES.join(', ')}`);
  }

  return {
    summary: { 'en-US': cut ? summary.slice(0, AMO_SUMMARY_MAX) : summary },
    categories,
    version: { license: amoLicense(options.license) },
  };
}

module.exports = { amoLicense, amoMetadata, AMO_LICENSES, AMO_SUMMARY_MAX, AMO_ALL_RIGHTS_RESERVED };
