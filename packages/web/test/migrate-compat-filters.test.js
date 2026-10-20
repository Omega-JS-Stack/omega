/**
 * `omega migrate` and the retired Jekyll filters: the `compatFilters` codemod
 * rewrites `| <old>` to its omega_* successor, the liquid-lint names a leftover
 * as an error, and a consumer build that still calls one fails naming the fix.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { applyRules } = require('../src/migrate/codemod.js');
const { lintText } = require('../src/migrate/lint.js');
const { setEnvironment } = require('@omega.js/config/environment');
const { configureOmega } = require('../src/index.js');

const MINI = path.join(__dirname, 'fixtures', 'mini-site');

// Every message down a wrapped error: Eleventy wraps the render error it caught.
function errorText(error) {
  const seen = new Set();
  const messages = [];
  for (let each = error; each && !seen.has(each); each = each.originalError || each.cause) {
    seen.add(each);
    messages.push(String(each.message));
  }
  return messages.join('\n');
}

module.exports = defineCases({
  type: 'group',
  description: 'migrate-compat-filters',
  tests: [
    {
      name: '#830: compatFilters rewrites a Jekyll filter to its omega_* name in one edit, and a rerun makes none',
      run: (ctx) => {
        const first = applyRules('{{ page.date | date_to_xmlschema }}', 'unit.html');
        ctx.expect(first.text).toBe('{{ page.date | omega_date_xmlschema }}');
        ctx.expect(first.edits.length, `one edit: ${JSON.stringify(first.edits)}`).toBe(1);
        ctx.expect(first.edits[0].rule, 'reported under its rule').toBe('compat-filters');

        const again = applyRules(first.text, 'unit.html');
        ctx.expect(again.text).toBe(first.text);
        ctx.expect(again.edits.length, 'the rewrite is a fixed point').toBe(0);
      },
    },

    {
      name: '#830: compatFilters rewrites only a Liquid call, never a markdown table cell or a shell pipe',
      run: (ctx) => {
        const input = [
          '| Filter | Does |',
          '| --- | --- |',
          '| jsonify | encode |',
          '',
          '```sh',
          'cat a | strip_html',
          '```',
          '',
          '{{ x | jsonify }}',
        ].join('\n');
        const { text, edits } = applyRules(input, 'src/pages/filters.md');
        ctx.expect(text).toBe(input.replace('{{ x | jsonify }}', '{{ x | omega_jsonify }}'));
        ctx.expect(edits.filter((edit) => edit.rule === 'compat-filters').length, `one edit, the Liquid call: ${JSON.stringify(edits)}`).toBe(1);
      },
    },

    {
      name: '#830: the lint names a leftover Jekyll filter as an error with its replacement',
      run: (ctx) => {
        const findings = lintText('{% assign drafts = site.posts | where_exp: "post", "post.draft" %}', 'lint.html');
        const leftovers = findings.filter((finding) => finding.check === 'jekyll-filter');
        ctx.expect(leftovers.length, `one jekyll-filter finding: ${JSON.stringify(findings)}`).toBe(1);
        ctx.expect(leftovers[0].severity).toBe('error');
        ctx.expect(leftovers[0].message).toBe('where_exp is a Jekyll filter: use omega_where');

        const migrated = lintText('{% assign drafts = site.posts | omega_where: "post", "post.draft" %}', 'lint.html');
        ctx.expect(migrated, 'the successor is a known filter').toEqual([]);
      },
    },

    {
      name: '#830: a consumer build whose page still calls `| slugify` fails naming omega_slugify and the migrate fix',
      run: async (ctx) => {
        const consumerDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-compat-filters-')));
        const out = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-compat-filters-out-')));
        fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
        fs.writeFileSync(path.join(consumerDir, 'pages', 'legacy-slug.html'), [
          '---',
          'permalink: /legacy-slug',
          '---',
          '<p>{{ "Ian\'s Title" | slugify }}</p>',
        ].join('\n'));

        try {
          setEnvironment('development');
          const Eleventy = require('@11ty/eleventy').default;
          const elev = new Eleventy(consumerDir, out, {
            quietMode: true,
            configPath: false,
            config: (eleventyConfig) => {
              eleventyConfig.setUseTemplateCache(false);
              return configureOmega(eleventyConfig, {
                consumerDir,
                siteData: JSON.parse(fs.readFileSync(path.join(MINI, 'site-data.json'), 'utf8')),
                assetManifest: { js: { main: '/assets/js/main-TEST.js', pages: {} }, css: { main: '/assets/css/main-TEST.css', pages: {}, layouts: {} } },
              });
            },
          });

          let failure = null;
          await elev.toJSON().catch((error) => { failure = error; });
          ctx.expect(failure, 'the build fails').toBeTruthy();
          const text = errorText(failure);
          ctx.expect(text, 'the failure is the page\'s own').toMatch('legacy-slug.html');
          ctx.expect(text, 'the failure names the successor').toMatch('slugify is a Jekyll filter: use omega_slugify');
          ctx.expect(text, 'and the command that rewrites it').toMatch('npx omega migrate');
        } finally {
          fs.rmSync(consumerDir, { recursive: true, force: true });
          fs.rmSync(out, { recursive: true, force: true });
        }
      },
    },
  ],
});
