/**
 * The alternatives hub prints each competitor's authored description (#563).
 *
 * Found by the optiic blind verify: every `_alternatives/*.md` authors
 * `alternative.competitor.description`, the UJM hub printed it under each row
 * title, and the OMEGA hub emitted only "<brand> vs <competitor>" plus the
 * "View comparison" link — brand-authored copy with no destination, silently,
 * on every brand with an alternatives collection.
 *
 * Built from a BARE consumer carrying two alternatives, one with a description
 * and one without, so the assertions read the framework's own markup and both
 * shapes come off ONE build.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

/** One alternative doc's source. */
const alternative = (name, description) => [
  '---',
  'layout: blueprint/alternatives/alternative',
  'alternative:',
  '  competitor:',
  `    name: "${name}"`,
  ...(description ? [`    description: "${description}"`] : []),
  '---',
].join('\n');

let hub;

module.exports = defineCases({
  type: 'group',
  description: 'alternatives-hub',
  setup: async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-alternatives-'));
    const consumerDir = path.join(tmp, 'src');
    fs.mkdirSync(path.join(consumerDir, '_alternatives'), { recursive: true });
    fs.writeFileSync(path.join(consumerDir, '_alternatives', 'described.md'), alternative('Described', 'The incumbent everyone starts on.'));
    fs.writeFileSync(path.join(consumerDir, '_alternatives', 'nodesc.md'), alternative('Nodesc'));

    try {
      const pages = await buildSite(consumerDir, bareData, {}, 'alternatives-hub');
      hub = pages.get('/alternatives');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
  tests: [
    {
      name: '#563: the row prints the competitor description under its title',
      run: (ctx) => {
        ctx.expect(hub, 'the hub built').toBeTruthy();
        ctx.expect(hub.includes(`${bareData.brand.name} vs Described`), 'the row title is unchanged').toBeTruthy();
        ctx.expect(hub.includes('The incumbent everyone starts on.'), 'and the authored description has somewhere to land').toBeTruthy();

        // Under the TITLE, inside the row's first cell — not in the meta cell that
        // carries the "View comparison" link.
        const row = hub.slice(hub.indexOf(`${bareData.brand.name} vs Described`));
        ctx.expect(/vs Described<\/span>\s*<span class="omega-rowlist__desc">\s*The incumbent everyone starts on\.\s*<\/span>/.test(row), 'the description follows the title in its own element').toBeTruthy();
        ctx.expect(row.indexOf('The incumbent everyone starts on.') < row.indexOf('omega-rowlist__meta'), 'and precedes the comparison link').toBeTruthy();
      },
    },

    {
      name: '#563: a competitor with no description renders the row exactly as before',
      run: (ctx) => {
        // The description is BRAND copy, not framework copy: absent, nothing is
        // invented and no empty element ships.
        const row = hub.slice(hub.indexOf(`${bareData.brand.name} vs Nodesc`));

        ctx.expect(hub.includes(`${bareData.brand.name} vs Nodesc`), 'the row still renders').toBeTruthy();
        ctx.expect(row.indexOf('omega-rowlist__desc') === -1 || row.indexOf('omega-rowlist__desc') > row.indexOf('omega-rowlist__meta'), 'no empty description element between the title and the comparison link').toBeTruthy();
      },
    },
  ],
});
