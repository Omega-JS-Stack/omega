/**
 * Literal VALUE args never reach the page as markup (#580).
 *
 * Found porting proxifly: `marketing/stats` emitted `stat.number` raw, so a
 * value like `<200ms` opened a tag the html minifier then ate — the page
 * printed a visible `< div>`. Kramdown escaped it in the legacy build, so the
 * defect only exists in OMEGA, and it exists on every band that prints an
 * authored value.
 *
 * The line the audit drew: an arg naming a literal VALUE — a stat number, a
 * hero card number, a timeline year, a shell command, a terminal transcript
 * line, a code-panel token, a price-card catalog value — is TEXT and gets
 * escaped. Prose args (headline, description, label, title, quote) stay raw:
 * brands author inline `<em>` in them today (the playground's pages do), and
 * the `html` schema type / slot blocks are the finished-markup lane by design.
 *
 * `escape_once` and not `escape`: a brand that worked around this by authoring
 * `&lt;200ms` keeps rendering `<200ms`, and the filter stays idempotent.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const { Liquid } = require('liquidjs');
const { registerLiquid } = require('@omega.js/template-kit');
const { resolveFontAwesomeRoots } = require('@omega.js/devkit/icons');

const { registerSectionTags } = require('../src/sections.js');

const PKG = path.resolve(__dirname, '..');
const BASE = path.join(PKG, 'themes', 'base');
const CORE_ICONS = path.join(PKG, 'core', 'icons');

/** Fresh engine over the real base layer, wired like src/engine.js does. */
function makeEngine() {
  const warnings = [];
  const engine = new Liquid();
  const fa = resolveFontAwesomeRoots();
  registerSectionTags(engine, { baseDirs: [BASE], warn: (message) => warnings.push(message) });
  registerLiquid(engine, {
    icons: {
      fontAwesomeDirs: [CORE_ICONS, ...fa.svgsDirs],
      aliasFile: fa.aliasFile,
      flagsDir: path.join(CORE_ICONS, 'flags'),
      style: 'solid',
    },
  });
  return { engine, warnings };
}

// Every value slot the audit found, with the minimum body that puts it on the
// page and the `<`-carrying value a brand would really author.
const VALUE_SLOTS = [
  ['marketing/stats', 'stat number', 'items:\n  - number: "<200ms"\n    label: "Median response"\n'],
  ['about/hero', 'facts rail number', 'facts:\n  - number: "<5 min"\n    label: "Setup"\n'],
  ['marketing/hero', 'hero card number', 'cards:\n  - number: "<1s"\n    label: "Cold start"\n'],
  ['marketing/hero', 'hero command', 'command: "omega deploy <target>"\n'],
  ['marketing/cta', 'cta command', 'command: "omega deploy <target>"\n'],
  ['about/timeline', 'timeline year', 'items:\n  - year: "<2017"\n    title: "Before"\n    description: "Prehistory."\n'],
  [
    'marketing/bento',
    'terminal transcript',
    'items:\n  - type: terminal\n    title: "One command"\n    description: "Ship it."\n'
    + '    terminal:\n      command: "omega build <target>"\n      out: "<1s per page"\n      ok: "<38s total"\n',
  ],
  [
    'marketing/bento',
    'code panel tokens',
    'config_demo:\n  label: "// omega.json5 <trimmed>"\n  name: "Acme <inc>"\n  color: "<accent>"\n'
    + 'items:\n  - type: code\n    title: "One config"\n    description: "Every surface."\n',
  ],
];

for (const [name, slot, body] of VALUE_SLOTS) {
  test(`#580: ${name} escapes its ${slot} — a literal < never opens a tag`, async () => {
    const { engine, warnings } = makeEngine();
    const html = await engine.parseAndRender(`{% section "${name}" %}\n${body}{% endsection %}`, {});

    assert.ok(html.includes('&lt;'), 'the authored < ships as an entity');
    assert.ok(!/<(?:200ms|5 |1s|target>|2017|38s|accent>|inc>|trimmed>)/.test(html),
      'and never as an open tag the minifier can eat');
    assert.deepEqual(warnings, [], 'the audited args are all declared');
  });
}

test('#580: the price card feature list escapes its catalog value too', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(
    '{% component "pricing/features" %}\nfeatures:\n  - name: "Latency"\n    value: "<200ms"\n{% endcomponent %}',
    {},
  );

  assert.ok(html.includes('&lt;200ms'), 'the catalog value ships as an entity');
  assert.ok(!html.includes('<200ms'), 'and never opens a tag');
});

test('#580: an already-escaped value is not double-escaped — the brand workaround keeps rendering', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/stats" %}\nitems:\n  - number: "&lt;200ms"\n    label: "Median response"\n{% endsection %}',
    {},
  );

  assert.ok(html.includes('>&lt;200ms<'), 'escape_once leaves the entity alone');
  assert.ok(!html.includes('&amp;lt;'), 'no second pass over the ampersand');
});

test('#580: prose args keep their authored markup — the <em> lane is untouched', async () => {
  const { engine } = makeEngine();
  const html = await engine.parseAndRender(
    '{% section "marketing/stats" %}\nitems:\n  - number: "99.98%"\n    label: "Uptime <em>always</em>"\n{% endsection %}',
    {},
  );

  assert.ok(html.includes('Uptime <em>always</em>'), 'a prose label still renders its markup');
  assert.ok(html.includes('>99.98%<'), 'while a value with nothing to escape is byte-identical');
});
