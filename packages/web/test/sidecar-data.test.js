/**
 * The sidecar data lane (#269): consumer page frontmatter is meta-only, so a
 * page's `<page>.11tydata.json` sidecar is the page-level lane for a SHELL
 * layout's band data (its bands read `resolved.*`). Eleventy's cascade CONCATS
 * a sidecar array onto the layout's default array — a page could append to a
 * band, never replace it. `resolved` re-applies the sidecar with the engine's
 * own semantics: arrays REPLACE, objects/strings keep the cascade's merge.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

// A shell layout in miniature: default band data in its own frontmatter, read
// back through `resolved.*` — the shape every packaged shell layout has.
const SHELL_LAYOUT = [
  '---',
  'stats:',
  '  headline: "Layout headline"',
  '  eyebrow: "Layout eyebrow"',
  '  items:',
  '    - label: "Default one"',
  '    - label: "Default two"',
  'contact_methods:',
  '  - label: "Default channel"',
  'note: "layout note"',
  '---',
  '<h2>{{ resolved.stats.headline }}</h2>',
  '<p>{{ resolved.stats.eyebrow }}</p>',
  '<ul>{% for item in resolved.stats.items %}<li>{{ item.label }}</li>{% endfor %}</ul>',
  '<ul>{% for method in resolved.contact_methods %}<li>{{ method.label }}</li>{% endfor %}</ul>',
  '<p>{{ resolved.note }}</p>',
  '',
].join('\n');

function makeConsumer(sidecar, extension = 'json') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-sidecar-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(consumerDir, '_layouts'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, '_layouts', 'shell.html'), SHELL_LAYOUT);
  fs.writeFileSync(path.join(consumerDir, 'pages', 'index.html'), [
    '---',
    'layout: shell',
    'permalink: /',
    '---',
    '',
  ].join('\n'));
  if (sidecar) {
    const body = extension === 'json'
      ? `${JSON.stringify(sidecar, null, 2)}\n`
      : `module.exports = ${JSON.stringify(sidecar, null, 2)};\n`;
    fs.writeFileSync(path.join(consumerDir, 'pages', `index.11tydata.${extension}`), body);
  }
  return { tmp, consumerDir };
}

module.exports = defineCases({
  type: 'group',
  description: 'sidecar-data',
  tests: [
    {
      name: '#269: a sidecar array REPLACES the shell layout default — no cascade concat',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer({
          stats: { items: [{ label: 'Sidecar only' }] },
          contact_methods: [{ label: 'Sidecar channel' }],
        });
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'sidecar-array');
          const html = pages.get('/');
          ctx.expect(html, 'page built').toBeTruthy();

          ctx.expect(html.includes('<li>Sidecar only</li>'), 'the sidecar item renders').toBeTruthy();
          ctx.expect(!html.includes('Default one'), 'the layout default items are REPLACED, not appended to').toBeTruthy();
          ctx.expect(!html.includes('Default two'), 'neither layout default survives the replace').toBeTruthy();

          // Top-level arrays too — the StudyMonkey `contact_methods: null` trap.
          ctx.expect(html.includes('<li>Sidecar channel</li>'), 'a top-level sidecar array renders').toBeTruthy();
          ctx.expect(!html.includes('Default channel'), 'the top-level layout default is replaced').toBeTruthy();

          ctx.expect((html.match(/<li>/g) || []).length, 'exactly the two sidecar items — no concat duplicates').toBe(2);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#269: object and string sidecar keys keep today\'s merge',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer({
          stats: { headline: 'Sidecar headline' },
          note: 'sidecar note',
        });
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'sidecar-merge');
          const html = pages.get('/');
          ctx.expect(html, 'page built').toBeTruthy();

          ctx.expect(html.includes('<h2>Sidecar headline</h2>'), 'the sidecar string wins its key').toBeTruthy();
          ctx.expect(html.includes('<p>Layout eyebrow</p>'), 'the layout\'s other object keys merge underneath').toBeTruthy();
          ctx.expect(html.includes('<p>sidecar note</p>'), 'a top-level string key wins').toBeTruthy();
          ctx.expect(html.includes('<li>Default one</li>') && html.includes('<li>Default two</li>'), 'arrays the sidecar never names keep the layout defaults').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    ...(() => {
      const cases = [];
      // #543: the SAME contract, chosen by file extension — a `.11tydata.js` sidecar
      // concatenated where the `.json` twin replaced (found porting trusteroo: a
      // 6-item faqs.items merged with the layout default into 7 FAQs).
      for (const extension of ['js', 'cjs']) {
        cases.push({
          name: `#543: a .11tydata.${extension} sidecar array REPLACES the layout default too`,
          run: async (ctx) => {
            const { tmp, consumerDir } = makeConsumer({
              stats: { items: [{ label: 'Sidecar only' }] },
              contact_methods: [{ label: 'Sidecar channel' }],
            }, extension);
            try {
              const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, `sidecar-${extension}`);
              const html = pages.get('/');
              ctx.expect(html, 'page built').toBeTruthy();

              ctx.expect(html.includes('<li>Sidecar only</li>'), 'the sidecar item renders').toBeTruthy();
              ctx.expect(!html.includes('Default one') && !html.includes('Default two'), 'the layout defaults are REPLACED, not appended to').toBeTruthy();
              ctx.expect(html.includes('<li>Sidecar channel</li>'), 'a top-level sidecar array renders').toBeTruthy();
              ctx.expect(!html.includes('Default channel'), 'the top-level layout default is replaced').toBeTruthy();
              ctx.expect((html.match(/<li>/g) || []).length, 'exactly the two sidecar items — no concat duplicates').toBe(2);
            } finally {
              fs.rmSync(tmp, { recursive: true, force: true });
            }
          },
        });
      }
      return cases;
    })(),

    {
      name: '#543: object and string keys of a module sidecar keep the cascade merge',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer({
          stats: { headline: 'Sidecar headline' },
          note: 'sidecar note',
        }, 'js');
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'sidecar-js-merge');
          const html = pages.get('/');
          ctx.expect(html, 'page built').toBeTruthy();

          ctx.expect(html.includes('<h2>Sidecar headline</h2>'), 'the sidecar string wins its key').toBeTruthy();
          ctx.expect(html.includes('<p>Layout eyebrow</p>'), 'the layout\'s other object keys merge underneath').toBeTruthy();
          ctx.expect(html.includes('<p>sidecar note</p>'), 'a top-level string key wins').toBeTruthy();
          ctx.expect(html.includes('<li>Default one</li>') && html.includes('<li>Default two</li>'), 'arrays the sidecar never names keep the layout defaults').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#269: a page with no sidecar keeps the layout defaults',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer(null);
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'sidecar-absent');
          const html = pages.get('/');
          ctx.expect(html, 'page built').toBeTruthy();

          ctx.expect(html.includes('<h2>Layout headline</h2>'), 'the layout headline stands').toBeTruthy();
          ctx.expect(html.includes('<li>Default one</li>') && html.includes('<li>Default two</li>'), 'both default items render').toBeTruthy();
          ctx.expect(html.includes('<li>Default channel</li>'), 'the top-level default array renders').toBeTruthy();
          ctx.expect(html.includes('<p>layout note</p>'), 'the layout string stands').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});
