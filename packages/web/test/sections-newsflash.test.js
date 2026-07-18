/**
 * Newsflash section-library lane (cp213+) — builds the mini fixture with the
 * newsflash theme active (the classy-corpus tests never render newsflash
 * layouts) and pins the theme-layer conversions: the marketing/stats
 * OVERRIDE (first theme-layer section override), the newsflash-specific
 * rundown/desks sections, the rule-head + lede components — plus the two
 * contracts the conversion must NOT change yet: fallthrough pages keep
 * classy's cta band (the marketing/cta "goes native" override is a separate
 * declared step), and a body-called marketing/hero still resolves to the
 * classy base.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const nfData = { ...miniData, theme: { id: 'newsflash' } };
const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'sections-nf-test');

test('cp213: newsflash index bands render through the section library', async () => {
  const pages = await buildWith(nfData);
  const home = pages.get('/test/components/hero-demo-input'); // rides the index layout

  // marketing/stats override — nf vocabulary via the rule-head component
  assert.ok(home.includes('By the numbers'), 'stats rule-head label (nf json5 default)');
  assert.ok(home.includes('stat-num'), 'nf stroked numerals');
  assert.ok(home.includes('2M+'), 'items bridged from resolved.stats');
  assert.ok(!home.includes('classy-stats'), 'classy stats markup NOT rendered — the override won');

  // marketing/rundown — rule head + lede + numbered feed
  assert.ok(home.includes('Original reporting'), 'rundown items over the data bridge');
  assert.ok(home.includes('feed-num'), 'numbered feed cluster');
  assert.ok(home.includes('text-accent">morning'), 'lede accent span');

  // marketing/desks — icon cards linked to category pages
  assert.ok(home.includes('Read the desk'), 'desk card affordance');
  assert.ok(home.includes('/blog/categories/tech'), 'desk href to its category page');
});

test('cp213: contracts deliberately NOT flipped — fallthrough cta + body-called hero stay classy', async () => {
  const pages = await buildWith(nfData);

  // /download falls through to the converted classy layout; its cta band must
  // keep classy markup until the declared marketing/cta override step.
  const download = pages.get('/download');
  assert.ok(download.includes('classy-cta'), 'fallthrough page renders the classy cta band');

  // A body-called {% section "marketing/hero" %} resolves consumer → nf →
  // classy; nf ships no hero, so the classy base serves.
  const demo = pages.get('/sections-demo');
  assert.ok(demo.includes('classy-hero'), 'body-called hero falls through to the classy base');
  assert.ok(!demo.includes('hero-title'), 'nf hero vocabulary absent — no nf hero section exists');
});
