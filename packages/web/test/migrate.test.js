/**
 * `omega migrate` — the B4 codemod + liquid-lint suite.
 *
 * Three layers: rule units (pure text transforms, incl. the false-positive
 * guards), SEMANTIC proofs (the rewrites render identically / correctly
 * through the real LiquidJS + template-kit adapter — the same path the
 * engine uses), and the end-to-end migration of a synthetic UJM consumer in
 * a temp dir (config conversion validated through the real @omega.js/config
 * loader, legacy files removed, check mode writes nothing). Plus the runtime
 * composition the migration relies on: cloud/payment/analytics at
 * their omega.json5 homes render into the chrome's composed spots.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const JSON5 = require('json5');
const sass = require('sass');
const { Liquid } = require('liquidjs');
const { registerLiquid } = require('@omega.js/template-kit');
const { loadConfig } = require('@omega.js/config');
const { applyRules, applyJsRules, applyJsonRules, runCodemod } = require('../src/migrate/codemod.js');
const { convertConfig, serializeOmega } = require('../src/migrate/config-convert.js');
const { lintText } = require('../src/migrate/lint.js');
const { runMigration } = require('../src/migrate/index.js');
const { configureOmega } = require('../src/index.js');

const PKG = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Rule units
// ---------------------------------------------------------------------------

test('rules: page.resolved, includes, canonical, page props, analytics spelling', () => {
  const input = [
    '{{ page.resolved.meta.title }}',
    '{% include /modules/adsense.html %}',
    '<link rel="canonical" href="{{ page.canonical.url }}">',
    '{{ page.content }} {{ page.slug }} {{ page.post_id }} {{ page.url }}',
    '{{ site.analytics.google }} {{ resolved.analytics.tiktok }}',
  ].join('\n');
  const { text, edits } = applyRules(input, 'unit.html');
  const lines = text.split('\n');
  assert.strictEqual(lines[0], '{{ resolved.meta.title }}');
  assert.strictEqual(lines[1], '{% include modules/adsense.html %}');
  assert.strictEqual(lines[2], '<link rel="canonical" href="{{ site.url }}{{ page.url }}">');
  assert.strictEqual(lines[3], '{{ content }} {{ page.fileSlug }} {{ post_id }} {{ page.url }}');
  // …then config-reads (#611) moves both roots onto the one namespace config
  // lives in now.
  assert.strictEqual(lines[4], '{{ resolved.config.analytics.providers.google.id }} {{ resolved.config.analytics.providers.tiktok.id }}');
  assert.strictEqual(edits.length, 6, 'one edit recorded per changed line per rule');
});

test('rules: legacy uj_ tags/filters and site.uj globals become omega_ / site.omega', () => {
  const input = [
    '{% uj_icon "rocket", "fa-fw" %}{{ title | uj_title_case }}',
    '<img src="{{ site.uj.placeholder.src }}" data-lazy="@src {{ image }}">',
    '<span class="uj-password-show"></span>',
    'A path like /assets/uj_legacy.png stays a path',
  ].join('\n');
  const { text } = applyRules(input, 'unit.html');
  const lines = text.split('\n');
  assert.strictEqual(lines[0], '{% omega_icon "rocket", "fa-fw" %}{{ title | omega_title_case }}');
  assert.strictEqual(lines[1], '<img src="{{ site.omega.placeholder.src }}" data-lazy="@src {{ image }}">');
  assert.strictEqual(lines[2], '<span class="omega-password-show"></span>');
  assert.strictEqual(lines[3], 'A path like /assets/uj_legacy.png stays a path', 'only known names rename');
});

test('rules: bracket layouts rewritten only on layout lines', () => {
  const input = [
    'layout: themes/[ site.theme.id ]/frontend/core/base',
    '  layout: themes/classy/frontend/pages/index',
    'Text mentioning themes/[ site.theme.id ]/frontend stays',
  ].join('\n');
  const { text } = applyRules(input, 'unit.md');
  const lines = text.split('\n');
  assert.strictEqual(lines[0], 'layout: frontend/core/base');
  assert.strictEqual(lines[1], '  layout: frontend/pages/index');
  // Untouched by BOTH rules: the bracket rule only answers to `layout:` lines,
  // and config-reads only counts LIQUID context (#611 F4) — a legacy `[ … ]`
  // bracket in prose is neither.
  assert.strictEqual(lines[2], 'Text mentioning themes/[ site.theme.id ]/frontend stays');
});

test('rules: false-positive guards — filenames, valid page props, manual props', () => {
  const input = [
    '![Words on a page](@post/word-of-mouth-words-on-a-page.png)',
    '<a href="/landing-page.html">{{ page.date }}</a>',
    '{{ page.next.url }}',
  ].join('\n');
  const { text, findings } = applyRules(input, 'unit.md');
  const lines = text.split('\n');
  assert.strictEqual(lines[0], '![Words on a page](@post/word-of-mouth-words-on-a-page.png)', 'filename untouched');
  assert.strictEqual(lines[1], '<a href="/landing-page.html">{{ page.date }}</a>', 'valid prop + path untouched');
  assert.strictEqual(lines[2], '{{ page.next.url }}', 'manual prop not rewritten');
  assert.ok(findings.some((finding) => finding.message.includes('page.next')), 'manual prop flagged');
});

test('rules: page.<key> inside a loop binding the same name is skipped, not silently broken (#541)', () => {
  const input = [
    '{{ page.tag }}',
    '{% for tag in collections.tags %}',
    '  {% if tag != page.tag.name %}<a href="{{ tag.url }}">{{ tag.name }}</a>{% endif %}',
    '{% endfor %}',
    '{% tablerow category in collections.categories %}',
    '  {% if category != page.category.name %}{{ category.name }}{% endif %}',
    '{% endtablerow %}',
    '{{ page.tag }}',
  ].join('\n');
  const { text, findings } = applyRules(input, 'src/pages/blog/tag.html');
  const lines = text.split('\n');
  assert.strictEqual(lines[0], '{{ tag }}', 'outside the loop the rename still happens');
  assert.strictEqual(
    lines[2],
    '  {% if tag != page.tag.name %}<a href="{{ tag.url }}">{{ tag.name }}</a>{% endif %}',
    'the loop binds `tag`: renaming would compare the loop item to itself and make the guard always true',
  );
  assert.strictEqual(lines[5], '  {% if category != page.category.name %}{{ category.name }}{% endif %}', '{% tablerow %} binds the same way');
  assert.strictEqual(lines[7], '{{ tag }}', 'and past the loop the rename is back');

  const bound = findings.filter((finding) => finding.check === 'page-props' && /loop/.test(finding.message));
  assert.deepStrictEqual(bound.map((finding) => finding.line), [3, 6], `one warn per skipped line: ${JSON.stringify(findings)}`);
  assert.strictEqual(bound[0].severity, 'error', 'a skipped rename needs a hand-port');
  assert.ok(/page\.tag/.test(bound[0].message), 'the warn names the reference it left alone');
  assert.ok(/`tag`/.test(bound[0].message), 'and the loop variable that shadows it');
});

test('rules: the loop-scope skip names the FILE and line through the codemod (#541)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-541-'));
  try {
    fs.mkdirSync(path.join(root, 'src', 'pages', 'blog'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'pages', 'blog', 'tag.html'), [
      '{% for tag in collections.tags %}',
      '{% if tag != page.tag.name %}{{ tag.name }}{% endif %}',
      '{% endfor %}',
    ].join('\n'));
    const { findings } = runCodemod(root, { write: false });
    const bound = findings.filter((finding) => finding.check === 'page-props' && /loop/.test(finding.message));
    assert.strictEqual(bound.length, 1, `one finding: ${JSON.stringify(findings)}`);
    assert.strictEqual(bound[0].file, path.join('src', 'pages', 'blog', 'tag.html'), 'the warn names the file');
    assert.strictEqual(bound[0].line, 2, 'and the line');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rules: tag-arg hoist scoped to the tag span', () => {
  const input = '<a title="{{ t }}">{% omega_icon "{{ stat.icon }} fa-2x" %}</a>';
  const { text } = applyRules(input, 'unit.html');
  const lines = text.split('\n');
  assert.strictEqual(lines[0].trim(), '{% capture omega_migrate_arg_1 %}{{ stat.icon }} fa-2x{% endcapture %}');
  assert.ok(lines[1].includes('title="{{ t }}"'), 'HTML attribute interpolation untouched');
  assert.ok(lines[1].includes('{% omega_icon omega_migrate_arg_1 %}'), 'tag arg replaced with the capture var');
});

// ---------------------------------------------------------------------------
// Rule units — the WM → @omega.js/client rename surface (#248)
// ---------------------------------------------------------------------------

test('rules: client markup hooks — data-wm-bind and the signout trigger class (#248)', () => {
  const input = [
    '<div class="dropdown" data-wm-bind="@show auth.user" hidden>',
    '<button class="btn btn-danger auth-signout-btn">Sign out</button>',
    "document.querySelector('.auth-signout-btn')",
  ].join('\n');
  const { text } = applyRules(input, 'unit.html');
  const lines = text.split('\n');
  assert.strictEqual(lines[0], '<div class="dropdown" data-omega-bind="@show auth.user" hidden>');
  assert.strictEqual(lines[1], '<button class="btn btn-danger omega-signout">Sign out</button>');
  assert.strictEqual(lines[2], "document.querySelector('.omega-signout')", 'the same rename in JS the codemod also walks');
});

test('rules: client markup renames the EXACT tokens — longer names are other names (#248)', () => {
  const input = [
    '<button class="auth-signout-btn-large">Bigger</button>',
    '<button class="js-auth-signout-btn">Hooked</button>',
    '<div data-wm-bind-once="@show auth.user" x-data-wm-bind="nope"></div>',
    '<button class="auth-signout-btn" data-wm-bind="@show auth.user">Sign out</button>',
  ].join('\n');
  const { text } = applyRules(input, 'unit.html');
  const lines = text.split('\n');
  assert.strictEqual(lines[0], '<button class="auth-signout-btn-large">Bigger</button>', 'a longer class is a DIFFERENT class');
  assert.strictEqual(lines[1], '<button class="js-auth-signout-btn">Hooked</button>', 'a prefixed class is a different class too');
  assert.strictEqual(lines[2], '<div data-wm-bind-once="@show auth.user" x-data-wm-bind="nope"></div>', 'the attribute name matches whole, both ends');
  assert.strictEqual(lines[3], '<button class="omega-signout" data-omega-bind="@show auth.user">Sign out</button>', 'the exact tokens still rename');
});

test('rules: section descriptors (.json) get the markup rename and NOTHING else (#248)', () => {
  const input = [
    '{',
    '  "class": "btn auth-signout-btn",',
    '  "attributes": { "data-wm-bind": "@show auth.user" },',
    '  "include": "{% include /modules/adsense.html %}",',
    '  "heading": "{{ page.post_id }}"',
    '}',
  ].join('\n');
  const { text, edits } = applyJsonRules(input, 'src/_includes/frontend/sections/account.json');
  const lines = text.split('\n');
  assert.strictEqual(lines[1], '  "class": "btn omega-signout",');
  assert.strictEqual(lines[2], '  "attributes": { "data-omega-bind": "@show auth.user" },');
  assert.strictEqual(lines[3], '  "include": "{% include /modules/adsense.html %}",', 'the template rules never run over a descriptor');
  assert.strictEqual(lines[4], '  "heading": "{{ page.post_id }}"', 'a JSON key is not a Jekyll frontmatter read');
  assert.strictEqual(edits.length, 2, 'one edit per changed line, client-markup only');
});

test('rules: frontmatter `web_manager:` becomes `client:` under `config:`, body prose untouched (#248, #607)', () => {
  const input = [
    '---',
    'layout: frontend/core/base',
    'web_manager:',
    '  auth:',
    '    config:',
    '      policy: "authenticated"',
    '  cookieConsent:',
    '    enabled: false',
    '---',
    'Prose about a web_manager: key stays prose.',
  ].join('\n');
  const { text } = applyRules(input, 'unit.html');
  const lines = text.split('\n');
  // #607 runs after the rename: `client` is a config section, so the whole
  // block lands under the page's `config:` parent, indented one level.
  assert.strictEqual(lines[2], 'config:');
  assert.strictEqual(lines[3], '  client:');
  assert.strictEqual(lines[4], '    auth:', 'the block children ride along untouched');
  // #383: the sub-key was renamed too, and a page that disabled the old name
  // would silently stop disabling anything.
  assert.strictEqual(lines[7], '    consent:', 'cookieConsent: becomes consent:');
  assert.strictEqual(lines[8], '      enabled: false', 'its value is untouched');
  assert.strictEqual(lines[10], 'Prose about a web_manager: key stays prose.', 'the body is not frontmatter');
});

test('rules: theme-prefixed include paths flatten to the layered path (#248)', () => {
  const input = [
    '{% include themes/classy/global/sections/account.html size="sm" %}',
    '{% include /themes/[ site.theme.id ]/backend/sections/sidebar.html %}',
    '{%- include_cached themes/newsflash/frontend/components/testimonial-scroll.html -%}',
    'A path like themes/classy/global/sections/account.html in prose stays',
  ].join('\n');
  const { text } = applyRules(input, 'unit.html');
  const lines = text.split('\n');
  assert.strictEqual(lines[0], '{% include global/sections/account.html size="sm" %}');
  assert.strictEqual(lines[1], '{% include backend/sections/sidebar.html %}', 'the leading slash goes first, then the theme prefix');
  assert.strictEqual(lines[2], '{%- include_cached frontend/components/testimonial-scroll.html -%}');
  assert.strictEqual(lines[3], 'A path like themes/classy/global/sections/account.html in prose stays');
});

test('rules: consumer JS — `web-manager` becomes `@omega.js/client`, `webManager` becomes `omega` (#248)', () => {
  const input = [
    "import webManager from 'web-manager';",
    "import { ready as domReady } from 'web-manager/modules/dom.js';",
    'const url = `${webManager.getApiUrl()}/omega/user/token`;',
    "webManager.storage().get('attribution', {});",
  ].join('\n');
  const { text } = applyJsRules(input, 'src/assets/js/pages/token/index.js');
  const lines = text.split('\n');
  assert.strictEqual(lines[0], "import omega from '@omega.js/client';");
  assert.strictEqual(lines[1], "import { ready as domReady } from '@omega.js/client/modules/dom.js';", 'subpath imports move with the package');
  assert.strictEqual(lines[2], 'const url = `${omega.getApiUrl()}/omega/user/token`;');
  assert.strictEqual(lines[3], "omega.storage().get('attribution', {});");
});

test('rules: consumer JS — the __main_assets__ libs move to @omega.js/client (#248)', () => {
  const input = [
    "import omega from '@omega.js/client';",
    "import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';",
    "import { FormManager } from '__main_assets__/js/libs/form-manager.js';",
    "const response = await authorizedFetch(`${omega.getApiUrl()}/backend-manager/payments/intent`, { response: 'json' });",
  ].join('\n');
  const { text, findings } = applyJsRules(input, 'src/assets/js/pages/payment/checkout/modules/api.js');
  const lines = text.split('\n');
  assert.strictEqual(lines[0], "import omega from '@omega.js/client';");
  assert.strictEqual(lines[1], "import { FormManager } from '@omega.js/client/modules/form-manager.js';", 'the authorized-fetch import line is gone — there is no such module');
  assert.strictEqual(lines[2], "const response = await omega.request(`${omega.getApiUrl()}/backend-manager/payments/intent`, { response: 'json' });");
  assert.ok(
    findings.some((finding) => finding.check === 'client-libs' && finding.severity === 'warning' && finding.line === 4),
    'the rewritten call is flagged: the options are the client\'s, not wonderful-fetch\'s',
  );
});

test('rules: an authorizedFetch file with no client import is flagged, never silently broken (#248)', () => {
  const input = [
    "import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';",
    "export default () => authorizedFetch('/omega/user/token');",
  ].join('\n');
  const { findings } = applyJsRules(input, 'src/assets/js/pages/orphan/index.js');
  assert.ok(
    findings.some((finding) => finding.severity === 'error' && finding.message.includes("import omega from '@omega.js/client'")),
    '`omega` is not in scope — the rewrite says so instead of emitting a broken module',
  );
});

test('rules: the service-worker entry imports @omega.js/web; the bare package import stays (#248)', () => {
  const worker = applyJsRules("import Manager from 'ultimate-jekyll-manager/service-worker';", 'src/service-worker.js');
  assert.strictEqual(worker.text, "import Manager from '@omega.js/web/service-worker';");

  const seed = applyJsRules("import Manager from 'ultimate-jekyll-manager';", 'src/assets/js/main.js');
  assert.strictEqual(seed.text, "import Manager from 'ultimate-jekyll-manager';", 'the bare import stays for the asset-layer step to own');
});

// ---------------------------------------------------------------------------
// Rule units — Kramdown inline attribute lists (#565)
// ---------------------------------------------------------------------------

test('rules: a Kramdown attribute list on a link becomes a real anchor (#565)', () => {
  const input = [
    '[Get your API key](/account#apiKeys){: .btn .btn-primary .btn-lg }',
    '[Read the docs](/docs){:.btn}',
    'Inline [pricing](/pricing){: .link-primary } mid-sentence.',
    'A brace-colon in prose, {:like this}, is not an attribute list.',
  ].join('\n');
  const { text, edits, findings } = applyRules(input, 'src/pages/solutions/ocr.md');
  const lines = text.split('\n');
  assert.strictEqual(lines[0], '<a href="/account#apiKeys" class="btn btn-primary btn-lg">Get your API key</a>');
  assert.strictEqual(lines[1], '<a href="/docs" class="btn">Read the docs</a>', 'the space after `{:` is optional in Kramdown');
  assert.strictEqual(lines[2], 'Inline <a href="/pricing" class="link-primary">pricing</a> mid-sentence.', 'an inline link converts in place');
  assert.strictEqual(lines[3], 'A brace-colon in prose, {:like this}, is not an attribute list.', 'an IAL opens with a class, an id or an attribute');
  assert.strictEqual(edits.filter((edit) => edit.rule === 'markdown-ial').length, 3, 'one edit per converted line');
  assert.deepStrictEqual(findings.filter((finding) => finding.check === 'markdown-ial'), [], 'a converted link reports nothing');

  const again = applyRules(text, 'src/pages/solutions/ocr.md');
  assert.strictEqual(again.text, text, 'the rewrite is idempotent');
});

test('rules: an attribute list the rewrite cannot claim is loud, never left as page text (#565)', () => {
  const input = [
    '## Pricing',
    '{: .text-center }',
    '[Contact sales](/contact){: .btn #cta }',
  ].join('\n');
  const { text, findings } = applyRules(input, 'src/pages/pricing.md');
  assert.strictEqual(text, input, 'a block IAL and an attribute-carrying link IAL are hand ports');
  const found = findings.filter((finding) => finding.check === 'markdown-ial');
  assert.deepStrictEqual(found.map((finding) => finding.line), [2, 3], 'both survivors are named');
  assert.ok(found.every((finding) => finding.severity === 'error'), 'markdown-it has no attrs plugin — an IAL PRINTS on the page');

  const html = applyRules(input, 'src/pages/pricing.html');
  assert.strictEqual(html.text, input, 'an .html page was never markdown — the IAL was already literal text under Jekyll');
  assert.deepStrictEqual(html.findings.filter((finding) => finding.check === 'markdown-ial'), []);
});

// ---------------------------------------------------------------------------
// Rule units — the retired adunits/* includes (#559)
// ---------------------------------------------------------------------------

test('rules: the retired adsense adunit include becomes the verts/unit section (#559)', () => {
  const input = [
    '{% include /modules/adunits/adsense.html type="in-article" vert-size="banner" %}',
    '{% include modules/adunits/adsense.html %}',
    '{%- include modules/adunits/adsense.html type=unit_type -%}',
    '{% include modules/other/promo.html type="display" %}',
  ].join('\n');
  const { text, edits, findings } = applyRules(input, 'src/pages/tools/ocr.html');
  const lines = text.split('\n');
  assert.strictEqual(lines[0], '{% section "verts/unit", type: "in-article", size: "banner" %}', '`type` carries, `vert-size` is the OMEGA `size`');
  assert.strictEqual(lines[1], '{% section "verts/unit" %}', 'an unargued unit rides the section defaults');
  assert.strictEqual(lines[2], '{%- section "verts/unit", type: unit_type -%}', 'whitespace control and a variable value carry verbatim');
  assert.strictEqual(lines[3], '{% include modules/other/promo.html type="display" %}', 'a non-adunit include is somebody else\'s');
  assert.strictEqual(edits.filter((edit) => edit.rule === 'adunit-section').length, 3, 'one edit per converted line');
  assert.deepStrictEqual(findings.filter((finding) => finding.check === 'adunit-section'), [], 'a fully mapped unit reports nothing');

  const again = applyRules(text, 'src/pages/tools/ocr.html');
  assert.strictEqual(again.text, text, 'the rewrite is idempotent');
});

test('rules: an adunit include the section cannot carry is loud, never silently dropped (#559)', () => {
  const input = [
    '{% include modules/adunits/adsense.html type="display" slot="1234567890" style="margin:0" %}',
    '{% include /modules/adunits/promo-server.html vert-id="/verts/units/test/google" vert-size="banner" %}',
  ].join('\n');
  const { text, findings } = applyRules(input, 'src/pages/blog/post.html');
  const lines = text.split('\n');
  assert.strictEqual(lines[0], '{% section "verts/unit", type: "display" %}', 'the mappable args still convert');
  assert.strictEqual(lines[1], '{% include modules/adunits/promo-server.html vert-id="/verts/units/test/google" vert-size="banner" %}', 'an adunit with no mechanical mapping is left for the hand port');

  const found = findings.filter((finding) => finding.check === 'adunit-section');
  assert.strictEqual(found.length, 2, `one finding per line: ${JSON.stringify(findings)}`);
  assert.strictEqual(found[0].severity, 'warning', 'the unit renders — the knobs that did not carry are the report');
  assert.ok(/slot/.test(found[0].message) && /style/.test(found[0].message), 'and it names them both');
  assert.strictEqual(found[1].severity, 'error', 'an unconverted adunit include renders NOTHING');
  assert.ok(/verts\/unit/.test(found[1].message), 'and the finding names the successor section');
});

// ---------------------------------------------------------------------------
// Rule units — the UJM library accessor (#560)
// ---------------------------------------------------------------------------

test('rules: consumer JS — the `uj()` library accessor becomes `library()` (#560)', () => {
  const input = [
    "import webManager from 'web-manager';",
    'webManager.uj().showExitPopup({ delay: 1000 });',
    'omega.uj().titleCase("hello");',
    'const lib = window.omega.uj();',
  ].join('\n');
  const { text, findings } = applyJsRules(input, 'src/assets/js/pages/tools/ocr/index.js');
  const lines = text.split('\n');
  assert.strictEqual(lines[1], 'omega.library().showExitPopup({ delay: 1000 });', 'the accessor the client actually ships');
  assert.strictEqual(lines[2], 'omega.library().titleCase("hello");', 'a file rule 13 already renamed converts too');
  assert.strictEqual(lines[3], 'const lib = window.omega.library();', 'a window-qualified singleton keeps its qualifier');
  assert.deepStrictEqual(findings, [], 'every accessor was rewritten — nothing to report');
});

test('rules: a `.uj(` the rule cannot claim is reported, never left dead (#560)', () => {
  const input = [
    "import omega from '@omega.js/client';",
    'Manager.uj().showExitPopup();',
    'omega.uj(options).showExitPopup();',
  ].join('\n');
  const { text, findings } = applyJsRules(input, 'src/assets/js/pages/orphan/index.js');
  assert.ok(text.includes('Manager.uj()'), 'an unknown receiver is not mechanically the client singleton — untouched');
  assert.ok(text.includes('omega.uj(options)'), 'and neither is an accessor called with args — `uj()` never took any');
  const found = findings.filter((finding) => finding.check === 'uj-library');
  assert.strictEqual(found.length, 2, `one finding per surviving call: ${JSON.stringify(findings)}`);
  assert.deepStrictEqual(found.map((finding) => finding.line), [2, 3]);
  assert.ok(found.every((finding) => finding.severity === 'error'), '`uj()` is a runtime TypeError on @omega.js/client');
  assert.ok(found.every((finding) => /omega\.library\(\)/.test(finding.message)), 'and the message names the successor');
});

// ---------------------------------------------------------------------------
// Rule units — bare config sections move under `config:` (#607)
// ---------------------------------------------------------------------------

test('rules: a UJM page\'s bare config sections move under `config:`, and the run is idempotent (#607)', () => {
  const input = [
    '---',
    'layout: frontend/core/base',
    'permalink: /pricing',
    '',
    'meta:',
    '  title: "Pricing"',
    '',
    '# the shell chrome this page wanted',
    'theme:',
    '  nav:',
    '    enabled: false',
    '',
    'inbound:',
    '  chat:',
    '    providers:',
    '      chatsy:',
    '        enabled: false',
    '---',
    'A theme: word in the body stays prose.',
    '',
  ].join('\n');

  const first = applyRules(input, 'pricing.md');
  const lines = first.text.split('\n');

  assert.strictEqual(lines.indexOf('config:') !== -1, true, 'a `config:` parent is written');
  assert.ok(lines.includes('  theme:'), 'theme moves one level in');
  assert.ok(lines.includes('    nav:'), 'and its children ride along');
  assert.ok(lines.includes('  inbound:'), 'every bare section moves, not just the first');
  assert.ok(lines.includes('          enabled: false'), 'deep children keep their relative shape');
  assert.strictEqual(lines[lines.indexOf('  theme:') - 1], '  # the shell chrome this page wanted', 'the note above a moved key rides with it');
  assert.ok(lines.includes('meta:'), '`meta` is the pageBare exception and stays put');
  assert.ok(lines.includes('  title: "Pricing"'), 'and keeps its own children where they were');
  assert.strictEqual(lines[lines.length - 2], 'A theme: word in the body stays prose.', 'the body is not frontmatter');

  const findings = first.findings.filter((finding) => finding.check === 'config-parent');
  assert.strictEqual(findings.length, 1, 'one finding per file, not per section');
  assert.ok(/`theme`, `inbound`/.test(findings[0].message), 'the finding names every section it moved');

  // Idempotent: a second run over the migrated page changes nothing.
  const second = applyRules(first.text, 'pricing.md');
  assert.strictEqual(second.text, first.text, 'a migrated page is a fixed point');
  assert.deepStrictEqual(second.findings.filter((finding) => finding.check === 'config-parent'), []);
});

test('rules: a page that already has a `config:` block gains the moved sections inside it (#607)', () => {
  const input = [
    '---',
    'layout: frontend/core/base',
    'config:',
    '  analytics:',
    '    providers:',
    '      google:',
    '        id: "G-EXISTING"',
    'theme:',
    '  footer:',
    '    enabled: false',
    '---',
    '',
  ].join('\n');

  const { text } = applyRules(input, 'unit.html');
  const lines = text.split('\n');

  assert.strictEqual(lines.filter((line) => line === 'config:').length, 1, 'one config parent, never two');
  assert.ok(lines.includes('  analytics:') && lines.includes('  theme:'), 'both sections sit under it');
  assert.ok(lines.includes('        id: "G-EXISTING"'), 'the existing block is untouched');
});

// ---------------------------------------------------------------------------
// Rule units — config READS move to resolved.config (#611)
// ---------------------------------------------------------------------------

test('rules: `site.<section>` reads become `resolved.config.<section>`, body and frontmatter alike, idempotently (#611)', () => {
  const input = [
    '---',
    'layout: frontend/core/base',
    'meta:',
    '  title: "{{ site.brand.name }} · Pricing"',
    '  description: "{{ site.meta.description }}"',
    '---',
    '<h1>{{ site.brand.name | upcase }}</h1>',
    '<p>{{ site.theme.id }} — {{ resolved.inbound.chat.providers.chatsy.enabled }}</p>',
    '{% if site.payment.products %}<span>{{ site.company.name }}</span>{% endif %}',
    '<a href="/site.webmanifest">{{ site.omega.date.year }} · {{ site.posts.size }} · {{ resolved.pricing.plans.size }}</a>',
    '<meta content="{{ resolved.meta.title }}">',
    'Visit subdomain.site.com for more.',
    '',
  ].join('\n');

  const first = applyRules(input, 'pricing.md');
  const lines = first.text.split('\n');

  // Frontmatter values are reads like any other — that is where the
  // playground's own pages hid theirs.
  assert.ok(lines.includes('  title: "{{ resolved.config.brand.name }} · Pricing"'), 'a frontmatter read moves');
  assert.ok(lines.includes('  description: "{{ resolved.meta.description }}"'), '`site.meta` is the meta walk, not a config section');
  assert.ok(lines.includes('<h1>{{ resolved.config.brand.name | upcase }}</h1>'), 'a body read moves, filters intact');
  assert.match(first.text, /\{\{ resolved\.config\.theme\.id \}\}/, 'every config section moves, not just brand');
  assert.match(first.text, /\{\{ resolved\.config\.inbound\.chat/, 'the OLD FLAT `resolved.<section>` path moves too — rule 1 manufactures it');
  assert.match(first.text, /\{% if resolved\.config\.payment\.products %\}/, 'a read inside a tag moves');
  assert.match(first.text, /\{\{ resolved\.config\.company\.name \}\}/, 'and one inside a tag body');

  // Build facts and the non-reads stay exactly as they were.
  assert.match(first.text, /\{\{ site\.omega\.date\.year \}\}/, '`site.omega` is a build fact');
  assert.match(first.text, /\{\{ site\.posts\.size \}\}/, '…and so are the indexed collections');
  assert.match(first.text, /\{\{ resolved\.pricing\.plans\.size \}\}/, 'a composed VIEW keeps its flat spelling');
  assert.match(first.text, /\{\{ resolved\.meta\.title \}\}/, '`meta` is the pageBare section — it stays flat');
  assert.match(first.text, /href="\/site\.webmanifest"/, 'a filename is not a property read');
  assert.match(first.text, /subdomain\.site\.com/, 'nor is a hostname');

  const findings = first.findings.filter((finding) => finding.check === 'config-reads');
  assert.strictEqual(findings.length, 1, 'one finding per file, not per read');
  assert.match(findings[0].message, /resolved\.config/, 'the finding names the lane the reads moved to');

  // Idempotent: a second run over the migrated page changes nothing.
  const second = applyRules(first.text, 'pricing.md');
  assert.strictEqual(second.text, first.text, 'a migrated page is a fixed point');
  assert.deepStrictEqual(second.findings.filter((finding) => finding.check === 'config-reads'), []);
});

test('rules: the analytics spelling normalizes BEFORE the read moves (#611)', () => {
  // Rule 9 answers to `site.analytics.<provider>`; running the read move first
  // would rename the root out from under it and leave the flat spelling.
  const { text } = applyRules('{{ site.analytics.google }}', 'unit.html');
  assert.strictEqual(text, '{{ resolved.config.analytics.providers.google.id }}');
});

test('rules: code DISPLAY is not markup — fences and {% raw %} keep the old spelling (#611 F3)', () => {
  // The #521 doctrine, on the migrate side: a page that DOCUMENTS the legacy
  // form is showing text, not calling it. Rewriting inside the fence would make
  // the documentation say something the reader's own file does not.
  const input = [
    'Before the migration a page wrote it like this:',
    '',
    '```liquid',
    '{{ site.brand.name }}',
    '```',
    '',
    '~~~',
    '{{ site.theme.id }}',
    '~~~',
    '',
    '{% raw %}{{ site.inbound.chat.providers.chatsy.enabled }}{% endraw %}',
    '',
    'And this one is a real read: {{ site.brand.name }}',
    '',
  ].join('\n');

  const { text, edits } = applyRules(input, 'src/pages/docs.md');
  const lines = text.split('\n');

  assert.strictEqual(lines[3], '{{ site.brand.name }}', 'a fenced sample is display copy');
  assert.strictEqual(lines[7], '{{ site.theme.id }}', 'the tilde fence counts too');
  assert.strictEqual(lines[10], '{% raw %}{{ site.inbound.chat.providers.chatsy.enabled }}{% endraw %}', 'so does the raw escape hatch');
  assert.strictEqual(lines[12], 'And this one is a real read: {{ resolved.config.brand.name }}', 'markup outside them still migrates');
  assert.strictEqual(edits.filter((edit) => edit.rule === 'config-reads').length, 1, 'one edit — the one real read');
});

test('rules: a read is a LIQUID read — a hostname is left alone (#611 F4)', () => {
  const input = [
    'Read more at https://site.company.com/x and at site.marketing.example.com.',
    '<img src="/site.webmanifest" alt="{{ site.brand.name }}">',
    'Visit https://site.company.com — {{ site.company.name }} runs it.',
    '',
  ].join('\n');

  const { text } = applyRules(input, 'src/pages/index.md');
  const lines = text.split('\n');

  assert.strictEqual(lines[0], 'Read more at https://site.company.com/x and at site.marketing.example.com.', 'a hostname is not a read');
  assert.strictEqual(lines[1], '<img src="/site.webmanifest" alt="{{ resolved.config.brand.name }}">', 'a filename is not a read, and the read beside it still moves');
  assert.strictEqual(lines[2], 'Visit https://site.company.com — {{ resolved.config.company.name }} runs it.', 'both on ONE line: the hostname stays, the read moves');
});

test('rules: a section descriptor\'s reads move too — the bindings are DATA (#611)', () => {
  const { text, edits } = applyJsonRules('{ logo: { text: \'{{ site.brand.name }}\' } }', 'src/_includes/frontend/sections/nav.json');
  assert.strictEqual(text, '{ logo: { text: \'{{ resolved.config.brand.name }}\' } }', 'a descriptor emits the same empty string a template would');
  assert.strictEqual(edits.length, 1);
});

// ---------------------------------------------------------------------------
// Rule units — the legacy classy gradient utilities (#296)
// ---------------------------------------------------------------------------

test('rules: the legacy gradient utilities become the v2 dotgrid hero (#296)', () => {
  const input = [
    '<section class="bg-gradient-rainbow gradient-animated gradient-grain text-light min-vh-80">',
    '<div class="gradient-grain p-4">',
    '<section class="gradient-animated" data-omega-dotfield>',
    '<div class="gradient-animated-slow gradient-grainy x-gradient-grain">',
    '<section class="{% if a %}gradient-grain{% else %}gradient-animated{% endif %}">',
  ].join('\n');
  const { text, edits } = applyRules(input, 'unit.html');
  const lines = text.split('\n');
  assert.strictEqual(
    lines[0],
    '<section class="bg-gradient-rainbow omega-dotgrid text-light min-vh-80" data-omega-dotfield>',
    'both utilities on one element collapse to ONE dotgrid, and the animated half opts into the live dotfield',
  );
  assert.strictEqual(lines[1], '<div class="omega-dotgrid p-4">', 'the static half is the dot grid alone — no motion it never had');
  assert.strictEqual(lines[2], '<section class="omega-dotgrid" data-omega-dotfield>', 'an element already opted in keeps ONE attribute');
  assert.strictEqual(lines[3], '<div class="gradient-animated-slow gradient-grainy x-gradient-grain">', 'longer and prefixed names are DIFFERENT classes');
  assert.strictEqual(
    lines[4],
    '<section class="{% if a %}omega-dotgrid{% else %}omega-dotgrid{% endif %}" data-omega-dotfield>',
    'a Liquid-built class list keeps every branch — a "duplicate" there is the ONLY class one branch emits',
  );
  assert.strictEqual(edits.length, 4, 'one edit recorded per changed line');
});

test('rules: a real UJM hero converts to a treatment classy v2 actually ships (#296)', () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'ports-site', 'pages', 'index.html'), 'utf8');
  assert.match(fixture, /gradient-animated/, 'the fixture hero carries the legacy pair');
  assert.match(fixture, /gradient-grain/, 'both of them');

  const { text } = applyRules(fixture, 'src/pages/index.html');
  assert.ok(!/gradient-animated|gradient-grain/.test(text), 'no legacy gradient utility survives the page');
  const hero = text.split('\n').find((line) => line.includes('omega-dotgrid'));
  assert.match(hero, /class="bg-gradient-rainbow omega-dotgrid /, 'the hero wears the dotgrid; bg-gradient-rainbow stays (v2 still neutralizes that name)');
  assert.match(hero, /" data-omega-dotfield>/, 'and the live dotfield the animation became');
  assert.strictEqual((text.match(/omega-dotgrid/g) || []).length, 1, 'the pair collapsed, it did not double');

  // The other half of "renders with the v2 treatment": classy v2 paints the
  // class the codemod writes, and paints neither class it rewrote.
  const css = sass.compile(path.join(PKG, 'themes', 'classy', 'css', 'base', '_utilities.scss'), {
    logger: { warn: () => {}, debug: () => {} },
  }).css;
  assert.match(css, /\.omega-dotgrid::before/, 'classy v2 ships the masked dot backdrop the hero now wears');
  assert.ok(!/gradient-animated|gradient-grain/.test(css), 'and ships neither legacy utility — the reason they convert (#296)');
});

// ---------------------------------------------------------------------------
// Rule units — the UJM → OMEGA section-arg renames (#545)
// ---------------------------------------------------------------------------

test('rules: the renamed section args migrate to their OMEGA spellings (#545)', () => {
  const input = [
    '---',
    'layout: frontend/core/base',
    'hero:',
    '  tagline: "Introducing {{ site.brand.name }}"',
    '  headline: "The #1 platform"',
    '  demo:',
    '    options:',
    '      button:',
    '        text: "Start free trial"',
    'pricing:',
    '  plans:',
    '    - tagline: "best for individuals"',
    'cta:',
    '  description: "Join thousands of teams"',
    '  button:',
    '    text: "Start today"',
    '---',
    'Prose mentioning tagline: and description: is not a section arg.',
  ].join('\n');
  const { text, edits } = applyRules(input, 'src/pages/index.md');
  const lines = text.split('\n');
  assert.deepStrictEqual(lines.slice(2, 5), [
    'hero:',
    '  badge:',
    '    text: "Introducing {{ resolved.config.brand.name }}"',
  ], 'the eyebrow becomes the badge object OMEGA renders, its read moved with it (#611)');
  assert.strictEqual(lines[5], '  headline: "The #1 platform"', 'the rest of the block is untouched');
  assert.ok(lines.includes('      button:'), 'the demo\'s own button is a DIFFERENT arg, three levels down');
  assert.ok(lines.includes('    - tagline: "best for individuals"'), 'a pricing plan\'s tagline is not the hero\'s');
  assert.deepStrictEqual(lines.slice(-6, -2), [
    'cta:',
    '  subheadline: "Join thousands of teams"',
    '  primary_button:',
    '    text: "Start today"',
  ], 'the CTA copy and button keep their content under the new names');
  assert.strictEqual(lines[lines.length - 1], 'Prose mentioning tagline: and description: is not a section arg.', 'the body is prose');
  assert.strictEqual(edits.filter((edit) => edit.rule === 'section-args').length, 3, 'one edit per renamed key');
});

test('rules: a hero already carrying the legacy badge object is reported, never given two (#545)', () => {
  const input = [
    '---',
    'hero:',
    '  tagline: "Introducing {{ site.brand.name }}"',
    '  badge:',
    '    title: "Industry leader"',
    '---',
  ].join('\n');
  const { text, findings } = applyRules(input, 'src/pages/index.md');
  // A second `badge:` key would drop one of the two, so section-args rewrites
  // NOTHING here — the tagline keeps its key and the badge keeps its shape.
  // (config-reads moves the read inside the value; that is a different rule.)
  assert.strictEqual(
    text,
    input.replace('{{ site.brand.name }}', '{{ resolved.config.brand.name }}'),
    'the tagline stays a tagline and the badge stays a badge',
  );
  const found = findings.filter((finding) => finding.check === 'section-args');
  assert.strictEqual(found.length, 1, `one finding: ${JSON.stringify(findings)}`);
  assert.strictEqual(found[0].line, 3, 'pointing at the tagline');
  assert.strictEqual(found[0].severity, 'error', 'the merge is a hand-port');
  assert.ok(/badge\.text/.test(found[0].message), 'and it names the target spelling');
});

// ---------------------------------------------------------------------------
// Rule units — the hero's silently-dropped secondary button (#579)
// ---------------------------------------------------------------------------

test('rules: a migrated hero secondary button is switched ON, and the report says so (#579)', () => {
  const input = [
    '---',
    'layout: frontend/pages/index',
    'hero:',
    '  headline: "Scale your web scraping with reliable"',
    '  primary_button:',
    '    text: "Start scraping free"',
    '    href: "/pricing"',
    '  secondary_button:',
    '    text: "View proxy list"',
    '    icon: "list"',
    '    href: "/tools/proxy-list"',
    'cta:',
    '  secondary_button:',
    '    text: "View documentation"',
    '---',
  ].join('\n');
  const { text, edits, findings } = applyRules(input, 'src/pages/solutions/web-scraping.md');
  const lines = text.split('\n');
  assert.deepStrictEqual(lines.slice(7, 12), [
    '  secondary_button:',
    '    enabled: true',
    '    text: "View proxy list"',
    '    icon: "list"',
    '    href: "/tools/proxy-list"',
  ], 'the hero section defaults the button OFF — an authored one says so out loud');
  assert.deepStrictEqual(lines.slice(12, 15), [
    'cta:',
    '  secondary_button:',
    '    text: "View documentation"',
  ], 'the CTA band renders any button it is given — not this rule\'s business');
  assert.strictEqual(edits.filter((edit) => edit.rule === 'hero-secondary-button').length, 1, 'one edit');

  const found = findings.filter((finding) => finding.check === 'hero-secondary-button');
  assert.strictEqual(found.length, 1, `the report warns when it flips the switch: ${JSON.stringify(findings)}`);
  assert.strictEqual(found[0].severity, 'warning');
  assert.ok(/enabled: true/.test(found[0].message), 'and names what it wrote');

  const again = applyRules(text, 'src/pages/solutions/web-scraping.md');
  assert.strictEqual(again.text, text, 'the rewrite is idempotent');
  assert.deepStrictEqual(again.findings.filter((finding) => finding.check === 'hero-secondary-button'), [], 'and reports nothing the second time');
});

test('rules: a hero that already answered the enabled question keeps its answer (#579)', () => {
  const input = [
    '---',
    'hero:',
    '  secondary_button:',
    '    enabled: false',
    '    text: "See pricing"',
    '---',
  ].join('\n');
  const { text, findings } = applyRules(input, 'src/pages/index.md');
  assert.strictEqual(text, input, 'an authored `enabled: false` is the author\'s intent, not a default');
  assert.deepStrictEqual(findings.filter((finding) => finding.check === 'hero-secondary-button'), []);
});

test('rules: a sibling block\'s `enabled` is not the button\'s answer (#579)', () => {
  const input = [
    '---',
    'hero:',
    '  secondary_button:',
    '    text: "See pricing"',
    '  frame:',
    '    enabled: false',
    '---',
  ].join('\n');
  const { text } = applyRules(input, 'src/pages/index.md');
  assert.deepStrictEqual(text.split('\n').slice(2, 4), [
    '  secondary_button:',
    '    enabled: true',
  ], 'the block ends at its first sibling — `frame.enabled` answers for the frame');
});

// ---------------------------------------------------------------------------
// Semantic proofs — rewrites render correctly through the REAL adapter
// ---------------------------------------------------------------------------

function realEngine() {
  const engine = new Liquid({ jekyllInclude: true });
  registerLiquid(engine, {
    icons: {
      fontAwesomeDirs: [path.join(PKG, 'core', 'icons')],
      flagsDir: path.join(PKG, 'core', 'icons', 'flags'),
      style: 'solid',
    },
  });
  return engine;
}

test('semantic: hoisted tag arg renders identically to a literal quoted arg', async () => {
  const engine = realEngine();
  const { text } = applyRules('{% omega_icon "{{ stat.icon }} text-primary" %}', 'semantic.html');
  const rewritten = await engine.parseAndRender(text, { stat: { icon: 'star' } });
  const literal = await engine.parseAndRender('{% omega_icon "star text-primary" %}', {});
  assert.strictEqual(rewritten.trim(), literal.trim(), 'capture hoist ≡ literal arg (the upstream silent no-op is fixed forward)');
  assert.ok(rewritten.includes('data-icon="star text-primary"'), 'interpolation actually happened');
});

test('semantic: parentloop hoist renders the outer-loop values', async () => {
  const engine = realEngine();
  const input = [
    '{% for group in groups %}',
    '{% for item in group.items %}',
    '[{{ forloop.parentloop.index }}.{{ forloop.index }}:{{ item }}]',
    '{% endfor %}',
    '{% endfor %}',
  ].join('\n');
  const { text } = applyRules(input, 'semantic.html');
  assert.ok(!text.includes('forloop.parentloop'), 'no parentloop refs remain');
  const output = await engine.parseAndRender(text, {
    groups: [{ items: ['a', 'b'] }, { items: ['c'] }],
  });
  const compact = output.replace(/\s+/g, '');
  assert.strictEqual(compact, '[1.1:a][1.2:b][2.1:c]', 'outer indexes correct per iteration');
});

test('rules: parentloop sharing a line with loop opens is flagged, never mis-hoisted', () => {
  const input = [
    '{% for a in x %}{% for b in y %}',
    '{{ forloop.parentloop.index }}',
    '{% endfor %}{% endfor %}',
  ].join('\n');
  const { text, findings } = applyRules(input, 'unit.html');
  assert.ok(text.includes('forloop.parentloop.index'), 'ambiguous ref left untouched');
  assert.ok(findings.some((finding) => finding.check === 'parentloop' && finding.severity === 'error'), 'flagged for manual hoist');
});

test('rules: the dead `asset_path` frontmatter key is named, with the successor idiom', () => {
  const input = [
    '---',
    'layout: page',
    'asset_path: dashboard/agents/edit',
    '---',
    'A page mentioning asset_path: in prose is not a frontmatter key.',
  ].join('\n');
  const { text, findings } = applyRules(input, 'src/pages/dashboard/agents/new.md');
  assert.strictEqual(text, input, 'the key is reported, never rewritten — the port is by hand');
  const found = findings.filter((finding) => finding.check === 'asset-path');
  assert.strictEqual(found.length, 1, `one finding, on the frontmatter key only: ${JSON.stringify(findings)}`);
  assert.strictEqual(found[0].line, 3, 'the finding points at the key line');
  assert.strictEqual(found[0].severity, 'error', 'a dead key needs a manual port');
  assert.ok(/asset_path/.test(found[0].message), 'the message names the key');
  assert.ok(/\[slug\]\.js/.test(found[0].message), 'the message names the [name] wildcard family file');
  assert.ok(/index\.js/.test(found[0].message) && /@use/.test(found[0].message), 'the message points at the re-export + @use idiom');
  assert.ok(
    found[0].message.indexOf('[slug]') < found[0].message.indexOf('export { default }'),
    'the wildcard family comes FIRST, the one-off re-export second (#470)',
  );
});

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

test('lint: Jekyll-only tags error, unknown filters warn, known names pass', () => {
  const findings = lintText([
    '{% post_url 2020-01-01-hello %}',
    '{% assign related = site.posts | where_exp: "p", "p.url" | limit: 3 %}',
    '{% omega_icon "star" %} {{ title | omega_title_case | markdownify }}',
    '{% iftruthy site.brand %}x{% endiftruthy %}',
  ].join('\n'), 'lint.html');
  assert.ok(findings.some((finding) => finding.check === 'jekyll-only-tag' && finding.line === 1), 'post_url flagged');
  assert.ok(findings.some((finding) => finding.check === 'unknown-filter' && finding.message.includes('limit')), 'limit flagged (Jekyll never had it either)');
  assert.strictEqual(findings.filter((finding) => finding.line >= 3).length, 0, 'template-kit tags/filters + block ends all known');
});

test('lint: #489 the framework\'s own tags are known — a converted tree lints clean', () => {
  // `omega migrate --check` on a fully-converted website reported 71 warnings
  // for `{% section %}`: the lint registry was built from template-kit alone,
  // so the target shape the lane converts INTO could never lint clean.
  const findings = lintText([
    '{% section "marketing/hero" headline="Hi" %}',
    '{% section "marketing/faq" %}',
    'items:',
    '{% endsection %}',
    '{% component "cards/stat" %}',
    '{% composition %}{% endcomposition %}',
  ].join('\n'), 'converted.html');

  assert.deepStrictEqual(findings, [], 'the lane\'s own output is not a finding');
});

test('lint: raw and comment spans are inert', () => {
  const findings = lintText('{% raw %}{% post_url x %}{% endraw %}{% comment %}{{ x | limit }}{% endcomment %}', 'lint.html');
  assert.strictEqual(findings.length, 0);
});

// ---------------------------------------------------------------------------
// Config conversion
// ---------------------------------------------------------------------------

const LEGACY_JEKYLL = {
  url: 'https://sample.test',
  baseurl: '',
  theme: { id: 'classy', appearance: 'dark', nav: { enabled: true } },
  meta: { title: 'Sample - {{ site.brand.name }}', description: 'A sample' },
  brand: { id: 'sample', name: 'Sample', contact: { email: 'hi@sample.test' } },
  web_manager: {
    auth: { enabled: true, config: { redirects: { authenticated: '/account' } } },
    firebase: { app: { enabled: true, config: { apiKey: 'AIza-TEST', projectId: 'sample-test' } } },
    payment: {
      processors: { stripe: { publishableKey: false }, chargebee: { site: 'sample' } },
      products: [{ id: 'basic', name: 'Basic', type: 'subscription' }],
    },
    sentry: {
      enabled: true,
      config: { dsn: 'https://x@sentry.io/1', replaysSessionSampleRate: 0.01, replaysOnErrorSampleRate: 0.01 },
    },
    cookieConsent: {
      enabled: true,
      config: {
        type: 'opt-in',
        theme: 'classic',
        position: 'bottom-right',
        palette: { popup: { background: '#fff', text: '#000' } },
        content: { message: 'We use cookies. { terms }', dismiss: 'I Understand' },
      },
    },
  },
  oauth2: { discord: { enabled: true } },
  analytics: { google: 'G-TEST123', meta: '', tiktok: 'TIKTOK1' },
  socials: { twitter: 'sample' },
  translation: { languages: ['es'], exclude: ['account'] },
  collections: { recipes: { title: 'Recipes', output: true } },
  defaults: [{ scope: { type: 'recipes' }, values: { layout: 'recipe' } }],
  plugins: ['jekyll-feed'],
  permalink: '/blog/:title',
};

const LEGACY_UJM = {
  distribute: { input: [] },
  webpack: { target: 'somiibo' },
  sass: { purgecss: { safelist: { standard: ['keep-me'] } } },
  imagemin: { enabled: true },
  github: { workflows: { build: { schedule: '30 1 1 * *' } } },
  gems: ['jekyll-redirect-from'],
};

test('config: shared sections extracted with unified spellings', () => {
  const { omega, notes } = convertConfig({ jekyll: structuredClone(LEGACY_JEKYLL), ujm: structuredClone(LEGACY_UJM) });

  assert.strictEqual(omega.brand.url, 'https://sample.test', 'url folded into brand');
  assert.strictEqual(omega.baseurl, undefined, 'empty baseurl dropped');
  assert.deepStrictEqual(omega.analytics, { providers: { google: { id: 'G-TEST123' }, tiktok: { id: 'TIKTOK1' } } }, 'flat analytics → providers; empty provider dropped');
  assert.strictEqual(omega.cloud.provider, 'firebase', 'cloud role gets its provider discriminator');
  assert.strictEqual(omega.cloud.config.apiKey, 'AIza-TEST', 'firebase app config extracted');
  assert.strictEqual(omega.payment.providers.chargebee.site, 'sample');
  assert.strictEqual(omega.payment.providers.stripe.publishableKey, undefined, 'publishableKey: false dropped');
  assert.strictEqual(omega.oauth2.discord.enabled, true);

  const web = omega.targets.web;
  assert.strictEqual(web.web_manager, undefined, 'the legacy key name does not survive the conversion (#1)');
  assert.strictEqual(web.client.payment, undefined, 'payment moved out of the client blob');
  assert.strictEqual(web.client.firebase.app.config, undefined, 'firebase config moved out');
  assert.strictEqual(web.client.firebase.app.enabled, true, 'client firebase toggles stay');
  assert.strictEqual(web.client.sentry, undefined, 'sentry moved out of the client blob to its schema home (#485)');

  // cookieConsent → consent (#383). Carrying the old NAME would emit a config
  // that fails the retired-key guard, and carrying its settings would emit keys
  // the rebuilt banner does not read: the panel paints from the --omega-*
  // tokens, the visitor's region picks opt-in vs opt-out, and "I Understand" is
  // not an Accept.
  assert.strictEqual(web.client.cookieConsent, undefined, 'the retired block name does not survive');
  assert.deepStrictEqual(web.client.consent, { enabled: true, config: { position: 'bottom-right' } }, 'enabled + position are what carries');
  assert.ok(notes.some((note) => note.includes('cookieConsent') && note.includes('client.consent')), 'the drop is announced, not silent');
  assert.strictEqual(web.collections.recipes.title, 'Recipes', 'custom collections carried (rule 8)');
  assert.strictEqual(web.permalink, '/blog/:title');
  assert.deepStrictEqual(web.purgecss.safelist.standard, ['keep-me'], 'UJM json build settings carried');
  assert.strictEqual(web.workflows.build.schedule, '30 1 1 * *');
  assert.strictEqual(omega.webpack, undefined, 'webpack dropped');

  assert.ok(notes.some((note) => note.includes('gems')), 'non-empty gems noted');
  assert.ok(notes.some((note) => note.includes('webpack.target')), 'webpack target noted');
  assert.ok(notes.some((note) => note.includes('plugins')), 'Jekyll machinery drop noted');
  assert.ok(notes.some((note) => note.includes('collections')), 'collections carry noted');
});

test('config: socials lands at the ROOT, its schema home (#483)', () => {
  const { omega } = convertConfig({ jekyll: structuredClone(LEGACY_JEKYLL), ujm: null });

  assert.deepStrictEqual(omega.socials, { twitter: 'sample' }, 'socials is a SHARED_SCHEMA root key — the scaffold emits it there');
  assert.strictEqual(omega.targets.web.socials, undefined, 'and it never rides the web target as well');
});

test('config: translation lands at the ROOT, its schema home (#526)', () => {
  const { omega } = convertConfig({ jekyll: structuredClone(LEGACY_JEKYLL), ujm: null });

  assert.deepStrictEqual(omega.translation, { languages: ['es'], exclude: ['account'] }, 'translation is a SHARED_SECTIONS key — disperse copies it from the root to every target');
  assert.strictEqual(omega.targets.web.translation, undefined, 'and it never rides the web target as well');
});

test('config: web_manager.sentry becomes monitoring.providers.sentry (#485)', () => {
  const { omega, notes } = convertConfig({ jekyll: structuredClone(LEGACY_JEKYLL), ujm: null });

  assert.deepStrictEqual(omega.monitoring, {
    enabled: true,
    providers: {
      sentry: { dsn: 'https://x@sentry.io/1', replaysSessionSampleRate: 0.01, replaysOnErrorSampleRate: 0.01 },
    },
  }, 'the SDK knobs land under the provider — the home the manager\'s monitoring service reads');
  assert.strictEqual(omega.targets.web.client.sentry, undefined, 'and the client blob keeps no stale copy to win over it');
  assert.ok(notes.some((note) => note.includes('monitoring.providers.sentry')), 'the move is announced, not silent');
});

test('config: a legacy-disabled sentry block that still carries a DSN is called out (#485)', () => {
  const jekyll = structuredClone(LEGACY_JEKYLL);
  jekyll.web_manager.sentry.enabled = false;

  const { omega, notes } = convertConfig({ jekyll, ujm: null });

  assert.strictEqual(omega.monitoring.enabled, false, 'the legacy flag carries to the role-level switch');
  assert.strictEqual(omega.monitoring.providers.sentry.dsn, 'https://x@sentry.io/1', 'and the DSN is never silently dropped');
  assert.ok(notes.some((note) => note.includes('RUNTIME switch')), 'the operator is told the two flags do not mean the same thing');
});

test('config: converted output passes the real loader for target web', () => {
  const { omega } = convertConfig({ jekyll: structuredClone(LEGACY_JEKYLL), ujm: structuredClone(LEGACY_UJM) });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-config-'));
  try {
    fs.mkdirSync(path.join(tmp, 'config'));
    fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), serializeOmega(omega));
    const { config, errors, enabled } = loadConfig(tmp, 'web');
    assert.deepStrictEqual(errors, [], 'no schema findings');
    assert.strictEqual(enabled, true, 'web target enabled by key presence');
    assert.strictEqual(config.client.auth.enabled, true, 'targets.web overlays the top level');
    assert.strictEqual(config.meta.title, 'Sample - {{ site.brand.name }}', 'Liquid-bearing values survive');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// End-to-end migration of a synthetic UJM consumer
// ---------------------------------------------------------------------------

const yaml = require('js-yaml');

function stageLegacyConsumer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-e2e-'));
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', '_layouts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', '_config.yml'), yaml.dump(LEGACY_JEKYLL));
  fs.writeFileSync(path.join(root, 'config', 'ultimate-jekyll-manager.json'), JSON.stringify(LEGACY_UJM, null, 2));
  fs.writeFileSync(path.join(root, 'Gemfile'), "source 'https://rubygems.org'\ngem 'jekyll'\n");
  fs.writeFileSync(path.join(root, 'Gemfile.lock'), 'GEM\n');
  fs.writeFileSync(path.join(root, 'src', 'pages', 'index.html'), [
    '---',
    'layout: themes/[ site.theme.id ]/frontend/core/base',
    '---',
    '<h1>{{ page.resolved.meta.title }}</h1>',
    '{% include /modules/thing.html %}',
  ].join('\n'));
  fs.mkdirSync(path.join(root, 'src', 'assets', 'js', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'assets', 'js', 'main.js'), [
    '// Import Ultimate Jekyll Manager',
    "import Manager from 'ultimate-jekyll-manager';",
    '',
    '// Create instance',
    'const manager = new Manager();',
    '',
    '// Initialize',
    'manager.initialize()',
    '.then(() => {',
    '  // Log',
    "  console.log('Ultimate Jekyll Manager initialized successfully');",
    '',
    '  // Custom code',
    '  // ...',
    '});',
  ].join('\n'));
  fs.mkdirSync(path.join(root, 'src', 'assets', 'css'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'assets', 'css', 'main.scss'), [
    "@use 'ultimate-jekyll-manager' as * with (",
    '  $primary: #5B47FB,',
    ');',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'src', 'assets', 'js', 'pages', 'custom.js'), [
    "import Manager from 'ultimate-jekyll-manager';",
    'export default () => new Manager();',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'src', '_layouts', 'custom.html'), [
    '{% for group in groups %}',
    '{% for item in group.items %}',
    '{{ forloop.parentloop.index }}',
    '{% endfor %}',
    '{% endfor %}',
    '{% post_url 2020-01-01-x %}',
  ].join('\n'));
  return root;
}

test('e2e: check mode reports everything and writes NOTHING', () => {
  const root = stageLegacyConsumer();
  try {
    const report = runMigration(root, { check: true });
    assert.strictEqual(report.check, true);
    assert.ok(report.codemod.totalEdits >= 4, 'edits previewed');
    assert.strictEqual(report.removed.length, 5, 'legacy files + seed main.js listed');
    assert.ok(fs.existsSync(path.join(root, 'src', 'assets', 'js', 'main.js')), 'seed main.js untouched in check mode');
    assert.ok(report.lint.some((finding) => finding.check === 'jekyll-only-tag'), 'post_url flagged');
    assert.ok(!fs.existsSync(path.join(root, 'config', 'omega.json5')), 'no config written');
    assert.ok(fs.existsSync(path.join(root, 'Gemfile')), 'Gemfile untouched');
    assert.ok(fs.readFileSync(path.join(root, 'src', 'pages', 'index.html'), 'utf8').includes('page.resolved'), 'templates untouched');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('e2e: real migration converts config, rewrites templates, removes legacy files', () => {
  const root = stageLegacyConsumer();
  try {
    const report = runMigration(root, {});
    assert.deepStrictEqual(report.errors, []);
    assert.deepStrictEqual(report.config.validation, [], 'written config passes the loader');

    const page = fs.readFileSync(path.join(root, 'src', 'pages', 'index.html'), 'utf8');
    assert.ok(page.includes('layout: frontend/core/base'), 'bracket layout rewritten');
    assert.ok(page.includes('{{ resolved.meta.title }}'), 'page.resolved rewritten');
    assert.ok(page.includes('{% include modules/thing.html %}'), 'include slash stripped');

    const layout = fs.readFileSync(path.join(root, 'src', '_layouts', 'custom.html'), 'utf8');
    assert.ok(!layout.includes('forloop.parentloop'), 'parentloop hoisted');

    for (const rel of ['src/_config.yml', 'config/ultimate-jekyll-manager.json', 'Gemfile', 'Gemfile.lock']) {
      assert.ok(!fs.existsSync(path.join(root, rel)), `${rel} removed`);
    }

    assert.ok(!fs.existsSync(path.join(root, 'src', 'assets', 'js', 'main.js')), 'seed-identical main.js removed (core main takes over)');
    assert.ok(fs.existsSync(path.join(root, 'src', 'assets', 'js', 'pages', 'custom.js')), 'customized js NOT deleted');
    assert.ok(report.lint.some((finding) => finding.check === 'ujm-import'), 'non-seed ultimate-jekyll-manager import flagged');

    const scss = fs.readFileSync(path.join(root, 'src', 'assets', 'css', 'main.scss'), 'utf8');
    assert.ok(scss.includes("@use 'omega:main' as * with ("), 'theme-variable customization rewired to the layered importer');
    assert.ok(scss.includes('$primary: #5B47FB'), 'with-args preserved verbatim');

    // Second run: nothing legacy left, the config it wrote is right there —
    // already-converted is DONE, not an error ([#297]).
    const again = runMigration(root, {});
    assert.deepStrictEqual(again.errors, [], 'a rerun is not a failure');
    assert.strictEqual(again.config.skipped, true, 'rerun reports the config step already done');
    assert.strictEqual(again.codemod.totalEdits, 0, 'rewrites are idempotent');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A consumer migrated in the FLEET-STANDARD order (#297): the brand root's
// omega.json5 exists and the app's UJM configs are already gone before
// `omega migrate` runs, so only the codemods are left to do.
function stagePreConvertedBrandTarget() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-preconverted-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: {} } }\n");

  const targetDir = path.join(root, 'targets', 'website');
  fs.mkdirSync(path.join(targetDir, 'src', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'src', 'pages', 'index.html'), [
    '---',
    'layout: themes/[ site.theme.id ]/frontend/core/base',
    '---',
    '<h1>{{ page.resolved.meta.title }}</h1>',
  ].join('\n'));
  fs.writeFileSync(path.join(targetDir, 'Gemfile'), "source 'https://rubygems.org'\n");
  return { root, targetDir };
}

test('e2e: a pre-converted app (brand config above, no legacy configs) succeeds and still codemods (#297)', () => {
  const { root, targetDir } = stagePreConvertedBrandTarget();
  try {
    const report = runMigration(targetDir, {});

    assert.deepStrictEqual(report.errors, [], 'a converted config is not a failure');
    assert.strictEqual(report.config.skipped, true, 'the config step reports itself already done');
    assert.strictEqual(report.config.path, path.join('..', '..', 'config', 'omega.json5'), 'names the config the loader resolves');

    const page = fs.readFileSync(path.join(targetDir, 'src', 'pages', 'index.html'), 'utf8');
    assert.ok(page.includes('{{ resolved.meta.title }}'), 'the codemods still ran');
    assert.ok(page.includes('layout: frontend/core/base'), 'bracket layout rewritten');
    assert.ok(!fs.existsSync(path.join(targetDir, 'Gemfile')), 'legacy hygiene still ran');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('e2e: a pre-converted app whose config does NOT load fails loudly instead of claiming success', () => {
  const { root, targetDir } = stagePreConvertedBrandTarget();
  try {
    // The brand file above the target is unparseable — the target has nothing legacy
    // left, so "already converted" is the branch that must catch this.
    fs.writeFileSync(path.join(root, 'config', 'omega.json5'), "{ brand: { id: 'acme',\n");

    const report = runMigration(targetDir, {});

    assert.strictEqual(report.config.skipped, true, 'still the skip branch');
    assert.ok(report.errors.some((error) => error.includes('Failed to parse')), 'a config that will not load is a migration error, not exit 0');
    assert.deepStrictEqual(report.config.validation, report.errors, 'the loader finding is reported on the config step too');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The mid-conversion boundary (#298): the legacy guard runs BEFORE the
// converted-config probe. A root carrying BOTH — legacy sources and an
// omega.json5 from an earlier partial run — is NOT done; the legacy files are
// the truth to convert from, and hoisting the skip check above the guard would
// strand every such root on a stale config.
test('e2e: legacy configs beside an existing omega.json5 still convert', () => {
  const root = stageLegacyConsumer();
  try {
    fs.writeFileSync(path.join(root, 'config', 'omega.json5'), "{ brand: { id: 'stale', name: 'Stale' }, targets: { web: {} } }\n");

    const report = runMigration(root, {});

    assert.deepStrictEqual(report.errors, []);
    assert.ok(!report.config.skipped, 'an existing omega.json5 never short-circuits a root that still has legacy sources');
    assert.deepStrictEqual(
      report.config.sources,
      [path.join('src', '_config.yml'), path.join('config', 'ultimate-jekyll-manager.json')],
      'the conversion reads the legacy files',
    );

    const written = JSON5.parse(fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8'));
    assert.strictEqual(written.brand.id, 'sample', 'the stale file was rewritten from the legacy sources');
    assert.strictEqual(written.brand.url, 'https://sample.test');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('e2e: neither a legacy config nor a resolvable omega.json5 still fails loudly (#297)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-broken-'));
  try {
    fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'pages', 'index.html'), '<h1>{{ page.resolved.meta.title }}</h1>\n');

    const report = runMigration(root, {});
    assert.strictEqual(report.config, null, 'nothing to report about a config that does not exist');
    assert.ok(report.errors.some((error) => error.includes('no legacy configs found')), 'the broken state is an error');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A UJM consumer carrying the client-runtime surface (#248): consumer JS under
// src/assets/js (the tree the TEMPLATE walk skips), the service-worker entry at
// the src root, and a legacy test harness whose files `node --test
// 'test/**/*.test.js'` cannot see.
function stageClientRuntimeConsumer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-client-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: {} } }\n");

  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'pages', 'account.html'), [
    '---',
    'web_manager:',
    '  auth:',
    '    config:',
    '      policy: "authenticated"',
    '---',
    '{% include themes/classy/global/sections/account.html %}',
    '<button class="btn auth-signout-btn" data-wm-bind="@show auth.user">Sign out</button>',
  ].join('\n'));

  // A section descriptor: the bindings and the signout class live in JSON, and
  // the JS that reads them is renamed by the script walk — a half-rename here
  // is a runtime-dead button with a green build.
  fs.mkdirSync(path.join(root, 'src', '_includes', 'frontend', 'sections'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', '_includes', 'frontend', 'sections', 'account.json'), [
    '{',
    '  "class": "btn auth-signout-btn",',
    '  "attributes": { "data-wm-bind": "@show auth.user" }',
    '}',
  ].join('\n'));

  fs.writeFileSync(path.join(root, 'src', 'service-worker.js'), "import Manager from 'ultimate-jekyll-manager/service-worker';\n");
  fs.mkdirSync(path.join(root, 'src', 'assets', 'js', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'assets', 'js', 'pages', 'contact.js'), [
    "import webManager from 'web-manager';",
    "import { FormManager } from '__main_assets__/js/libs/form-manager.js';",
    'export default () => new FormManager(`${webManager.getApiUrl()}/omega/inbound/contact`);',
  ].join('\n'));

  // The legacy harness as the fleet actually spells it: layer in the EXPORT,
  // any path under test/, any filename — including `*.test.js` names node:test
  // happily loads and counts as a pass with zero assertions.
  fs.mkdirSync(path.join(root, 'test', 'build'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test', 'boot'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test', 'smoke'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test', '_helpers'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test', 'build', 'xp-curve.js'), "module.exports = { layer: 'build', description: 'xp curve', run: async (ctx) => ctx.expect(1).toBe(1) };\n");
  fs.writeFileSync(path.join(root, 'test', 'build', 'config.test.js'), "module.exports = { layer: 'build', type: 'suite', tests: [{ name: 'has brand.id', run: async (ctx) => ctx.expect(1).toBe(1) }] };\n");
  fs.writeFileSync(path.join(root, 'test', 'boot', 'chat-shell.js'), "module.exports = { layer: 'boot', description: 'chat shell', inspect: async ({ page }) => page.title() };\n");
  fs.writeFileSync(path.join(root, 'test', 'smoke', 'nav.js'), "module.exports = { layer: 'page', description: 'nav', run: async (ctx) => ctx.expect(1).toBe(1) };\n");
  fs.writeFileSync(path.join(root, 'test', 'boot', 'ported.test.js'), "const { test } = require('node:test');\ntest('ported', () => {});\n");
  fs.writeFileSync(path.join(root, 'test', '_init.js'), 'module.exports = () => ({ setup: async () => {} });\n');
  fs.writeFileSync(path.join(root, 'test', '_helpers', 'harness.js'), 'module.exports = { helper: true };\n');
  return root;
}

