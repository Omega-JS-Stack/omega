/**
 * #491: frontend/core/minimal's masthead h1 is gated on its own arg.
 *
 * The layout rendered `<h1>{{ resolved.meta.breadcrumb }}</h1>` unconditionally,
 * so every document page with no breadcrumb shipped a BLANK h1 above its body —
 * and a body carrying its own title then shipped two h1s, the first empty. That
 * is the accessibility checklist's one-h1 rule, broken by the layout itself.
 * Legacy UJM did the same; OMEGA owns the layout now.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, miniData, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

/** Every h1 open tag in a rendered page. */
const h1s = (html) => html.match(/<h1[\s>]/g) || [];

/**
 * Build a throwaway consumer whose pages ride frontend/core/minimal.
 * @param {string} name - namespace for the caller's .omega output dirs
 * @param {object} pages - page filename → file contents
 * @returns {Promise<Map<string, string>>} url → rendered content
 */
async function buildMinimal(name, pages) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-minimal-h1-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  for (const [file, contents] of Object.entries(pages)) {
    fs.writeFileSync(path.join(consumerDir, 'pages', file), contents);
  }

  try {
    return await buildSite(consumerDir, { ...bareData, ...miniData }, {}, name);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = defineCases({
  type: 'group',
  description: 'minimal-heading',
  tests: [
    {
      name: '#491: a minimal page with no breadcrumb ships no empty h1 above its body',
      run: async (ctx) => {
        const built = await buildMinimal('minimal-h1-absent', {
          'doc.md': [
            '---',
            'layout: frontend/core/minimal',
            'permalink: /doc',
            'meta:',
            '  title: "Authorize"',
            '---',
            '',
            '# Authorize your account',
            '',
            'Body copy.',
          ].join('\n'),
        });

        const html = built.get('/doc');
        ctx.expect(html, 'the page built').toBeTruthy();
        ctx.expect(!/<h1[^>]*>\s*<\/h1>/.test(html), `no blank h1: ${html.slice(html.indexOf('<h1'), html.indexOf('<h1') + 200)}`).toBeTruthy();
        ctx.expect(h1s(html).length, 'exactly one h1 — the document\'s own title').toBe(1);
        ctx.expect(html.includes('Authorize your account'), 'the body title is the one that survives').toBeTruthy();
      },
    },

    {
      name: '#491: an authored breadcrumb still renders the masthead h1',
      run: async (ctx) => {
        const built = await buildMinimal('minimal-h1-present', {
          'doc.md': [
            '---',
            'layout: frontend/core/minimal',
            'permalink: /doc',
            'meta:',
            '  title: "Privacy policy"',
            '  breadcrumb: "Privacy policy"',
            '  description: "How we handle your data."',
            '---',
            '',
            'Body copy.',
          ].join('\n'),
        });

        const html = built.get('/doc');
        ctx.expect(html, 'the page built').toBeTruthy();
        ctx.expect(h1s(html).length, 'the masthead h1 is the page\'s one h1').toBe(1);
        ctx.expect(/<h1 class="omega-display omega-display--page"[^>]*>\s*Privacy policy/.test(html), 'the breadcrumb renders in the display h1, exactly as before').toBeTruthy();
        ctx.expect(html.includes('How we handle your data.'), 'the description line is untouched').toBeTruthy();
      },
    },
  ],
});
