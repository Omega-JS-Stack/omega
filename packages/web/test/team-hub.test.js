/**
 * #517 — the team hub's three missing homes. Porting operst found the layout
 * takes no args for the copy a real team page carries: the portrait grid had
 * no head cluster ("The people behind the magic" + subline), members had
 * nowhere to put their one-line bio on the hub (it still renders on the member
 * page), and the mission band rendered no h2. All three are optional: a hub
 * that authors none renders exactly what it always did.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

const MEMBERS = [
  {
    file: 'ada-lovelace.md',
    front: [
      'member:',
      '  id: ada-lovelace',
      '  name: "Ada Lovelace"',
      '  position: "Founder"',
      '  bio: "Wrote the first program, and still ships on Fridays."',
    ],
  },
  {
    file: 'alan-turing.md',
    front: [
      'member:',
      '  id: alan-turing',
      '  name: "Alan Turing"',
      '  position: "Engineer"',
    ],
  },
];

/** A consumer /team riding the blueprint, with its hub data in the sidecar. */
function makeConsumer(sidecar) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-team-hub-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages', 'team'), { recursive: true });
  fs.mkdirSync(path.join(consumerDir, '_team'), { recursive: true });
  fs.writeFileSync(
    path.join(consumerDir, 'pages', 'team', 'index.md'),
    ['---', 'layout: blueprint/team/index', 'permalink: /team', '---', ''].join('\n'),
  );
  if (sidecar) {
    fs.writeFileSync(
      path.join(consumerDir, 'pages', 'team', 'index.11tydata.json'),
      `${JSON.stringify(sidecar, null, 2)}\n`,
    );
  }
  for (const member of MEMBERS) {
    fs.writeFileSync(
      path.join(consumerDir, '_team', member.file),
      ['---', 'layout: blueprint/team/member', ...member.front, '---', ''].join('\n'),
    );
  }
  return { tmp, consumerDir };
}

module.exports = defineCases({
  type: 'group',
  description: 'team-hub',
  tests: [
    {
      name: '#517: the portrait grid takes a head cluster — every line lands',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer({
          grid_head: {
            superheadline: 'Who we are',
            headline: 'The people behind the',
            headline_accent: 'magic',
            subheadline: 'Nine humans, one product, no committees.',
          },
        });
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'team-hub-head');
          const html = pages.get('/team');
          ctx.expect(html, 'the team hub built').toBeTruthy();

          ctx.expect(html.includes('<span class="omega-micro">Who we are</span>'), 'the eyebrow, as bare words').toBeTruthy();
          ctx.expect(html.includes('The people behind the'), 'the headline').toBeTruthy();
          ctx.expect(html.includes('<em>magic</em>'), 'the accent word').toBeTruthy();
          ctx.expect(html.includes('Nine humans, one product, no committees.'), 'and the sub line').toBeTruthy();

          const headAt = html.indexOf('The people behind the');
          const gridAt = html.indexOf('class="omega-person"');
          ctx.expect(headAt < gridAt, 'the head heads the grid it belongs to').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#517: a member bio renders under the role; a member without one renders nothing',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer(null);
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'team-hub-bios');
          const html = pages.get('/team');
          ctx.expect(html, 'the team hub built').toBeTruthy();

          ctx.expect(html.includes('<p class="omega-person__desc">Wrote the first program, and still ships on Fridays.</p>'), 'the authored bio lands in the card, in the vocabulary the theme already styles').toBeTruthy();
          ctx.expect((html.match(/omega-person__desc/g) || []).length, 'exactly one — the bioless member gets no empty paragraph').toBe(1);

          const roleAt = html.indexOf('omega-person__role');
          const bioAt = html.indexOf('omega-person__desc');
          ctx.expect(roleAt < bioAt, 'the bio reads under name and position').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#517: the mission band renders an authored headline as its h2',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer({ mission_headline: 'Our mission' });
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'team-hub-mission');
          const html = pages.get('/team');
          ctx.expect(html, 'the team hub built').toBeTruthy();

          ctx.expect(html.includes('<h2 class="omega-display omega-display--section">'), 'through the shared head cluster, like every other band h2').toBeTruthy();
          ctx.expect(html.includes('Our mission'), 'saying what the page authored').toBeTruthy();

          const headAt = html.indexOf('Our mission');
          const quoteAt = html.indexOf('omega-quote__text');
          ctx.expect(headAt < quoteAt, 'above the quote it heads').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    {
      name: '#517: all three absent — the hub renders exactly what it always did',
      run: async (ctx) => {
        const { tmp, consumerDir } = makeConsumer(null);
        try {
          const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'team-hub-bare');
          const html = pages.get('/team');
          ctx.expect(html, 'the team hub built').toBeTruthy();

          // The grid runs straight off the masthead, the way it always has, and the
          // quote band opens on the quote — the principles head between them is the
          // one head this page has always carried.
          const gridAt = html.indexOf('class="omega-person"');
          const principlesAt = html.indexOf('omega-duo');
          const listEndAt = html.indexOf('omega-rowlist');
          const quoteAt = html.indexOf('omega-quote');
          ctx.expect(!html.slice(0, gridAt).includes('omega-section-head'), 'no head cluster above the grid').toBeTruthy();
          ctx.expect(!html.slice(gridAt, principlesAt).includes('<h2'), 'no stray band heading between grid and principles').toBeTruthy();
          ctx.expect(!html.slice(listEndAt, quoteAt).includes('<h2'), 'and none over the mission quote').toBeTruthy();
          ctx.expect(html.includes('Ada Lovelace') && html.includes('Alan Turing'), 'while the grid itself is untouched').toBeTruthy();
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});
