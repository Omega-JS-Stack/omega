/**
 * Frontmatter/sidecar Liquid sees the consumer's `_data` globals (#542, found
 * porting trusteroo). A `.11tydata.*` sidecar rendered against a scope carrying
 * `site` and nothing else: `{{ resolved.config.brand.name }}` worked, `{{ brands.size }}`
 * rendered EMPTY with no warning — a sidecar could not reference the data files
 * sitting beside it. The scope is now the same cascade a template render gets.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

const SHELL_LAYOUT = [
  '---',
  'blurb: "layout blurb"',
  '---',
  '<h1>{{ resolved.meta.title }}</h1>',
  '<p id="blurb">{{ resolved.blurb }}</p>',
  '<p id="tally">{{ resolved.tally }}</p>',
  '',
].join('\n');

function makeConsumer(sidecarExtension) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dataglobals-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(consumerDir, '_data'), { recursive: true });
  fs.mkdirSync(path.join(consumerDir, '_layouts'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, '_data', 'brands.json'), JSON.stringify([
    { name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' },
  ]));
  fs.writeFileSync(path.join(consumerDir, '_layouts', 'shell.html'), SHELL_LAYOUT);
  fs.writeFileSync(path.join(consumerDir, 'pages', 'index.html'), [
    '---',
    'layout: shell',
    'permalink: /',
    'meta:',
    '  title: "{{ brands.size }} brands · {{ resolved.config.brand.name }}"',
    '---',
    '',
  ].join('\n'));
  const sidecar = {
    blurb: 'We list {{ brands.size }} brands',
    tally: '{{ brands[0].name }} leads',
  };
  const body = sidecarExtension === 'json'
    ? `${JSON.stringify(sidecar, null, 2)}\n`
    : `module.exports = ${JSON.stringify(sidecar, null, 2)};\n`;
  fs.writeFileSync(path.join(consumerDir, 'pages', `index.11tydata.${sidecarExtension}`), body);
  return { tmp, consumerDir };
}

module.exports = defineCases({
  type: 'group',
  description: 'data-globals-frontmatter',
  tests: [
    ...(() => {
      const cases = [];
      for (const extension of ['json', 'js']) {
        cases.push({
          name: `#542: a .11tydata.${extension} sidecar renders the consumer's _data globals`,
          run: async (ctx) => {
            const { tmp, consumerDir } = makeConsumer(extension);
            try {
              const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, `data-globals-${extension}`);
              const html = pages.get('/');
              ctx.expect(html, 'page built').toBeTruthy();

              ctx.expect(html.includes('<p id="blurb">We list 3 brands</p>'), 'the sidecar reads the _data file beside it').toBeTruthy();
              ctx.expect(html.includes('<p id="tally">Alpha leads</p>'), 'and indexes into it like any template would').toBeTruthy();
            } finally {
              fs.rmSync(tmp, { recursive: true, force: true });
            }
          },
        });
      }
      return cases;
    })(),

    {
      name: '#542: page frontmatter reads the same globals, the config included',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer('json');
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'data-globals-meta');
          const html = pages.get('/');
          ctx.expect(html, 'page built').toBeTruthy();

          ctx.expect(html.includes('<h1>3 brands · BareCo</h1>'), 'a _data ref and a config ref render side by side').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});
