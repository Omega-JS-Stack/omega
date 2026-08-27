/**
 * #517 — the team hub's three missing homes. Porting operst found the layout
 * takes no args for the copy a real team page carries: the portrait grid had
 * no head cluster ("The people behind the magic" + subline), members had
 * nowhere to put their one-line bio on the hub (it still renders on the member
 * page), and the mission band rendered no h2. All three are optional: a hub
 * that authors none renders exactly what it always did.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

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

test('#517: the portrait grid takes a head cluster — every line lands', async () => {
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
    assert.ok(html, 'the team hub built');

    assert.ok(html.includes('<span class="omega-micro">Who we are</span>'), 'the eyebrow, as bare words');
    assert.ok(html.includes('The people behind the'), 'the headline');
    assert.ok(html.includes('<em>magic</em>'), 'the accent word');
    assert.ok(html.includes('Nine humans, one product, no committees.'), 'and the sub line');

    const headAt = html.indexOf('The people behind the');
    const gridAt = html.indexOf('class="omega-person"');
    assert.ok(headAt < gridAt, 'the head heads the grid it belongs to');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#517: a member bio renders under the role; a member without one renders nothing', async () => {
  const { tmp, consumerDir } = makeConsumer(null);
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'team-hub-bios');
    const html = pages.get('/team');
    assert.ok(html, 'the team hub built');

    assert.ok(html.includes('<p class="omega-person__desc">Wrote the first program, and still ships on Fridays.</p>'),
      'the authored bio lands in the card, in the vocabulary the theme already styles');
    assert.equal((html.match(/omega-person__desc/g) || []).length, 1, 'exactly one — the bioless member gets no empty paragraph');

    const roleAt = html.indexOf('omega-person__role');
    const bioAt = html.indexOf('omega-person__desc');
    assert.ok(roleAt < bioAt, 'the bio reads under name and position');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#517: the mission band renders an authored headline as its h2', async () => {
  const { tmp, consumerDir } = makeConsumer({ mission_headline: 'Our mission' });
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'team-hub-mission');
    const html = pages.get('/team');
    assert.ok(html, 'the team hub built');

    assert.ok(html.includes('<h2 class="omega-display omega-display--section">'), 'through the shared head cluster, like every other band h2');
    assert.ok(html.includes('Our mission'), 'saying what the page authored');

    const headAt = html.indexOf('Our mission');
    const quoteAt = html.indexOf('omega-quote__text');
    assert.ok(headAt < quoteAt, 'above the quote it heads');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#517: all three absent — the hub renders exactly what it always did', async () => {
  const { tmp, consumerDir } = makeConsumer(null);
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'team-hub-bare');
    const html = pages.get('/team');
    assert.ok(html, 'the team hub built');

    // The grid runs straight off the masthead, the way it always has, and the
    // quote band opens on the quote — the principles head between them is the
    // one head this page has always carried.
    const gridAt = html.indexOf('class="omega-person"');
    const principlesAt = html.indexOf('omega-duo');
    const listEndAt = html.indexOf('omega-rowlist');
    const quoteAt = html.indexOf('omega-quote');
    assert.ok(!html.slice(0, gridAt).includes('omega-section-head'), 'no head cluster above the grid');
    assert.ok(!html.slice(gridAt, principlesAt).includes('<h2'), 'no stray band heading between grid and principles');
    assert.ok(!html.slice(listEndAt, quoteAt).includes('<h2'), 'and none over the mission quote');
    assert.ok(html.includes('Ada Lovelace') && html.includes('Alan Turing'), 'while the grid itself is untouched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