test('e2e: the client-runtime renames reach templates, consumer JS and the service worker (#248)', () => {
  const root = stageClientRuntimeConsumer();
  try {
    const report = runMigration(root, {});
    assert.deepStrictEqual(report.errors, []);

    const page = fs.readFileSync(path.join(root, 'src', 'pages', 'account.html'), 'utf8');
    assert.ok(page.includes('\nconfig:\n  client:\n'), 'frontmatter key renamed, and moved under the page config parent (#607)');
    assert.ok(page.includes('{% include global/sections/account.html %}'), 'theme-prefixed include flattened');
    assert.ok(page.includes('class="btn omega-signout"'), 'signout trigger class renamed');
    assert.ok(page.includes('data-omega-bind="@show auth.user"'), 'binding attribute renamed');

    const section = fs.readFileSync(path.join(root, 'src', '_includes', 'frontend', 'sections', 'account.json'), 'utf8');
    assert.ok(section.includes('"class": "btn omega-signout"'), 'the section descriptor is walked — no half-rename');
    assert.ok(section.includes('"data-omega-bind": "@show auth.user"'), 'the descriptor binding renamed with the JS that reads it');

    const worker = fs.readFileSync(path.join(root, 'src', 'service-worker.js'), 'utf8');
    assert.strictEqual(worker, "import Manager from '@omega.js/web/service-worker';\n", 'the src-root entry is walked too');

    const contact = fs.readFileSync(path.join(root, 'src', 'assets', 'js', 'pages', 'contact.js'), 'utf8');
    assert.ok(contact.includes("import omega from '@omega.js/client';"), 'consumer JS under src/assets is walked');
    assert.ok(contact.includes("from '@omega.js/client/modules/form-manager.js'"), 'the lib moved to its client module');
    assert.ok(contact.includes('${omega.getApiUrl()}'), 'the singleton identifier renamed');

    const again = runMigration(root, {});
    assert.strictEqual(again.codemod.totalEdits, 0, 'the client-runtime rewrites are idempotent');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('e2e: a legacy test harness is reported as undiscoverable, not silently dark (#248)', () => {
  const root = stageClientRuntimeConsumer();
  try {
    const report = runMigration(root, { check: true });

    assert.deepStrictEqual(
      report.legacyTests,
      [
        path.join('test', 'boot', 'chat-shell.js'),
        path.join('test', 'build', 'config.test.js'),
        path.join('test', 'build', 'xp-curve.js'),
        path.join('test', 'smoke', 'nav.js'),
      ],
      'every harness-shaped file under test/ — any layer dir, any name — and no real node:test file, no `_`-prefixed helper',
    );
    assert.deepStrictEqual(report.errors, [], 'an undiscoverable suite is a warning, never a failed migration');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('e2e: no legacy gradient utility survives a codemod run (#296)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-gradients-'));
  try {
    fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'pages', 'index.html'), [
      '---',
      'layout: frontend/core/base',
      '---',
      '<section class="bg-gradient-rainbow gradient-animated gradient-grain text-light">',
      '  <h1>Hero</h1>',
      '</section>',
      '<div class="gradient-grain rounded-4">Grain only</div>',
    ].join('\n'));

    const report = runCodemod(root, { write: true });
    const page = fs.readFileSync(path.join(root, 'src', 'pages', 'index.html'), 'utf8');
    assert.ok(!/gradient-animated|gradient-grain/.test(page), 'the walk reaches the rule — nothing legacy left on disk');
    assert.ok(page.includes('<section class="bg-gradient-rainbow omega-dotgrid text-light" data-omega-dotfield>'), 'the hero wears the v2 treatment');
    assert.ok(page.includes('<div class="omega-dotgrid rounded-4">Grain only</div>'), 'the static half converts without the motion attribute');
    assert.ok(report.files.some((file) => file.edits.some((edit) => edit.rule === 'gradient-utilities')), 'the edits are reported under the rule');

    const again = runCodemod(root, { write: true });
    assert.strictEqual(again.totalEdits, 0, 'converting is a ONE-time move — a rerun changes nothing');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Runtime composition — omega.json5 homes render into the chrome contract
// ---------------------------------------------------------------------------

test('composition: cloud/payment/analytics at their omega homes reach the chrome', async () => {
  const MINI = path.join(__dirname, 'fixtures', 'mini-site');
  const siteData = {
    ...JSON.parse(fs.readFileSync(path.join(MINI, 'site-data.json'), 'utf8')),
    cloud: { provider: 'firebase', config: { apiKey: 'AIza-COMPOSE', projectId: 'compose-test' } },
    payment: { providers: { chargebee: { site: 'compose' } }, products: [{ id: 'basic', name: 'Basic' }] },
    analytics: { providers: { google: { id: 'G-COMPOSE1' } } },
  };

  const Eleventy = require('@11ty/eleventy').default;
  const elev = new Eleventy(MINI, path.join(PKG, '.omega', 'migrate-test-out'), {
    quietMode: true,
    configPath: false,
    config: (eleventyConfig) => {
      eleventyConfig.setUseTemplateCache(false);
      return configureOmega(eleventyConfig, {
        consumerDir: MINI,
        siteData,
        assetManifest: { js: { main: '/assets/js/main-TEST.js', pages: {} }, css: { main: '/assets/css/main-TEST.css', pages: {}, themePages: {} } },
      });
    },
  });
  const pages = new Map((await elev.toJSON()).map((result) => [result.url, result.content]));
  const html = pages.get('/');

  // The id reaches the page as CONFIG and nothing else (#383): the chrome no
  // longer emits a loader, so the runtime gate decides whether gtag.js is ever
  // fetched. Configuration.analytics is the whole contract now.
  assert.ok(html.includes('"google":{"id":"G-COMPOSE1"}'), 'Configuration.analytics carries the canonical providers shape (flat bridge dead — cp106a)');
  assert.ok(!html.includes('googletagmanager.com/gtag/js'), 'and no loader ships with the chrome');
  assert.ok(html.includes('"apiKey":"AIza-COMPOSE"'), 'cloud.config composed into client.firebase.app.config');
  assert.ok(html.includes('"site":"compose"'), 'payment composed into client.payment');
});
