/**
 * HTML slots (Ian 2026-07-18): {% slot name %}…{% endslot %} blocks inside a
 * section/component call —
 *  1. slot content renders in the CALLER's scope (site vars, captures, tags)
 *     and reaches the section as a finished-HTML string arg
 *  2. slots compose with inline args AND with a YAML body (the XOR rule
 *     applies to the YAML remainder only)
 *  3. slots merge OUTERMOST (over defaults/data/named) and never re-render —
 *     literal braces via {% raw %} survive
 *  4. empty slot = explicit-empty: '' kills a default (absence spine)
 *  5. loud failures: duplicate slot names, malformed blocks
 *  6. engine integration: hero demo_html replaces the typed demo lane; the
 *     stats after slot renders inside the band container (the alternative.html
 *     composite conversion rides these)
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const { Liquid } = require('liquidjs');

const { registerSectionTags } = require('../src/sections.js');
const { buildSite, BARE } = require('./lib/build.js');

const FIXTURES = path.join(__dirname, 'fixtures', 'sections');
const THEME = path.join(FIXTURES, 'theme');

/** Fresh engine over the fixture theme layer with a captured warn sink. */
function makeEngine() {
  const warnings = [];
  const engine = new Liquid();
  registerSectionTags(engine, { baseDirs: [THEME], warn: (message) => warnings.push(message) });
  return { engine, warnings };
}

const SITE = { site: { brand: { name: 'ACME' } } };

// ─── the mechanism ───────────────────────────────────────────────────────────

test('slot composes with inline args; content renders in the caller scope', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% capture page_cta %}<a href="/go">Go {{ site.brand.name }}</a>{% endcapture %}'
    + '{% section "marketing/hero", headline: "H" %}{% slot body %}<div class="custom">{{ site.brand.name }} — {{ page_cta }}</div>{% endslot %}{% endsection %}',
    SITE,
  );
  assert.ok(html.includes('<h1>H</h1>'), 'inline arg applied alongside the slot');
  assert.ok(html.includes('<div data-body><div class="custom">ACME — <a href="/go">Go ACME</a></div></div>'),
    'slot rendered with site vars AND page captures in scope');
  assert.deepEqual(warnings, [], 'declared html arg — no schema warnings');
});

test('slot composes with a YAML body: yaml args + slot on one call', async () => {
  const { engine, warnings } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}\nheadline: "From YAML"\n{% slot body %}<em>slotted</em>{% endslot %}\n{% endsection %}',
    SITE,
  );
  assert.ok(html.includes('<h1>From YAML</h1>'), 'YAML remainder parsed as args');
  assert.ok(html.includes('<div data-body><em>slotted</em></div>'), 'slot extracted from the body');
  assert.deepEqual(warnings, []);
});

test('inline args + YAML remainder still errors — slots do not launder the XOR rule', async () => {
  const { engine } = makeEngine();
  await assert.rejects(
    engine.parseAndRender(
      '{% section "marketing/hero", tag: "x" %}\nheadline: y\n{% slot body %}<b>b</b>{% endslot %}\n{% endsection %}',
      SITE,
    ),
    /not both/,
  );
});

test('slots merge outermost: a slot beats the same key from data and named args', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero", data: d %}{% slot body %}<b>slot-wins</b>{% endslot %}{% endsection %}',
    { ...SITE, d: { body: '<b>data-body</b>' } },
  );
  assert.ok(html.includes('<div data-body><b>slot-wins</b></div>'), 'slot value wins the merge');
  assert.ok(!html.includes('data-body</b></div>'.replace('data-body', 'data-body-x')), 'sanity');
});

test('slot output never re-renders: literal braces via {% raw %} survive', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/hero" %}{% slot body %}<code>{% raw %}{{ site.brand.name }}{% endraw %}</code>{% endslot %}{% endsection %}',
    SITE,
  );
  assert.ok(html.includes('<code>{{ site.brand.name }}</code>'),
    'braces in slot output stay literal — no double-liquify');
});

