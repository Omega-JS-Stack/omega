/**
 * .md composition pages skip the markdown transform (live find 2026-07-19):
 * rendered section HTML pushed through markdown-it grows empty <p> elements
 * at every blank line — REAL grid children that scatter band layouts (both
 * brand homepages' bento/stats broke exactly this way). The engine's
 * omega-composition-liquid preprocessor overrides such pages to liquid;
 * an explicit author templateEngineOverride still wins. Pinned through a
 * real build.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

module.exports = defineCases({
  type: 'group',
  description: 'md-composition',
  tests: [
    {
      name: '.md body composition: markdown never mangles rendered section HTML',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-mdcomp-'));
        const consumerDir = path.join(tmp, 'src');
        fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
        fs.writeFileSync(path.join(consumerDir, 'pages', 'index.md'), [
          '---',
          'layout: blueprint/index',
          'permalink: /',
          '---',
          '',
          '<!-- decorative comment between bands — must not become a paragraph -->',
          '{% section "marketing/stats" %}',
          'items:',
          '  - number: "4"',
          '    label: "Targets"',
          '  - number: "1"',
          '    label: "Config file"',
          '{% endsection %}',
          '',
        ].join('\n'));

        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'md-composition');
          const page = pages.get('/');
          ctx.expect(page, 'home page built').toBeTruthy();
          ctx.expect(page.includes('Targets'), 'section items render').toBeTruthy();
          ctx.expect(!/<p>\s*<\/p>/.test(page), 'no empty <p> phantoms from the markdown transform').toBeTruthy();
          ctx.expect(!page.includes('<p>{%'), 'section calls never render as literal paragraphs').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});
