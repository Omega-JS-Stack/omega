/**
 * jekyll-compat.test.js: the retired Jekyll filter names and their successors.
 *
 * The Jekyll-era names stay registered only to throw, naming the omega_* filter
 * that replaced each one. This suite pins that table; register-liquid.test.js
 * proves the throws and the successors through a real engine, and
 * filters.test.js pins the successors' semantics.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const compat = require('../src/jekyll-compat.js');

module.exports = defineCases({
  type: 'group',
  description: 'jekyll-compat',
  tests: [
    {
      name: '#830: COMPAT_REPLACEMENTS maps each retired Jekyll filter to its omega_* successor',
      run: (ctx) => {
        ctx.expect(compat.COMPAT_REPLACEMENTS).toEqual({
          slugify: 'omega_slugify',
          date_to_xmlschema: 'omega_date_xmlschema',
          date_to_rfc822: 'omega_date_rfc822',
          strip_html: 'omega_strip_html',
          number_of_words: 'omega_number_of_words',
          where_exp: 'omega_where',
          group_by_exp: 'omega_group_by',
          relative_url: 'omega_relative_url',
          absolute_url: 'omega_absolute_url',
          markdownify: 'omega_markdownify',
          jsonify: 'omega_jsonify',
        });
      },
    },
  ],
});