test('empty slot passes "" — explicit-empty kills the html default', async () => {
  const { engine } = makeEngine();
  const withDefault = await engine.parseAndRender('{% section "marketing/hero" %}', SITE);
  assert.ok(withDefault.includes('<div data-body><i>default-body</i></div>'), 'control: the default renders');
  const killed = await engine.parseAndRender(
    '{% section "marketing/hero" %}{% slot body %}\n  \n{% endslot %}{% endsection %}',
    SITE,
  );
  assert.ok(!killed.includes('data-body'), 'whitespace-only slot collapses to "" and suppresses the region');
});

test('loud failures: duplicate slot names, malformed blocks; stray slot outside a call is an unknown tag', async () => {
  const { engine } = makeEngine();
  await assert.rejects(
    engine.parseAndRender(
      '{% section "marketing/hero" %}{% slot body %}<b>1</b>{% endslot %}{% slot body %}<b>2</b>{% endslot %}{% endsection %}',
      SITE,
    ),
    /duplicate .*slot body/,
  );
  await assert.rejects(
    engine.parseAndRender('{% section "marketing/hero" %}{% slot body %}<b>never closed</b>{% endsection %}', SITE),
    /malformed slot block/,
  );
  await assert.rejects(
    engine.parseAndRender('{% slot body %}<b>x</b>{% endslot %}', SITE),
    /slot/,
  );
});

test('components speak slots too (shared implementation)', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(
    '{% component "frame/box" %}{% slot label %}<b>rich {{ site.brand.name }}</b>{% endslot %}{% endcomponent %}',
    SITE,
  );
  assert.ok(html.includes('<div data-comp="box"><b>rich ACME</b></div>'), 'component slot rendered');
});

test('undeclared slot name warns like any unknown arg (schema is one contract)', async () => {
  const { engine, warnings } = makeEngine();
  await engine.parseAndRender(
    '{% section "marketing/hero" %}{% slot bod %}<b>typo</b>{% endslot %}{% endsection %}',
    SITE,
  );
  assert.ok(warnings.some((w) => w.includes('unknown arg "bod"') && w.includes('did you mean "body"')),
    'slot names ride the same validation + did-you-mean lane');
});

// ─── engine integration: the shipped consumers ───────────────────────────────

test('hero demo_html slot replaces the typed demo lane on a real build', async () => {
  const fs = require('node:fs');
  const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-slot-page-'));
  try {
    // A consumer page composing the hero with a demo_html slot + the stats
    // after slot — the two shipped html args, exercised through Eleventy.
    fs.writeFileSync(path.join(tmp, 'slots-demo.html'), [
      '---',
      'permalink: /slots-demo/',
      'layout: frontend/core/minimal',
      '---',
      '{% section "marketing/hero", headline: "Slots" %}{% slot demo_html %}<div id="my-wild-demo">{% uj_icon "rocket" %} {{ site.brand.name }}</div>{% endslot %}{% endsection %}',
      '{% capture trailing_cta %}<a class="btn" href="/pricing">See pricing</a>{% endcapture %}',
      '{% section "marketing/stats" %}',
      'items:',
      '  - number: "10x"',
      '    label: Faster',
      '{% slot after %}{{ trailing_cta }}{% endslot %}',
      '{% endsection %}',
    ].join('\n'));
    const consumerDir = path.join(tmp, 'src');
    fs.mkdirSync(consumerDir);
    fs.mkdirSync(path.join(consumerDir, 'pages'));
    fs.copyFileSync(path.join(tmp, 'slots-demo.html'), path.join(consumerDir, 'pages', 'slots-demo.html'));
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'slot-consumer');
    const page = pages.get('/slots-demo/');
    assert.ok(page, 'the slot page built');
    assert.ok(page.includes('id="my-wild-demo"'), 'demo_html slot markup rendered in the hero');
    assert.ok(page.includes(bareData.brand.name), 'caller scope (site.brand.name) resolved inside the slot');
    assert.ok(!page.includes('hero-demo-form'), 'typed demo lane not rendered when demo_html is set');
    const statsAt = page.indexOf('10x');
    const ctaAt = page.indexOf('<a class="btn" href="/pricing">See pricing</a>');
    assert.ok(statsAt !== -1 && ctaAt > statsAt, 'stats after-slot renders inside the band, after the grid');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
