/**
 * `omega migrate`: a legacy page's sitemap opt-out becomes `meta.index: false`.
 *
 * "Indexable but out of the sitemap" is not a concept: one `meta.index`
 * decides the robots tag, the sitemap, pages.json and llms.txt alike. A legacy
 * page that opted out of the sitemap meant "keep this page out of the machine
 * files", so the codemod writes the flag that still says so, instead of leaving
 * the engine to strip the key and drop the page's intent.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const yaml = require('js-yaml');
const { applyRules } = require('../src/migrate/codemod.js');

/** The frontmatter of a converted page, parsed (a duplicate key throws). */
function frontmatterOf(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`no frontmatter fence in:\n${text}`);

  return yaml.load(match[1]);
}

const BODY = ['<h1>Thanks for subscribing</h1>', ''];

module.exports = defineCases({
  type: 'group',
  description: 'migrate-sitemap',
  tests: [
    {
      name: 'rules: `sitemap: false` becomes `meta.index: false`, and no sitemap key survives',
      run: (ctx) => {
        const input = ['---', 'layout: frontend/core/base', 'permalink: /thanks', 'sitemap: false', '---', ...BODY].join('\n');

        const { text } = applyRules(input, 'thanks.html');
        const front = frontmatterOf(text);

        ctx.expect(front.meta && front.meta.index, `the page is kept out of every machine file: ${text}`).toBe(false);
        ctx.expect('sitemap' in front, 'the retired key is gone').toBe(false);
        ctx.expect(front.permalink, 'the rest of the frontmatter is untouched').toBe('/thanks');
        ctx.expect(text.endsWith(BODY.join('\n')), 'and so is the body').toBe(true);
      },
    },

    {
      name: 'rules: `sitemap.include: false` joins the page\'s own meta block as `index: false`',
      run: (ctx) => {
        const input = [
          '---',
          'layout: frontend/core/base',
          'permalink: /thanks',
          'meta:',
          '  title: "Thanks"',
          'sitemap:',
          '  include: false',
          '---',
          ...BODY,
        ].join('\n');

        const { text } = applyRules(input, 'thanks.html');
        const front = frontmatterOf(text);

        ctx.expect(front.meta, `one meta block, carrying both keys: ${text}`).toEqual({ title: 'Thanks', index: false });
        ctx.expect('sitemap' in front, 'the retired key is gone').toBe(false);
      },
    },
  ],
});
