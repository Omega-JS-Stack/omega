/**
 * markdown-it typographer (#547): Kramdown smartened quotes, apostrophes,
 * dashes and ellipses at build time, so every brand converted off Jekyll drifts
 * the moment its prose renders straight. `typographer: true` is the hard
 * default on BOTH markdown instances — Eleventy's own (a .md body) and the
 * engine's (template-kit's markdownify filter) — so the same prose is the same
 * punctuation wherever it renders.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

function makeConsumer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-typographer-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'prose.md'), [
    '---',
    'layout: frontend/core/base',
    'permalink: /prose',
    '---',
    '',
    'It\'s the brand\'s "flagship" plan -- the one everyone asks about...',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(consumerDir, 'pages', 'filtered.html'), [
    '---',
    'layout: frontend/core/base',
    'permalink: /filtered',
    '---',
    '<div id="apostrophe">{{ "It\'s here" | omega_markdownify }}</div>',
    '<div id="quotes">{{ \'He said "hi"\' | omega_markdownify }}</div>',
    '',
  ].join('\n'));
  return { tmp, consumerDir };
}

module.exports = defineCases({
  type: 'group',
  description: 'markdown-typographer',
  tests: [
    {
      name: '#547: a .md body renders straight punctuation as smart (Kramdown parity)',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer();
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'typographer-md');
          const html = pages.get('/prose');
          ctx.expect(html, 'the prose page built').toBeTruthy();

          ctx.expect(html.includes('It’s the brand’s'), 'apostrophes curl').toBeTruthy();
          ctx.expect(html.includes('“flagship”'), 'double quotes curl').toBeTruthy();
          ctx.expect(html.includes('plan – the one'), '-- becomes an en dash').toBeTruthy();
          ctx.expect(html.includes('asks about…'), '... becomes an ellipsis').toBeTruthy();
          ctx.expect(!html.includes("It's the brand's"), 'no straight apostrophes survive in the body').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#547: the markdownify filter smartens the same way (one markdown contract)',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer();
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'typographer-filter');
          const html = pages.get('/filtered');
          ctx.expect(html, 'the filtered page built').toBeTruthy();

          ctx.expect(html.includes('It’s here'), 'the engine markdown instance curls apostrophes').toBeTruthy();
          ctx.expect(html.includes('He said “hi”'), 'the engine markdown instance curls quotes').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});
