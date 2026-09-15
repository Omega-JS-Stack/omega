// Unit tests for the AMO listing metadata a FIRST Firefox publish carries
// ([#884](https://github.com/Omega-JS-Stack/omega/issues/884)).
//
// addons.mozilla.org reuses the first version's listing on every UPDATE, so
// these three fields (summary, categories, version.license) only exist as a
// problem on the very first `web-ext sign` of an add-on, where their absence is
// an HTTP 400 after a green build. Everything here is pure: the publish task
// writes the JSON and hands the path over, this composes what goes in it.

const defineCases = require('@omega.js/devkit/test/define-cases');
const { AMO_CATEGORIES } = require('@omega.js/config');

const { amoLicense, amoMetadata, AMO_LICENSES, AMO_SUMMARY_MAX } = require('../../../gulp/tasks/utils/amo.js');

const BRAND = { brand: { description: 'A demo extension for the OMEGA stack.' } };

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'AMO listing metadata: the license map, the summary cap, the category slugs',
  tests: [
    {
      name: 'an absent or UNLICENSED license maps to AMO all-rights-reserved (#884)',
      run: async (ctx) => {
        ctx.expect(amoLicense(undefined)).toBe('all-rights-reserved');
        ctx.expect(amoLicense('')).toBe('all-rights-reserved');
        // npm's own word for closed-source commercial code, which is what every
        // scaffolded package.json now carries
        ctx.expect(amoLicense('UNLICENSED')).toBe('all-rights-reserved');
      },
    },

    {
      name: 'an SPDX id AMO accepts passes through, and anything else names the list (#884)',
      run: async (ctx) => {
        for (const id of AMO_LICENSES) {
          ctx.expect(amoLicense(id)).toBe(id);
        }

        // `Unlicense` is a real SPDX id (public domain) and `UNLICENSED` is
        // npm's opposite word, which is why this is a map and not a passthrough
        ctx.expect(amoLicense('Unlicense')).toBe('Unlicense');
        ctx.expect(() => amoLicense('MIT OR Apache-2.0')).toThrow(/MPL-2\.0/);
        ctx.expect(() => amoLicense('GPL-3.0')).toThrow(/GPL-3\.0-only/);
      },
    },

    {
      name: 'the metadata carries summary, categories and version.license (#884)',
      run: async (ctx) => {
        const metadata = amoMetadata({ config: { ...BRAND, categories: ['privacy-security'] }, license: 'MIT' });

        ctx.expect(metadata).toEqual({
          summary: { 'en-US': 'A demo extension for the OMEGA stack.' },
          categories: ['privacy-security'],
          version: { license: 'MIT' },
        });
      },
    },

    {
      name: 'a config that declares no categories gets the schema default (#884)',
      run: async (ctx) => {
        const metadata = amoMetadata({ config: BRAND });

        ctx.expect(metadata.categories).toEqual(['alerts-updates']);
        ctx.expect(metadata.version.license).toBe('all-rights-reserved');
      },
    },

    {
      name: 'a summary past AMO\'s cap is cut, with a warning (#884)',
      run: async (ctx) => {
        const warnings = [];
        const long = `${'x'.repeat(AMO_SUMMARY_MAX)} and then some more.`;
        const metadata = amoMetadata({ config: { brand: { description: long } }, warn: (line) => warnings.push(line) });

        ctx.expect(metadata.summary['en-US'].length).toBe(AMO_SUMMARY_MAX);
        ctx.expect(warnings.length).toBe(1);
        ctx.expect(warnings[0]).toContain('brand.description');

        // A description that fits is never warned about
        const quiet = [];
        amoMetadata({ config: BRAND, warn: (line) => quiet.push(line) });
        ctx.expect(quiet.length).toBe(0);
      },
    },

    {
      name: 'a slug AMO does not know fails here, not at the store (#884)',
      run: async (ctx) => {
        ctx.expect(() => amoMetadata({ config: { ...BRAND, categories: ['productivity'] } })).toThrow(/productivity/);
        ctx.expect(() => amoMetadata({ config: { ...BRAND, categories: ['productivity'] } })).toThrow(/alerts-updates/);

        // Every live slug is accepted, because the list IS @omega.js/config's
        ctx.expect(amoMetadata({ config: { ...BRAND, categories: AMO_CATEGORIES } }).categories).toEqual(AMO_CATEGORIES);
      },
    },

    {
      name: 'a brand with no description refuses instead of submitting an empty listing (#884)',
      run: async (ctx) => {
        ctx.expect(() => amoMetadata({ config: {} })).toThrow(/brand\.description/);
      },
    },
  ],
});
