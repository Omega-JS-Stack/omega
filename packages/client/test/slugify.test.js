/**
 * `slugify(input)`: the ONE slugifier every surface shares. Template-kit's
 * `omega_slugify` filter and the admin post editor both call it, so a page's
 * url, a category page and an editor's draft slug can never disagree.
 *
 * The rule: downcase, delete apostrophes (straight and typographic), turn every
 * run of anything else that is not a letter or digit into one `-`, and trim
 * the edges. UJM deleted apostrophes, so a migrating brand's "Beginner's
 * Guides" category lives at /beginners-guides and must stay there.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { slugify } = require('../src/modules/slugify.js');

// [input, slug, what the row proves]
const TABLE = [
  ["Beginner's Guides", 'beginners-guides', 'a straight apostrophe is deleted, never a separator'],
  ['Beginner’s Music Guide', 'beginners-music-guide', 'a typographic apostrophe is deleted too'],
  ["Don't & Won't", 'dont-wont', 'two apostrophes and a symbol run in one title'],
  ["'Tis the season'", 'tis-the-season', 'an apostrophe at either edge leaves no dash behind'],
  ['Hello World & Friends', 'hello-world-friends', 'a run of spaces and symbols is ONE dash'],
  ['Top 10 Products (2025)', 'top-10-products-2025', 'digits stay, brackets go'],
  ['  Leading and trailing  ', 'leading-and-trailing', 'whitespace at the edges is trimmed, not dashed'],
  ["Don't Panic: A/B Guide/", 'dont-panic-a-b-guide', 'an admin post url: slashes and a colon separate, the apostrophe does not'],
  [42, '42', 'a non-string is stringified first'],
  ['already-a-slug', 'already-a-slug', 'a slug is its own slug'],
  ['---', '', 'nothing but separators is the empty slug'],
  ['', '', 'the empty string stays empty'],
];

module.exports = defineCases({
  type: 'group',
  description: 'slugify',
  tests: TABLE.map(([input, slug, proves]) => ({
    name: `${JSON.stringify(input)} -> ${JSON.stringify(slug)}: ${proves}`,
    run: (ctx) => {
      ctx.expect(slugify(input)).toBe(slug);
    },
  })),
});
