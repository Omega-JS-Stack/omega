/**
 * `omega migrate` — the B4 codemod + liquid-lint suite.
 *
 * Three layers: rule units (pure text transforms, incl. the false-positive
 * guards), SEMANTIC proofs (the rewrites render identically / correctly
 * through the real LiquidJS + template-kit adapter — the same path the
 * engine uses), and the end-to-end migration of a synthetic UJM consumer in
 * a temp dir (config conversion validated through the real @omega.js/config
 * loader, legacy files removed, a report writes nothing). Plus the runtime
 * composition the migration relies on: cloud/payment/analytics at
 * their omega.json5 homes render into the chrome's composed spots.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const JSON5 = require('json5');
const sass = require('sass');
const { Liquid } = require('liquidjs');
const { registerLiquid } = require('@omega.js/template-kit');
const { loadConfig } = require('@omega.js/config');
const { applyRules, applyJsRules, applyJsonRules, runCodemod } = require('../src/migrate/codemod.js');
const { convertConfig, serializeOmega } = require('../src/migrate/config-convert.js');
const { lintText } = require('../src/migrate/lint.js');
const { runMigration } = require('../src/migrate/index.js');
const { LEGACY_JEKYLL, LEGACY_UJM, stageLegacyConsumer } = require('./lib/migrate-fixtures.js');
// The lane NAMES the environment
// ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)): the engine reads
// that ONE input instead of a loose `options.environment`, and a fixture build
// with no verb above it is a development build, which is what it always was.
const { setEnvironment } = require('@omega.js/config/environment');
const { configureOmega } = require('../src/index.js');

const PKG = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Semantic proofs — rewrites render correctly through the REAL adapter
// ---------------------------------------------------------------------------

function realEngine() {
  const engine = new Liquid({ jekyllInclude: true });
  registerLiquid(engine, { logos: { dir: path.join(PKG, 'core', 'logos') } });
  return engine;
}

// A consumer migrated in the FLEET-STANDARD order (#297): the brand root's
// omega.json5 exists and the app's UJM configs are already gone before
// `omega migrate` runs, so only the codemods are left to do.
function stagePreConvertedBrandTarget() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-preconverted-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: { type: 'web' } } }\n");

  const targetDir = path.join(root, 'targets', 'web');
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

// A UJM consumer carrying the client-runtime surface (#248): consumer JS under
// src/assets/js (the tree the TEMPLATE walk skips), the service-worker entry at
// the src root, and a legacy test harness whose files `node --test
// 'test/**/*.test.js'` cannot see.
function stageClientRuntimeConsumer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-client-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: { type: 'web' } } }\n");

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

module.exports = defineCases({
  type: 'group',
  description: 'migrate',
  tests: [
    // ---------------------------------------------------------------------------
    // Rule units
    // ---------------------------------------------------------------------------

    {
      name: 'rules: page.resolved, includes, canonical, page props, analytics spelling',
      run: (ctx) => {
        const input = [
          '{{ page.resolved.meta.title }}',
          '{% include /modules/adsense.html %}',
          '<link rel="canonical" href="{{ page.canonical.url }}">',
          '{{ page.content }} {{ page.slug }} {{ page.post_id }} {{ page.url }}',
          '{{ site.analytics.google }} {{ resolved.analytics.tiktok }}',
        ].join('\n');
        const { text, edits } = applyRules(input, 'unit.html');
        const lines = text.split('\n');
        ctx.expect(lines[0]).toBe('{{ resolved.meta.title }}');
        ctx.expect(lines[1]).toBe('{% include modules/adsense.html %}');
        ctx.expect(lines[2]).toBe('<link rel="canonical" href="{{ site.url }}{{ page.url }}">');
        ctx.expect(lines[3]).toBe('{{ content }} {{ page.fileSlug }} {{ post_id }} {{ page.url }}');
        // …then config-reads (#611) moves both roots onto the one namespace config
        // lives in now.
        ctx.expect(lines[4]).toBe('{{ resolved.config.analytics.providers.google.id }} {{ resolved.config.analytics.providers.tiktok.id }}');
        ctx.expect(edits.length, 'one edit recorded per changed line per rule').toBe(6);
      },
    },

    {
      name: 'rules: legacy uj_ tags/filters and site.uj globals become omega_ / site.omega',
      run: (ctx) => {
        const input = [
          '{% uj_icon "rocket", "fa-fw" %}{{ title | uj_title_case }}',
          '<img src="{{ site.uj.placeholder.src }}" data-lazy="@src {{ image }}">',
          '<span class="uj-password-show"></span>',
          'A path like /assets/uj_legacy.png stays a path',
        ].join('\n');
        const { text } = applyRules(input, 'unit.html');
        const lines = text.split('\n');
        ctx.expect(lines[0], 'the icon tag becomes native markup (#619); the filter beside it still renames').toBe('<i class="fa-solid fa-rocket fa-fw"></i>{{ title | omega_title_case }}');
        ctx.expect(lines[1]).toBe('<img src="{{ site.omega.placeholder.src }}" data-lazy="@src {{ image }}">');
        ctx.expect(lines[2]).toBe('<span class="omega-password-show"></span>');
        ctx.expect(lines[3], 'only known names rename').toBe('A path like /assets/uj_legacy.png stays a path');
      },
    },

    {
      name: 'rules: bracket layouts rewritten only on layout lines',
      run: (ctx) => {
        const input = [
          'layout: themes/[ site.theme.id ]/frontend/core/base',
          '  layout: themes/classy/frontend/pages/index',
          'Text mentioning themes/[ site.theme.id ]/frontend stays',
        ].join('\n');
        const { text } = applyRules(input, 'unit.md');
        const lines = text.split('\n');
        ctx.expect(lines[0]).toBe('layout: frontend/core/base');
        ctx.expect(lines[1]).toBe('  layout: frontend/pages/index');
        // Untouched by BOTH rules: the bracket rule only answers to `layout:` lines,
        // and config-reads only counts LIQUID context (#611 F4) — a legacy `[ … ]`
        // bracket in prose is neither.
        ctx.expect(lines[2]).toBe('Text mentioning themes/[ site.theme.id ]/frontend stays');
      },
    },

    {
      name: 'rules: false-positive guards — filenames, valid page props, manual props',
      run: (ctx) => {
        const input = [
          '![Words on a page](@post/word-of-mouth-words-on-a-page.png)',
          '<a href="/landing-page.html">{{ page.date }}</a>',
          '{{ page.next.url }}',
        ].join('\n');
        const { text, findings } = applyRules(input, 'unit.md');
        const lines = text.split('\n');
        ctx.expect(lines[0], 'filename untouched').toBe('![Words on a page](@post/word-of-mouth-words-on-a-page.png)');
        ctx.expect(lines[1], 'valid prop + path untouched').toBe('<a href="/landing-page.html">{{ page.date }}</a>');
        ctx.expect(lines[2], 'manual prop not rewritten').toBe('{{ page.next.url }}');
        ctx.expect(findings.some((finding) => finding.message.includes('page.next')), 'manual prop flagged').toBeTruthy();
      },
    },

    {
      name: 'rules: page.<key> inside a loop binding the same name is skipped, not silently broken (#541)',
      run: (ctx) => {
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
        ctx.expect(lines[0], 'outside the loop the rename still happens').toBe('{{ tag }}');
        ctx.expect(lines[2], 'the loop binds `tag`: renaming would compare the loop item to itself and make the guard always true').toBe('  {% if tag != page.tag.name %}<a href="{{ tag.url }}">{{ tag.name }}</a>{% endif %}');
        ctx.expect(lines[5], '{% tablerow %} binds the same way').toBe('  {% if category != page.category.name %}{{ category.name }}{% endif %}');
        ctx.expect(lines[7], 'and past the loop the rename is back').toBe('{{ tag }}');

        const bound = findings.filter((finding) => finding.check === 'page-props' && /loop/.test(finding.message));
        ctx.expect(bound.map((finding) => finding.line), `one warn per skipped line: ${JSON.stringify(findings)}`).toEqual([3, 6]);
        ctx.expect(bound[0].severity, 'a skipped rename needs a hand-port').toBe('error');
        ctx.expect(/page\.tag/.test(bound[0].message), 'the warn names the reference it left alone').toBeTruthy();
        ctx.expect(/`tag`/.test(bound[0].message), 'and the loop variable that shadows it').toBeTruthy();
      },
    },

    {
      name: 'rules: the loop-scope skip names the FILE and line through the codemod (#541)',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-541-'));
        try {
          fs.mkdirSync(path.join(root, 'src', 'pages', 'blog'), { recursive: true });
          fs.writeFileSync(path.join(root, 'src', 'pages', 'blog', 'tag.html'), [
            '{% for tag in collections.tags %}',
            '{% if tag != page.tag.name %}{{ tag.name }}{% endif %}',
            '{% endfor %}',
          ].join('\n'));
          const { findings } = runCodemod(root, { execute: false });
          const bound = findings.filter((finding) => finding.check === 'page-props' && /loop/.test(finding.message));
          ctx.expect(bound.length, `one finding: ${JSON.stringify(findings)}`).toBe(1);
          ctx.expect(bound[0].file, 'the warn names the file').toBe(path.join('src', 'pages', 'blog', 'tag.html'));
          ctx.expect(bound[0].line, 'and the line').toBe(2);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'rules: tag-arg hoist scoped to the tag span',
      run: (ctx) => {
        const input = '<a title="{{ t }}">{% omega_logo "{{ brand.slug }}-mark" %}</a>';
        const { text } = applyRules(input, 'unit.html');
        const lines = text.split('\n');
        ctx.expect(lines[0].trim()).toBe('{% capture omega_migrate_arg_1 %}{{ brand.slug }}-mark{% endcapture %}');
        ctx.expect(lines[1].includes('title="{{ t }}"'), 'HTML attribute interpolation untouched').toBeTruthy();
        ctx.expect(lines[1].includes('{% omega_logo omega_migrate_arg_1 %}'), 'tag arg replaced with the capture var').toBeTruthy();
      },
    },

    // #619 — icons stopped being a tag on BOTH sides of the rename, so the lane
    // converts them to the markup the build inlines, never to a dead tag name.
    {
      name: 'rules: the icon tag becomes native Font Awesome markup',
      run: (ctx) => {
        const input = [
          '{% uj_icon "rocket" %}',
          '{% omega_icon "arrow-right", "fa-sm ms-2" %}',
          '{% omega_icon item.icon, "fa-sm" %}',
          '{% omega_icon "star", label="Featured" %}',
        ].join('\n');
        const { text, edits } = applyRules(input, 'unit.html');
        const lines = text.split('\n');

        ctx.expect(lines[0], 'the legacy name converts too — no uj_icon survives').toBe('<i class="fa-solid fa-rocket"></i>');
        ctx.expect(lines[1], 'the positional class arg rides along').toBe('<i class="fa-solid fa-arrow-right fa-sm ms-2"></i>');
        ctx.expect(lines[2], 'a variable name interpolates into the class').toBe('<i class="fa-solid fa-{{ item.icon }} fa-sm"></i>');
        ctx.expect(lines[3], 'a key=value option is not a class list').toBe('<i class="fa-solid fa-star"></i>');
        ctx.expect(edits.every((edit) => edit.rule !== 'legacy-prefix' || !edit.after.includes('icon')), 'the rename never sees an icon tag').toBeTruthy();
      },
    },

    // ---------------------------------------------------------------------------
    // Rule units — the WM → @omega.js/client rename surface (#248)
    // ---------------------------------------------------------------------------

    {
      name: 'rules: client markup hooks — data-wm-bind and the signout trigger class (#248)',
      run: (ctx) => {
        const input = [
          '<div class="dropdown" data-wm-bind="@show auth.user" hidden>',
          '<button class="btn btn-danger auth-signout-btn">Sign out</button>',
          "document.querySelector('.auth-signout-btn')",
        ].join('\n');
        const { text } = applyRules(input, 'unit.html');
        const lines = text.split('\n');
        ctx.expect(lines[0]).toBe('<div class="dropdown" data-omega-bind="@show auth.user.authenticated" hidden>');
        ctx.expect(lines[1]).toBe('<button class="btn btn-danger omega-signout">Sign out</button>');
        ctx.expect(lines[2], 'the same rename in JS the codemod also walks').toBe("document.querySelector('.omega-signout')");
      },
    },

    {
      name: 'rules: client markup renames the EXACT tokens — longer names are other names (#248)',
      run: (ctx) => {
        const input = [
          '<button class="auth-signout-btn-large">Bigger</button>',
          '<button class="js-auth-signout-btn">Hooked</button>',
          '<div data-wm-bind-once="@show auth.user" x-data-wm-bind="nope"></div>',
          '<button class="auth-signout-btn" data-wm-bind="@show auth.user">Sign out</button>',
        ].join('\n');
        const { text } = applyRules(input, 'unit.html');
        const lines = text.split('\n');
        ctx.expect(lines[0], 'a longer class is a DIFFERENT class').toBe('<button class="auth-signout-btn-large">Bigger</button>');
        ctx.expect(lines[1], 'a prefixed class is a different class too').toBe('<button class="js-auth-signout-btn">Hooked</button>');
        ctx.expect(lines[2], 'the attribute name matches whole, both ends').toBe('<div data-wm-bind-once="@show auth.user" x-data-wm-bind="nope"></div>');
        ctx.expect(lines[3], 'the exact tokens still rename').toBe('<button class="omega-signout" data-omega-bind="@show auth.user.authenticated">Sign out</button>');
      },
    },

    {
      name: 'rules: section descriptors (.json) get the markup rename and NOTHING else (#248)',
      run: (ctx) => {
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
        ctx.expect(lines[1]).toBe('  "class": "btn omega-signout",');
        ctx.expect(lines[2]).toBe('  "attributes": { "data-omega-bind": "@show auth.user.authenticated" },');
        ctx.expect(lines[3], 'the template rules never run over a descriptor').toBe('  "include": "{% include /modules/adsense.html %}",');
        ctx.expect(lines[4], 'a JSON key is not a Jekyll frontmatter read').toBe('  "heading": "{{ page.post_id }}"');
        ctx.expect(edits.length, 'one edit per changed line, client-markup only').toBe(2);
      },
    },

    {
      name: 'rules: a binding that shows or hides on the bare `auth.user` reads `auth.user.authenticated` (#885)',
      run: (ctx) => {
        // A User is always an object now, so a bare `auth.user` condition is truthy
        // for everyone and the element never hides again.
        const input = [
          '<a data-wm-bind="@show auth.user">Account</a>',
          '<a data-wm-bind="@hide auth.user, @text auth.user.profile.displayName">Sign in</a>',
          '<a data-omega-bind="@show !auth.user">Join</a>',
          '<a data-omega-bind="@show auth.user.plan === \'premium\'">Pro</a>',
          '<a data-omega-bind="@show auth.userName">Other</a>',
        ].join('\n');
        const { text } = applyRules(input, 'unit.html');
        const lines = text.split('\n');
        ctx.expect(lines[0]).toBe('<a data-omega-bind="@show auth.user.authenticated">Account</a>');
        ctx.expect(lines[1], '@hide reads the same flag, the other bindings untouched').toBe('<a data-omega-bind="@hide auth.user.authenticated, @text auth.user.profile.displayName">Sign in</a>');
        ctx.expect(lines[2], 'the negation keeps its bang').toBe('<a data-omega-bind="@show !auth.user.authenticated">Join</a>');
        ctx.expect(lines[3], 'a deeper read is already a real field').toBe('<a data-omega-bind="@show auth.user.plan === \'premium\'">Pro</a>');
        ctx.expect(lines[4], 'a longer name is another name').toBe('<a data-omega-bind="@show auth.userName">Other</a>');

        const again = applyRules(text, 'unit.html');
        ctx.expect(again.text, 'idempotent').toBe(text);
      },
    },

    {
      name: 'rules: the client markup rename reaches a CRLF file too (#885)',
      run: (ctx) => {
        const { text } = applyRules('<div data-wm-bind="@show auth.user">\r\n<a class="auth-signout-btn">\r\n', 'unit.html');
        ctx.expect(text, 'a carriage return is not the end of what the rule may read').toBe('<div data-omega-bind="@show auth.user.authenticated">\r\n<a class="omega-signout">\r\n');
      },
    },

    {
      name: 'rules: frontmatter `web_manager:` becomes `client:` under `config:`, body prose untouched (#248, #607)',
      run: (ctx) => {
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
        ctx.expect(lines[2]).toBe('config:');
        ctx.expect(lines[3]).toBe('  client:');
        ctx.expect(lines[4], 'the block children ride along untouched').toBe('    auth:');
        // #383: the sub-key was renamed too, and a page that disabled the old name
        // would silently stop disabling anything.
        ctx.expect(lines[7], 'cookieConsent: becomes consent:').toBe('    consent:');
        ctx.expect(lines[8], 'its value is untouched').toBe('      enabled: false');
        ctx.expect(lines[10], 'the body is not frontmatter').toBe('Prose about a web_manager: key stays prose.');
      },
    },

    {
      name: 'rules: theme-prefixed include paths flatten to the layered path (#248)',
      run: (ctx) => {
        const input = [
          '{% include themes/classy/global/sections/account.html size="sm" %}',
          '{% include /themes/[ site.theme.id ]/backend/sections/sidebar.html %}',
          '{%- include_cached themes/newsflash/frontend/components/testimonial-scroll.html -%}',
          'A path like themes/classy/global/sections/account.html in prose stays',
        ].join('\n');
        const { text } = applyRules(input, 'unit.html');
        const lines = text.split('\n');
        ctx.expect(lines[0]).toBe('{% include global/sections/account.html size="sm" %}');
        ctx.expect(lines[1], 'the leading slash goes first, then the theme prefix').toBe('{% include backend/sections/sidebar.html %}');
        ctx.expect(lines[2]).toBe('{%- include_cached frontend/components/testimonial-scroll.html -%}');
        ctx.expect(lines[3]).toBe('A path like themes/classy/global/sections/account.html in prose stays');
      },
    },

    {
      name: 'rules: consumer JS — `web-manager` becomes `@omega.js/client`, `webManager` becomes `omega` (#248)',
      run: (ctx) => {
        const input = [
          "import webManager from 'web-manager';",
          "import { ready as domReady } from 'web-manager/modules/dom.js';",
          'const url = `${webManager.getApiUrl()}/omega/user/token`;',
          "webManager.storage().get('attribution', {});",
        ].join('\n');
        const { text } = applyJsRules(input, 'src/assets/js/pages/token/index.js');
        const lines = text.split('\n');
        ctx.expect(lines[0]).toBe("import omega from '@omega.js/web/runtime';");
        ctx.expect(lines[1], 'subpath imports move with the package').toBe("import { ready as domReady } from '@omega.js/client/modules/dom.js';");
        ctx.expect(lines[2]).toBe('const url = `${omega.getApiUrl()}/omega/user/token`;');
        ctx.expect(lines[3]).toBe("omega.storage().get('attribution', {});");
      },
    },

    {
      name: 'rules: consumer JS — the __main_assets__ libs move to @omega.js/client (#248)',
      run: (ctx) => {
        const input = [
          "import omega from '@omega.js/web/runtime';",
          "import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';",
          "import { FormManager } from '__main_assets__/js/libs/form-manager.js';",
          "const response = await authorizedFetch(`${omega.getApiUrl()}/backend-manager/payments/intent`, { response: 'json' });",
        ].join('\n');
        const { text, findings } = applyJsRules(input, 'src/assets/js/pages/payment/checkout/modules/api.js');
        const lines = text.split('\n');
        ctx.expect(lines[0]).toBe("import omega from '@omega.js/web/runtime';");
        ctx.expect(lines[1], 'the authorized-fetch import line is gone — there is no such module').toBe("import { FormManager } from '@omega.js/client/modules/form-manager.js';");
        ctx.expect(lines[2], "the wonderful-fetch response option goes with the function (#594)").toBe("const response = await omega.request(`${omega.getApiUrl()}/backend-manager/payments/intent`, {});");
        ctx.expect(findings.some((finding) => finding.check === 'client-libs' && finding.severity === 'warning' && finding.line === 4), 'the rewritten call is flagged: the options are the client\'s, not wonderful-fetch\'s').toBeTruthy();
      },
    },

    {
      name: 'rules: the authorizedFetch rewrite carries the ERROR SHAPE and drops the dead option (#594)',
      run: (ctx) => {
        const input = [
          "import omega from '@omega.js/web/runtime';",
          "import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';",
          'export default async function generate(payload) {',
          '  try {',
          '    return await authorizedFetch(`${omega.getApiUrl()}/backend-manager/copilot/generate`, {',
          "      method: 'POST',",
          "      response: 'json',",
          '      body: payload,',
          '    });',
          '  } catch (err) {',
          '    if (err.status === 429) return showUpgradeModal();',
          '    throw err;',
          '  }',
          '}',
        ].join('\n');
        const { text, findings } = applyJsRules(input, 'src/assets/js/pages/copilot/generate.js');

        ctx.expect(text, "`response: 'json'` has no equivalent — omega.request RETURNS the parsed body").not.toMatch(/response:\s*'json'/);
        ctx.expect(text, 'and the options around it survive intact').toMatch(/method: 'POST',\n      body: payload,/);
        ctx.expect(text, '`err.status` read undefined on an omega.request error, so the 429 branch died silently').not.toMatch(/err\.status/);
        ctx.expect(text, '…the HTTP status lives on error.code (@omega.js/client request.js)').toMatch(/if \(err\.code === 429\)/);

        ctx.expect(findings.some((finding) => finding.check === 'client-libs' && finding.line === 5 && /backend-manager/.test(finding.message)), `the rewritten call still names the route segment nobody can rewrite for it: ${findings.map((f) => f.message).join(' | ')}`).toBeTruthy();
      },
    },

    {
      name: 'rules: what the authorizedFetch rewrite CANNOT do mechanically is named line by line (#594)',
      run: (ctx) => {
        const input = [
          "import omega from '@omega.js/web/runtime';",
          "import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';",
          "const OPTIONS = { method: 'POST', response: 'text' };",
          "export const asText = (body) => authorizedFetch('/omega/x', { response: 'text', body });",
          "export const viaVariable = () => authorizedFetch('/omega/y', OPTIONS);",
          'export const ok = (res) => res.status === 204;',
        ].join('\n');
        const { text, findings } = applyJsRules(input, 'src/assets/js/lib/api.js');
        const named = (pattern) => findings.filter((finding) => pattern.test(finding.message)).map((finding) => finding.line);

        ctx.expect(text, 'a non-json response is NOT quietly dropped — its output handling is a port, not a rename').toMatch(/\{ response: 'text', body \}/);
        ctx.expect(named(/response: 'text'/), 'it is named at its own line instead').toEqual([4]);
        ctx.expect(named(/options come from a variable/), 'options behind an identifier are unreachable for a text codemod — named too').toEqual([5]);
        ctx.expect(text, 'a `.status` read on something that is not a caught error stays put').toMatch(/res\.status === 204/);
        ctx.expect(named(/`res\.status`/), '…and is named, because only a human knows whose status it is').toEqual([6]);
      },
    },

    {
      name: 'rules: the no-paren arrow `.catch(err =>` binds the error too (#594)',
      run: (ctx) => {
        const input = [
          "import omega from '@omega.js/web/runtime';",
          "import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';",
          "export const load = () => authorizedFetch('/omega/user/get')",
          '  .catch(err => {',
          '    if (err.status === 429) return retry();',
          '    throw err;',
          '  });',
        ].join('\n');
        const { text, findings } = applyJsRules(input, 'src/assets/js/lib/load.js');

        ctx.expect(text, 'the paren-less arrow is the commonest spelling of all — its binding is a catch binding like any other').toMatch(/if \(err\.code === 429\)/);
        ctx.expect(!findings.some((finding) => /left `err\.status`/.test(finding.message)), `…so it is rewritten, not handed back as a manual step: ${findings.map((f) => f.message).join(' | ')}`).toBeTruthy();
      },
    },

    {
      name: 'rules: a `.status` on something that is not IN the catch block is left alone (#594)',
      run: (ctx) => {
        const input = [
          "import omega from '@omega.js/web/runtime';",
          "import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';",
          "export const load = () => authorizedFetch('/omega/user/get').catch((err) => {",
          '  if (err.status === 503) return null;',
          '  throw err;',
          '});',
          'export function isSuccess(err) {',
          '  return err.status === 200;',
          '}',
        ].join('\n');
        const { text, findings } = applyJsRules(input, 'src/assets/js/lib/load.js');

        ctx.expect(text, 'inside the catch block the rewrite is mechanical').toMatch(/if \(err\.code === 503\)/);
        ctx.expect(text, 'a same-named parameter of an unrelated function is NOT that error — its `.status` is its own').toMatch(/return err\.status === 200;/);
        ctx.expect(findings.some((finding) => finding.line === 8 && /`err\.status`/.test(finding.message)), `…and it is named at its line instead: ${findings.map((f) => `${f.line}:${f.message}`).join(' | ')}`).toBeTruthy();
      },
    },

    {
      name: 'rules: an unbalanced paren inside a STRING never hands the option strip the rest of the file (#594)',
      run: (ctx) => {
        const input = [
          "import omega from '@omega.js/web/runtime';",
          "import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';",
          "export const search = (q) => authorizedFetch('/omega/search(', { method: 'POST' });",
          "export const defaults = { response: 'json', keep: true };",
          '',
        ].join('\n');
        const { text } = applyJsRules(input, 'src/assets/js/lib/search.js');

        ctx.expect(text, 'an unrelated object BELOW the call keeps its keys — the paren in the url is text, not structure').toMatch(/export const defaults = \{ response: 'json', keep: true \};/);
        ctx.expect(text, "and the call's own options survive the walk intact").toMatch(/omega\.request\('\/omega\/search\(', \{ method: 'POST' \}\)/);
      },
    },

    {
      name: 'rules: an authorizedFetch file with no client import is flagged, never silently broken (#248)',
      run: (ctx) => {
        const input = [
          "import authorizedFetch from '__main_assets__/js/libs/authorized-fetch.js';",
          "export default () => authorizedFetch('/omega/user/token');",
        ].join('\n');
        const { findings } = applyJsRules(input, 'src/assets/js/pages/orphan/index.js');
        ctx.expect(findings.some((finding) => finding.severity === 'error' && finding.message.includes("import omega from '@omega.js/web/runtime'")), '`omega` is not in scope — the rewrite says so instead of emitting a broken module').toBeTruthy();
      },
    },

    {
      name: 'rules: the service-worker entry imports @omega.js/web; the bare package import stays (#248)',
      run: (ctx) => {
        const worker = applyJsRules("import Manager from 'ultimate-jekyll-manager/service-worker';", 'src/service-worker.js');
        ctx.expect(worker.text).toBe("import Manager from '@omega.js/web/service-worker';");

        const seed = applyJsRules("import Manager from 'ultimate-jekyll-manager';", 'src/assets/js/main.js');
        ctx.expect(seed.text, 'the bare import stays for the asset-layer step to own').toBe("import Manager from 'ultimate-jekyll-manager';");
      },
    },

    // ---------------------------------------------------------------------------
    // Rule units — Kramdown inline attribute lists (#565)
    // ---------------------------------------------------------------------------

    {
      name: 'rules: a Kramdown attribute list on a link becomes a real anchor (#565)',
      run: (ctx) => {
        const input = [
          '[Get your API key](/account#apiKeys){: .btn .btn-primary .btn-lg }',
          '[Read the docs](/docs){:.btn}',
          'Inline [pricing](/pricing){: .link-primary } mid-sentence.',
          'A brace-colon in prose, {:like this}, is not an attribute list.',
        ].join('\n');
        const { text, edits, findings } = applyRules(input, 'src/pages/solutions/ocr.md');
        const lines = text.split('\n');
        ctx.expect(lines[0]).toBe('<a href="/account#apiKeys" class="btn btn-primary btn-lg">Get your API key</a>');
        ctx.expect(lines[1], 'the space after `{:` is optional in Kramdown').toBe('<a href="/docs" class="btn">Read the docs</a>');
        ctx.expect(lines[2], 'an inline link converts in place').toBe('Inline <a href="/pricing" class="link-primary">pricing</a> mid-sentence.');
        ctx.expect(lines[3], 'an IAL opens with a class, an id or an attribute').toBe('A brace-colon in prose, {:like this}, is not an attribute list.');
        ctx.expect(edits.filter((edit) => edit.rule === 'markdown-ial').length, 'one edit per converted line').toBe(3);
        ctx.expect(findings.filter((finding) => finding.check === 'markdown-ial'), 'a converted link reports nothing').toEqual([]);

        const again = applyRules(text, 'src/pages/solutions/ocr.md');
        ctx.expect(again.text, 'the rewrite is idempotent').toBe(text);
      },
    },

    {
      name: 'rules: an attribute list the rewrite cannot claim is loud, never left as page text (#565)',
      run: (ctx) => {
        const input = [
          '## Pricing',
          '{: .text-center }',
          '[Contact sales](/contact){: .btn #cta }',
        ].join('\n');
        const { text, findings } = applyRules(input, 'src/pages/pricing.md');
        ctx.expect(text, 'a block IAL and an attribute-carrying link IAL are hand ports').toBe(input);
        const found = findings.filter((finding) => finding.check === 'markdown-ial');
        ctx.expect(found.map((finding) => finding.line), 'both survivors are named').toEqual([2, 3]);
        ctx.expect(found.every((finding) => finding.severity === 'error'), 'markdown-it has no attrs plugin — an IAL PRINTS on the page').toBeTruthy();

        const html = applyRules(input, 'src/pages/pricing.html');
        ctx.expect(html.text, 'an .html page was never markdown — the IAL was already literal text under Jekyll').toBe(input);
        ctx.expect(html.findings.filter((finding) => finding.check === 'markdown-ial')).toEqual([]);
      },
    },

    // ---------------------------------------------------------------------------
    // Rule units — the retired adunits/* includes (#559)
    // ---------------------------------------------------------------------------

    {
      name: 'rules: the retired adsense adunit include becomes the verts/unit section (#559)',
      run: (ctx) => {
        const input = [
          '{% include /modules/adunits/adsense.html type="in-article" vert-size="banner" %}',
          '{% include modules/adunits/adsense.html %}',
          '{%- include modules/adunits/adsense.html type=unit_type -%}',
          '{% include modules/other/promo.html type="display" %}',
        ].join('\n');
        const { text, edits, findings } = applyRules(input, 'src/pages/tools/ocr.html');
        const lines = text.split('\n');
        ctx.expect(lines[0], '`type` carries, `vert-size` is the OMEGA `size`').toBe('{% section "verts/unit", type: "in-article", size: "banner" %}');
        ctx.expect(lines[1], 'an unargued unit rides the section defaults').toBe('{% section "verts/unit" %}');
        ctx.expect(lines[2], 'whitespace control and a variable value carry verbatim').toBe('{%- section "verts/unit", type: unit_type -%}');
        ctx.expect(lines[3], 'a non-adunit include is somebody else\'s').toBe('{% include modules/other/promo.html type="display" %}');
        ctx.expect(edits.filter((edit) => edit.rule === 'adunit-section').length, 'one edit per converted line').toBe(3);
        ctx.expect(findings.filter((finding) => finding.check === 'adunit-section'), 'a fully mapped unit reports nothing').toEqual([]);

        const again = applyRules(text, 'src/pages/tools/ocr.html');
        ctx.expect(again.text, 'the rewrite is idempotent').toBe(text);
      },
    },

    {
      name: 'rules: an adunit include the section cannot carry is loud, never silently dropped (#559)',
      run: (ctx) => {
        const input = [
          '{% include modules/adunits/adsense.html type="display" slot="1234567890" style="margin:0" %}',
          '{% include /modules/adunits/promo-server.html vert-id="/verts/units/test/google" vert-size="banner" %}',
        ].join('\n');
        const { text, findings } = applyRules(input, 'src/pages/blog/post.html');
        const lines = text.split('\n');
        ctx.expect(lines[0], 'the mappable args still convert').toBe('{% section "verts/unit", type: "display" %}');
        ctx.expect(lines[1], 'an adunit with no mechanical mapping is left for the hand port').toBe('{% include modules/adunits/promo-server.html vert-id="/verts/units/test/google" vert-size="banner" %}');

        const found = findings.filter((finding) => finding.check === 'adunit-section');
        ctx.expect(found.length, `one finding per line: ${JSON.stringify(findings)}`).toBe(2);
        ctx.expect(found[0].severity, 'the unit renders — the knobs that did not carry are the report').toBe('warning');
        ctx.expect(/slot/.test(found[0].message) && /style/.test(found[0].message), 'and it names them both').toBeTruthy();
        ctx.expect(found[1].severity, 'an unconverted adunit include renders NOTHING').toBe('error');
        ctx.expect(/verts\/unit/.test(found[1].message), 'and the finding names the successor section').toBeTruthy();
      },
    },

    // ---------------------------------------------------------------------------
    // Rule units — the UJM library accessor (#560)
    // ---------------------------------------------------------------------------

    {
      name: 'rules: consumer JS: a `uj()` accessor is left in place with a hand-port note (#885)',
      run: (ctx) => {
        // The UJM library bag has no OMEGA successor: its helpers are properties of
        // the web runtime instance now, so no mechanical rewrite is right.
        const input = [
          "import webManager from 'web-manager';",
          'webManager.uj().showExitPopup({ delay: 1000 });',
          'omega.uj().titleCase("hello");',
          'const lib = window.omega.uj();',
          'Manager.uj(options).thing();',
        ].join('\n');
        const { text, findings } = applyJsRules(input, 'src/assets/js/pages/tools/ocr/index.js');
        const lines = text.split('\n');
        ctx.expect(lines[1], 'only rule 13\'s singleton rename touched the line').toBe('omega.uj().showExitPopup({ delay: 1000 });');
        ctx.expect(lines[2]).toBe('omega.uj().titleCase("hello");');
        ctx.expect(!text.includes('library()'), 'no rewrite to an accessor that does not exist').toBeTruthy();

        const found = findings.filter((finding) => finding.check === 'uj-library');
        ctx.expect(found.map((finding) => finding.line), 'one note per call, whatever the receiver').toEqual([2, 3, 4, 5]);
        ctx.expect(found.every((finding) => finding.severity === 'error'), '`uj()` is a runtime TypeError, so the note is loud').toBeTruthy();
        ctx.expect(found.every((finding) => !/omega\.library/.test(finding.message)), 'the note never names the removed accessor').toBeTruthy();
        ctx.expect(found.every((finding) => /by hand/.test(finding.message) && /omega\.exitPopup\.show\(\)/.test(finding.message)), 'it says the port is by hand and where the exit popup lives').toBeTruthy();
      },
    },

    // ---------------------------------------------------------------------------
    // Rule units — bare config sections move under `config:` (#607)
    // ---------------------------------------------------------------------------

    {
      name: 'rules: a UJM page\'s bare config sections move under `config:`, and the run is idempotent (#607)',
      run: (ctx) => {
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

        ctx.expect(lines.indexOf('config:') !== -1, 'a `config:` parent is written').toBe(true);
        ctx.expect(lines.includes('  theme:'), 'theme moves one level in').toBeTruthy();
        ctx.expect(lines.includes('    nav:'), 'and its children ride along').toBeTruthy();
        ctx.expect(lines.includes('  inbound:'), 'every bare section moves, not just the first').toBeTruthy();
        ctx.expect(lines.includes('          enabled: false'), 'deep children keep their relative shape').toBeTruthy();
        ctx.expect(lines[lines.indexOf('  theme:') - 1], 'the note above a moved key rides with it').toBe('  # the shell chrome this page wanted');
        ctx.expect(lines.includes('meta:'), '`meta` is page machinery, not config — it stays put').toBeTruthy();
        ctx.expect(lines.includes('  title: "Pricing"'), 'and keeps its own children where they were').toBeTruthy();
        ctx.expect(lines[lines.length - 2], 'the body is not frontmatter').toBe('A theme: word in the body stays prose.');

        const findings = first.findings.filter((finding) => finding.check === 'config-parent');
        ctx.expect(findings.length, 'one finding per file, not per section').toBe(1);
        ctx.expect(/`theme`, `inbound`/.test(findings[0].message), 'the finding names every section it moved').toBeTruthy();

        // Idempotent: a second run over the migrated page changes nothing.
        const second = applyRules(first.text, 'pricing.md');
        ctx.expect(second.text, 'a migrated page is a fixed point').toBe(first.text);
        ctx.expect(second.findings.filter((finding) => finding.check === 'config-parent')).toEqual([]);
      },
    },

    {
      name: 'rules: a page that already has a `config:` block gains the moved sections inside it (#607)',
      run: (ctx) => {
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

        ctx.expect(lines.filter((line) => line === 'config:').length, 'one config parent, never two').toBe(1);
        ctx.expect(lines.includes('  analytics:') && lines.includes('  theme:'), 'both sections sit under it').toBeTruthy();
        ctx.expect(lines.includes('        id: "G-EXISTING"'), 'the existing block is untouched').toBeTruthy();
      },
    },

    // ---------------------------------------------------------------------------
    // Rule unit — the retired `append` flag (#607)
    // ---------------------------------------------------------------------------

    {
      name: 'rules: a page\'s `append:` flag is DROPPED, with a finding, idempotently (#607)',
      run: (ctx) => {
        const input = [
          '---',
          'layout: blueprint/index',
          'permalink: /',
          'append: true',
          'meta:',
          '  title: "Home"',
          '---',
          '',
          '## My prose',
          '',
          'A page that says append: true in its body is prose.',
          '',
        ].join('\n');

        const first = applyRules(input, 'index.md');
        const lines = first.text.split('\n');

        ctx.expect(!lines.includes('append: true'), 'the flag is gone from the frontmatter').toBeTruthy();
        ctx.expect(lines.includes('meta:') && lines.includes('  title: "Home"'), 'every other key stays exactly where it was').toBeTruthy();
        ctx.expect(lines[lines.length - 2], 'the body is not frontmatter').toBe('A page that says append: true in its body is prose.');

        const findings = first.findings.filter((finding) => finding.check === 'append-flag');
        ctx.expect(findings.length, 'one finding naming the page').toBe(1);
        ctx.expect(findings[0].message, 'the finding says what the flag used to do').toMatch(/composition/);

        const second = applyRules(first.text, 'index.md');
        ctx.expect(second.text, 'a migrated page is a fixed point').toBe(first.text);
        ctx.expect(second.findings.filter((finding) => finding.check === 'append-flag')).toEqual([]);
      },
    },

    // ---------------------------------------------------------------------------
    // Rule units — config READS move to resolved.config (#611)
    // ---------------------------------------------------------------------------

    {
      name: 'rules: `site.<section>` reads become `resolved.config.<section>`, body and frontmatter alike, idempotently (#611)',
      run: (ctx) => {
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
        ctx.expect(lines.includes('  title: "{{ resolved.config.brand.name }} · Pricing"'), 'a frontmatter read moves').toBeTruthy();
        ctx.expect(!lines.some((line) => line.includes('description:')), 'a `site.meta` read inside the page\'s OWN meta block is DROPPED — it fed itself (#671)').toBeTruthy();
        ctx.expect(lines.includes('<h1>{{ resolved.config.brand.name | upcase }}</h1>'), 'a body read moves, filters intact').toBeTruthy();
        ctx.expect(first.text, 'every config section moves, not just brand').toMatch(/\{\{ resolved\.config\.theme\.id \}\}/);
        ctx.expect(first.text, 'the OLD FLAT `resolved.<section>` path moves too — rule 1 manufactures it').toMatch(/\{\{ resolved\.config\.inbound\.chat/);
        ctx.expect(first.text, 'a read inside a tag moves').toMatch(/\{% if resolved\.config\.payment\.products %\}/);
        ctx.expect(first.text, 'and one inside a tag body').toMatch(/\{\{ resolved\.config\.company\.name \}\}/);

        // Build facts and the non-reads stay exactly as they were.
        ctx.expect(first.text, '`site.omega` is a build fact').toMatch(/\{\{ site\.omega\.date\.year \}\}/);
        ctx.expect(first.text, '…and so are the indexed collections').toMatch(/\{\{ site\.posts\.size \}\}/);
        ctx.expect(first.text, 'a composed VIEW keeps its flat spelling').toMatch(/\{\{ resolved\.pricing\.plans\.size \}\}/);
        ctx.expect(first.text, '`meta` is the page walk, not a config section — it stays flat').toMatch(/\{\{ resolved\.meta\.title \}\}/);
        ctx.expect(first.text, 'a filename is not a property read').toMatch(/href="\/site\.webmanifest"/);
        ctx.expect(first.text, 'nor is a hostname').toMatch(/subdomain\.site\.com/);

        const findings = first.findings.filter((finding) => finding.check === 'config-reads' && /rewrote config reads/.test(finding.message));
        ctx.expect(findings.length, 'one REWRITE finding per file, not per read').toBe(1);
        ctx.expect(findings[0].message, 'the finding names the lane the reads moved to').toMatch(/resolved\.config/);

        // Idempotent: a second run over the migrated page changes nothing.
        const second = applyRules(first.text, 'pricing.md');
        ctx.expect(second.text, 'a migrated page is a fixed point').toBe(first.text);
        ctx.expect(second.findings.filter((finding) => finding.check === 'config-reads')).toEqual([]);
      },
    },

    {
      name: 'rules: a page\'s own `meta:` block may not read the walk it feeds — the read is DROPPED (#671)',
      run: (ctx) => {
        const input = [
          '---',
          'layout: frontend/core/base',
          'meta:',
          '  title: "{{ site.meta.title }}"',
          '  description: "A real description"',
          '---',
          '<h1>{{ resolved.meta.title }}</h1>',
          '',
        ].join('\n');

        const { text, findings } = applyRules(input, 'src/pages/index.html');

        ctx.expect(text, 'rewritten it read the very walk this line feeds and the page shipped the literal `{{ resolved.meta.title }}` in its <title>').not.toMatch(/title: "\{\{ (site|resolved)\.meta\.title \}\}"/);
        ctx.expect(text, 'its siblings in the block stay').toMatch(/description: "A real description"/);
        ctx.expect(text, 'a BODY read of the walk is exactly right — only the block that FEEDS it may not read it').toMatch(/<h1>\{\{ resolved\.meta\.title \}\}<\/h1>/);
        ctx.expect(findings.some((finding) => finding.check === 'config-reads' && /meta/.test(finding.message) && finding.line === 4), `the drop is named at its line, never silent: ${findings.map((f) => f.message).join(' | ')}`).toBeTruthy();
      },
    },

    {
      name: 'rules: an ALREADY-rewritten self-reference is repaired, and an emptied `meta:` block goes with it (#671)',
      run: (ctx) => {
        // What 0.46.0 shipped on itw-creative-works: rule 24 had rewritten the read
        // to `resolved.meta.title`, which is the same self-reference wearing the new
        // spelling. Re-running migrate has to fix it, not call the page migrated.
        const input = [
          '---',
          'layout: frontend/core/base',
          'meta:',
          '  title: "{{ resolved.meta.title }}"',
          'permalink: /',
          '---',
          'Body',
          '',
        ].join('\n');

        const { text } = applyRules(input, 'src/pages/index.html');
        const lines = text.split('\n');

        ctx.expect(!lines.some((line) => line.includes('resolved.meta.title')), 'the self-reference is gone').toBeTruthy();
        ctx.expect(!lines.some((line) => line.trim() === 'meta:'), 'and the block it emptied goes with it — a bare `meta:` is a null key').toBeTruthy();
        ctx.expect(lines.includes('permalink: /'), 'the rest of the frontmatter is untouched').toBeTruthy();
        ctx.expect(applyRules(text, 'src/pages/index.html').text, 'and the repaired page is a fixed point').toBe(text);
      },
    },

    {
      name: 'rules: a self-reference drop is an EDIT, so the repair reaches the disk (#671)',
      run: (ctx) => {
        // The repair page: nothing else on it moves, so the drop is the whole change.
        // Reported as a finding alone it never reached codemod.js's write — the run
        // printed "dropped title" over a byte-identical file.
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-selfmeta-'));
        try {
          fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
          const page = path.join(root, 'src', 'pages', 'index.html');
          const input = [
            '---',
            'meta:',
            '  title: "{{ resolved.meta.title }}"',
            'permalink: /',
            '---',
            'Body',
            '',
          ].join('\n');
          fs.writeFileSync(page, input);

          const { text, edits } = applyRules(input, 'src/pages/index.html');
          ctx.expect(edits.length > 0, 'the dropped line is an edit like any other rewrite — the report counts what it changed').toBeTruthy();
          ctx.expect(text, '…and the text really did change').not.toBe(input);

          const result = runCodemod(root, { execute: true });
          ctx.expect(fs.readFileSync(page, 'utf8'), 'the repair is WRITTEN, not just announced').not.toMatch(/resolved\.meta\.title/);
          ctx.expect(result.files.some((file) => file.path === path.join('src', 'pages', 'index.html')), `…and the file is listed among the edited ones: ${result.files.map((f) => f.path).join(', ')}`).toBeTruthy();
          ctx.expect(result.totalEdits > 0, '…and counted').toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'rules: an emptied NESTED key goes too — a childless `og:` is a null that REPLACES (#671)',
      run: (ctx) => {
        const input = [
          '---',
          'meta:',
          '  title: "Real title"',
          '  og:',
          '    image: "{{ resolved.meta.og.image }}"',
          'permalink: /',
          '---',
          'Body',
          '',
        ].join('\n');

        const { text } = applyRules(input, 'src/pages/index.html');
        const lines = text.split('\n');

        ctx.expect(!lines.some((line) => line.includes('resolved.meta.og.image')), 'the self-reference is gone').toBeTruthy();
        ctx.expect(!lines.some((line) => line.trim() === 'og:'), 'and the key it emptied with it — a childless `og:` is YAML null, and deepMerge lets null REPLACE the config og defaults').toBeTruthy();
        ctx.expect(lines.includes('  title: "Real title"'), 'its sibling under the same `meta:` stays, so the block itself survives').toBeTruthy();
        ctx.expect(lines.includes('permalink: /'), 'and the rest of the frontmatter is untouched').toBeTruthy();
      },
    },

    {
      name: 'rules: the MULTI-LINE flow spelling of `meta:` is read like the block form (#671)',
      run: (ctx) => {
        const input = [
          '---',
          'meta: {',
          '  title: "{{ site.meta.title }}",',
          '  description: "A real description"',
          '  }',
          'permalink: /',
          '---',
          'Body',
          '',
        ].join('\n');

        const { text, findings } = applyRules(input, 'src/pages/index.html');

        ctx.expect(text, 'a flow mapping spread over lines is the same self-reference, and legal YAML').not.toMatch(/site\.meta\.title/);
        ctx.expect(text, 'its sibling pair survives').toMatch(/description: "A real description"/);
        ctx.expect(findings.some((finding) => finding.check === 'config-reads' && finding.line === 3 && /dropped/.test(finding.message)), `the drop is named at its own line: ${findings.map((f) => f.message).join(' | ')}`).toBeTruthy();
        ctx.expect(applyRules(text, 'src/pages/index.html').text, 'and the result is a fixed point').toBe(text);
      },
    },

    {
      name: 'rules: the one-line flow spelling drops the self-read and keeps the rest (#671)',
      run: (ctx) => {
        const input = [
          '---',
          'meta: { title: "{{ site.meta.title }}", description: "A real description" }',
          '---',
          'Body',
          '',
        ].join('\n');

        const { text } = applyRules(input, 'src/pages/index.html');
        ctx.expect(text, 'the surviving pair keeps the mapping — only the self-read leaves it').toMatch(/^meta: \{ description: "A real description" \}$/m);
      },
    },

    {
      name: 'rules: the analytics spelling normalizes BEFORE the read moves (#611)',
      run: (ctx) => {
        // Rule 9 answers to `site.analytics.<provider>`; running the read move first
        // would rename the root out from under it and leave the flat spelling.
        const { text } = applyRules('{{ site.analytics.google }}', 'unit.html');
        ctx.expect(text).toBe('{{ resolved.config.analytics.providers.google.id }}');
      },
    },

    {
      name: 'rules: code DISPLAY is not markup — fences and {% raw %} keep the old spelling (#611 F3)',
      run: (ctx) => {
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

        ctx.expect(lines[3], 'a fenced sample is display copy').toBe('{{ site.brand.name }}');
        ctx.expect(lines[7], 'the tilde fence counts too').toBe('{{ site.theme.id }}');
        ctx.expect(lines[10], 'so does the raw escape hatch').toBe('{% raw %}{{ site.inbound.chat.providers.chatsy.enabled }}{% endraw %}');
        ctx.expect(lines[12], 'markup outside them still migrates').toBe('And this one is a real read: {{ resolved.config.brand.name }}');
        ctx.expect(edits.filter((edit) => edit.rule === 'config-reads').length, 'one edit — the one real read').toBe(1);
      },
    },

    {
      name: 'rules: a read is a LIQUID read — a hostname is left alone (#611 F4)',
      run: (ctx) => {
        const input = [
          'Read more at https://site.company.com/x and at site.marketing.example.com.',
          '<img src="/site.webmanifest" alt="{{ site.brand.name }}">',
          'Visit https://site.company.com — {{ site.company.name }} runs it.',
          '',
        ].join('\n');

        const { text } = applyRules(input, 'src/pages/index.md');
        const lines = text.split('\n');

        ctx.expect(lines[0], 'a hostname is not a read').toBe('Read more at https://site.company.com/x and at site.marketing.example.com.');
        ctx.expect(lines[1], 'a filename is not a read, and the read beside it still moves').toBe('<img src="/site.webmanifest" alt="{{ resolved.config.brand.name }}">');
        ctx.expect(lines[2], 'both on ONE line: the hostname stays, the read moves').toBe('Visit https://site.company.com — {{ resolved.config.company.name }} runs it.');
      },
    },

    {
      name: 'rules: a section descriptor\'s reads move too — the bindings are DATA (#611)',
      run: (ctx) => {
        const { text, edits } = applyJsonRules('{ logo: { text: \'{{ site.brand.name }}\' } }', 'src/_includes/frontend/sections/nav.json');
        ctx.expect(text, 'a descriptor emits the same empty string a template would').toBe('{ logo: { text: \'{{ resolved.config.brand.name }}\' } }');
        ctx.expect(edits.length).toBe(1);
      },
    },

    // ---------------------------------------------------------------------------
    // Rule units — the UJM `random_id` global (#595)
    // ---------------------------------------------------------------------------

    {
      name: 'rules: a bare `random_id` read gets the assign UJM handed it for free (#595)',
      run: (ctx) => {
        const input = [
          '---',
          'layout: frontend/core/base',
          '---',
          '<div class="accordion" id="tool-faq-{{ random_id }}">',
          '  <button data-bs-target="#tool-faq-{{ random_id }}-1">One</button>',
          '</div>',
          '',
        ].join('\n');

        const first = applyRules(input, 'src/pages/tools/index.html');
        const lines = first.text.split('\n');

        ctx.expect(lines[3], 'the assign opens the BODY, under the frontmatter fence').toBe('{% assign random_id = 100 | omega_random %}');
        ctx.expect(first.text, 'every read keeps its spelling — the variable exists now').toMatch(/id="tool-faq-\{\{ random_id \}\}"/);
        ctx.expect(first.edits.some((edit) => edit.rule === 'random-id'), 'the insert is reported like any other edit').toBeTruthy();
        ctx.expect(first.findings.some((finding) => finding.check === 'random-id' && /omega_random/.test(finding.message)), `the finding names the idiom that replaced the global: ${first.findings.map((f) => f.message).join(' | ')}`).toBeTruthy();

        const second = applyRules(first.text, 'src/pages/tools/index.html');
        ctx.expect(second.text, 'a migrated file is a fixed point — the assign is the marker').toBe(first.text);
      },
    },

    {
      name: 'rules: an include has no frontmatter, and a dotted `random_id` is not the global (#595)',
      run: (ctx) => {
        const include = applyRules('<div id="faq-{{ random_id }}"></div>\n', 'src/_includes/tool-faq.html');
        ctx.expect(include.text.split('\n')[0], 'with no fence to clear, the assign is line 1 — an include renders per call, which is what the UJM global meant').toBe('{% assign random_id = 100 | omega_random %}');

        const property = applyRules('<div id="{{ block.random_id }}"></div>\n', 'src/_includes/other.html');
        ctx.expect(property.text, 'a property of somebody else\'s object is not the global').toBe('<div id="{{ block.random_id }}"></div>\n');

        const prose = applyRules('The UJM global was called random_id.\n', 'src/pages/notes.md');
        ctx.expect(prose.text, 'and prose about it is not a read (#521)').toBe('The UJM global was called random_id.\n');
      },
    },

    // ---------------------------------------------------------------------------
    // Rule units — the legacy classy gradient utilities (#296)
    // ---------------------------------------------------------------------------

    {
      name: 'rules: the legacy gradient utilities become the v2 dotgrid hero (#296)',
      run: (ctx) => {
        const input = [
          '<section class="bg-gradient-rainbow gradient-animated gradient-grain text-light min-vh-80">',
          '<div class="gradient-grain p-4">',
          '<section class="gradient-animated" data-omega-dotfield>',
          '<div class="gradient-animated-slow gradient-grainy x-gradient-grain">',
          '<section class="{% if a %}gradient-grain{% else %}gradient-animated{% endif %}">',
        ].join('\n');
        const { text, edits } = applyRules(input, 'unit.html');
        const lines = text.split('\n');
        ctx.expect(lines[0], 'both utilities on one element collapse to ONE dotgrid, and the animated half opts into the live dotfield').toBe('<section class="bg-gradient-rainbow omega-dotgrid text-light min-vh-80" data-omega-dotfield>');
        ctx.expect(lines[1], 'the static half is the dot grid alone — no motion it never had').toBe('<div class="omega-dotgrid p-4">');
        ctx.expect(lines[2], 'an element already opted in keeps ONE attribute').toBe('<section class="omega-dotgrid" data-omega-dotfield>');
        ctx.expect(lines[3], 'longer and prefixed names are DIFFERENT classes').toBe('<div class="gradient-animated-slow gradient-grainy x-gradient-grain">');
        ctx.expect(lines[4], 'a Liquid-built class list keeps every branch — a "duplicate" there is the ONLY class one branch emits').toBe('<section class="{% if a %}omega-dotgrid{% else %}omega-dotgrid{% endif %}" data-omega-dotfield>');
        ctx.expect(edits.length, 'one edit recorded per changed line').toBe(4);
      },
    },

    {
      name: 'rules: a real UJM hero converts to a treatment classy v2 actually ships (#296)',
      run: (ctx) => {
        const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'ports-site', 'pages', 'index.html'), 'utf8');
        ctx.expect(fixture, 'the fixture hero carries the legacy pair').toMatch(/gradient-animated/);
        ctx.expect(fixture, 'both of them').toMatch(/gradient-grain/);

        const { text } = applyRules(fixture, 'src/pages/index.html');
        ctx.expect(!/gradient-animated|gradient-grain/.test(text), 'no legacy gradient utility survives the page').toBeTruthy();
        const hero = text.split('\n').find((line) => line.includes('omega-dotgrid'));
        ctx.expect(hero, 'the hero wears the dotgrid; bg-gradient-rainbow stays (v2 still neutralizes that name)').toMatch(/class="bg-gradient-rainbow omega-dotgrid /);
        ctx.expect(hero, 'and the live dotfield the animation became').toMatch(/" data-omega-dotfield>/);
        ctx.expect((text.match(/omega-dotgrid/g) || []).length, 'the pair collapsed, it did not double').toBe(1);

        // The other half of "renders with the v2 treatment": classy v2 paints the
        // class the codemod writes, and paints neither class it rewrote.
        const css = sass.compile(path.join(PKG, 'themes', 'classy', 'css', 'base', '_utilities.scss'), {
          logger: { warn: () => {}, debug: () => {} },
        }).css;
        ctx.expect(css, 'classy v2 ships the masked dot backdrop the hero now wears').toMatch(/\.omega-dotgrid::before/);
        ctx.expect(!/gradient-animated|gradient-grain/.test(css), 'and ships neither legacy utility — the reason they convert (#296)').toBeTruthy();
      },
    },

    // ---------------------------------------------------------------------------
    // Rule units — the UJM → OMEGA section-arg renames (#545)
    // ---------------------------------------------------------------------------

    {
      name: 'rules: the renamed section args migrate to their OMEGA spellings (#545)',
      run: (ctx) => {
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
        ctx.expect(lines.slice(2, 5), 'the eyebrow becomes the badge object OMEGA renders, its read moved with it (#611)').toEqual([
          'hero:',
          '  badge:',
          '    text: "Introducing {{ resolved.config.brand.name }}"',
        ]);
        ctx.expect(lines[5], 'the rest of the block is untouched').toBe('  headline: "The #1 platform"');
        ctx.expect(lines.includes('      button:'), 'the demo\'s own button is a DIFFERENT arg, three levels down').toBeTruthy();
        ctx.expect(lines.includes('    - tagline: "best for individuals"'), 'a pricing plan\'s tagline is not the hero\'s').toBeTruthy();
        ctx.expect(lines.slice(-6, -2), 'the CTA copy and button keep their content under the new names').toEqual([
          'cta:',
          '  subheadline: "Join thousands of teams"',
          '  primary_button:',
          '    text: "Start today"',
        ]);
        ctx.expect(lines[lines.length - 1], 'the body is prose').toBe('Prose mentioning tagline: and description: is not a section arg.');
        ctx.expect(edits.filter((edit) => edit.rule === 'section-args').length, 'one edit per renamed key').toBe(3);
      },
    },

    {
      name: 'rules: a hero already carrying the legacy badge object is reported, never given two (#545)',
      run: (ctx) => {
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
        ctx.expect(text, 'the tagline stays a tagline and the badge stays a badge').toBe(input.replace('{{ site.brand.name }}', '{{ resolved.config.brand.name }}'));
        const found = findings.filter((finding) => finding.check === 'section-args');
        ctx.expect(found.length, `one finding: ${JSON.stringify(findings)}`).toBe(1);
        ctx.expect(found[0].line, 'pointing at the tagline').toBe(3);
        ctx.expect(found[0].severity, 'the merge is a hand-port').toBe('error');
        ctx.expect(/badge\.text/.test(found[0].message), 'and it names the target spelling').toBeTruthy();
      },
    },

    // ---------------------------------------------------------------------------
    // Rule units — the hero's silently-dropped secondary button (#579)
    // ---------------------------------------------------------------------------

    {
      name: 'rules: a migrated hero secondary button is switched ON, and the report says so (#579)',
      run: (ctx) => {
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
        ctx.expect(lines.slice(7, 12), 'the hero section defaults the button OFF — an authored one says so out loud').toEqual([
          '  secondary_button:',
          '    enabled: true',
          '    text: "View proxy list"',
          '    icon: "list"',
          '    href: "/tools/proxy-list"',
        ]);
        ctx.expect(lines.slice(12, 15), 'the CTA band renders any button it is given — not this rule\'s business').toEqual([
          'cta:',
          '  secondary_button:',
          '    text: "View documentation"',
        ]);
        ctx.expect(edits.filter((edit) => edit.rule === 'hero-secondary-button').length, 'one edit').toBe(1);

        const found = findings.filter((finding) => finding.check === 'hero-secondary-button');
        ctx.expect(found.length, `the report warns when it flips the switch: ${JSON.stringify(findings)}`).toBe(1);
        ctx.expect(found[0].severity).toBe('warning');
        ctx.expect(/enabled: true/.test(found[0].message), 'and names what it wrote').toBeTruthy();

        const again = applyRules(text, 'src/pages/solutions/web-scraping.md');
        ctx.expect(again.text, 'the rewrite is idempotent').toBe(text);
        ctx.expect(again.findings.filter((finding) => finding.check === 'hero-secondary-button'), 'and reports nothing the second time').toEqual([]);
      },
    },

    {
      name: 'rules: a hero that already answered the enabled question keeps its answer (#579)',
      run: (ctx) => {
        const input = [
          '---',
          'hero:',
          '  secondary_button:',
          '    enabled: false',
          '    text: "See pricing"',
          '---',
        ].join('\n');
        const { text, findings } = applyRules(input, 'src/pages/index.md');
        ctx.expect(text, 'an authored `enabled: false` is the author\'s intent, not a default').toBe(input);
        ctx.expect(findings.filter((finding) => finding.check === 'hero-secondary-button')).toEqual([]);
      },
    },

    {
      name: 'rules: a sibling block\'s `enabled` is not the button\'s answer (#579)',
      run: (ctx) => {
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
        ctx.expect(text.split('\n').slice(2, 4), 'the block ends at its first sibling — `frame.enabled` answers for the frame').toEqual([
          '  secondary_button:',
          '    enabled: true',
        ]);
      },
    },

    {
      name: 'semantic: hoisted tag arg renders identically to a literal quoted arg',
      run: async (ctx) => {
        const engine = realEngine();
        const { text } = applyRules('{% omega_logo "{{ stat.icon }}-mark" %}', 'semantic.html');
        const rewritten = await engine.parseAndRender(text, { stat: { icon: 'star' } });
        const literal = await engine.parseAndRender('{% omega_logo "star-mark" %}', {});
        ctx.expect(rewritten.trim(), 'capture hoist ≡ literal arg (the upstream silent no-op is fixed forward)').toBe(literal.trim());
        ctx.expect(rewritten.includes('data-omega-icon-missing="logo:star-mark"'), 'interpolation actually happened').toBeTruthy();
      },
    },

    {
      name: 'semantic: parentloop hoist renders the outer-loop values',
      run: async (ctx) => {
        const engine = realEngine();
        const input = [
          '{% for group in groups %}',
          '{% for item in group.items %}',
          '[{{ forloop.parentloop.index }}.{{ forloop.index }}:{{ item }}]',
          '{% endfor %}',
          '{% endfor %}',
        ].join('\n');
        const { text } = applyRules(input, 'semantic.html');
        ctx.expect(!text.includes('forloop.parentloop'), 'no parentloop refs remain').toBeTruthy();
        const output = await engine.parseAndRender(text, {
          groups: [{ items: ['a', 'b'] }, { items: ['c'] }],
        });
        const compact = output.replace(/\s+/g, '');
        ctx.expect(compact, 'outer indexes correct per iteration').toBe('[1.1:a][1.2:b][2.1:c]');
      },
    },

    {
      name: 'rules: parentloop sharing a line with loop opens is flagged, never mis-hoisted',
      run: (ctx) => {
        const input = [
          '{% for a in x %}{% for b in y %}',
          '{{ forloop.parentloop.index }}',
          '{% endfor %}{% endfor %}',
        ].join('\n');
        const { text, findings } = applyRules(input, 'unit.html');
        ctx.expect(text.includes('forloop.parentloop.index'), 'ambiguous ref left untouched').toBeTruthy();
        ctx.expect(findings.some((finding) => finding.check === 'parentloop' && finding.severity === 'error'), 'flagged for manual hoist').toBeTruthy();
      },
    },

    {
      name: 'rules: the dead `asset_path` frontmatter key is named, with the successor idiom',
      run: (ctx) => {
        const input = [
          '---',
          'layout: page',
          'asset_path: dashboard/agents/edit',
          '---',
          'A page mentioning asset_path: in prose is not a frontmatter key.',
        ].join('\n');
        const { text, findings } = applyRules(input, 'src/pages/dashboard/agents/new.md');
        ctx.expect(text, 'the key is reported, never rewritten — the port is by hand').toBe(input);
        const found = findings.filter((finding) => finding.check === 'asset-path');
        ctx.expect(found.length, `one finding, on the frontmatter key only: ${JSON.stringify(findings)}`).toBe(1);
        ctx.expect(found[0].line, 'the finding points at the key line').toBe(3);
        ctx.expect(found[0].severity, 'a dead key needs a manual port').toBe('error');
        ctx.expect(/asset_path/.test(found[0].message), 'the message names the key').toBeTruthy();
        ctx.expect(/\[slug\]\.js/.test(found[0].message), 'the message names the [name] wildcard family file').toBeTruthy();
        ctx.expect(/index\.js/.test(found[0].message) && /@use/.test(found[0].message), 'the message points at the re-export + @use idiom').toBeTruthy();
        ctx.expect(found[0].message.indexOf('[slug]') < found[0].message.indexOf('export { default }'), 'the wildcard family comes FIRST, the one-off re-export second (#470)').toBeTruthy();
      },
    },

    // ---------------------------------------------------------------------------
    // Lint
    // ---------------------------------------------------------------------------

    {
      name: 'lint: Jekyll-only tags error, unknown filters warn, known names pass',
      run: (ctx) => {
        const findings = lintText([
          '{% post_url 2020-01-01-hello %}',
          '{% assign related = site.posts | where_exp: "p", "p.url" | limit: 3 %}',
          '{% omega_logo "star" %} {{ title | omega_title_case | markdownify }}',
          '{% iftruthy site.brand %}x{% endiftruthy %}',
        ].join('\n'), 'lint.html');
        ctx.expect(findings.some((finding) => finding.check === 'jekyll-only-tag' && finding.line === 1), 'post_url flagged').toBeTruthy();
        ctx.expect(findings.some((finding) => finding.check === 'unknown-filter' && finding.message.includes('limit')), 'limit flagged (Jekyll never had it either)').toBeTruthy();
        ctx.expect(findings.filter((finding) => finding.line >= 3).length, 'template-kit tags/filters + block ends all known').toBe(0);
      },
    },

    {
      name: 'lint: #489 the framework\'s own tags are known — a converted tree lints clean',
      run: (ctx) => {
        // `omega migrate`'s report on a fully-converted website had 71 warnings
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

        ctx.expect(findings, 'the lane\'s own output is not a finding').toEqual([]);
      },
    },

    {
      name: 'lint: raw and comment spans are inert',
      run: (ctx) => {
        const findings = lintText('{% raw %}{% post_url x %}{% endraw %}{% comment %}{{ x | limit }}{% endcomment %}', 'lint.html');
        ctx.expect(findings.length).toBe(0);
      },
    },

    // ---------------------------------------------------------------------------
    // Config conversion
    // ---------------------------------------------------------------------------

    {
      name: 'config: shared sections extracted with unified spellings',
      run: (ctx) => {
        const { omega, notes } = convertConfig({ jekyll: structuredClone(LEGACY_JEKYLL), ujm: structuredClone(LEGACY_UJM) });

        ctx.expect(omega.brand.url, 'url folded into brand').toBe('https://sample.test');
        ctx.expect(omega.baseurl, 'empty baseurl dropped').toBe(undefined);
        ctx.expect(omega.analytics, 'flat analytics → providers; empty provider dropped').toEqual({ providers: { google: { id: 'G-TEST123' }, tiktok: { id: 'TIKTOK1' } } });
        ctx.expect(omega.cloud.provider, 'cloud role gets its provider discriminator').toBe('firebase');
        ctx.expect(omega.cloud.config.apiKey, 'firebase app config extracted').toBe('AIza-TEST');
        ctx.expect(omega.payment.providers.chargebee.site).toBe('sample');
        ctx.expect(omega.payment.providers.stripe.publishableKey, 'publishableKey: false dropped').toBe(undefined);
        ctx.expect(omega.connections.discord.enabled, 'the legacy `oauth2` section lands as `connections` (#788)').toBe(true);
        ctx.expect(omega.oauth2, 'and the legacy name never survives').toBe(undefined);

        const web = omega.targets.web;
        ctx.expect(web.web_manager, 'the legacy key name does not survive the conversion (#1)').toBe(undefined);
        ctx.expect(web.client.payment, 'payment moved out of the client blob').toBe(undefined);
        ctx.expect(web.client.firebase.app.config, 'firebase config moved out').toBe(undefined);
        ctx.expect(web.client.firebase.app.enabled, 'client firebase toggles stay').toBe(true);
        ctx.expect(web.client.sentry, 'sentry moved out of the client blob to its schema home (#485)').toBe(undefined);

        // cookieConsent → consent (#383). Carrying the old NAME would emit a config
        // that fails the retired-key guard, and carrying its settings would emit keys
        // the rebuilt banner does not read: the panel paints from the --omega-*
        // tokens, the visitor's region picks opt-in vs opt-out, and "I Understand" is
        // not an Accept.
        ctx.expect(web.client.cookieConsent, 'the retired block name does not survive').toBe(undefined);
        ctx.expect(web.client.consent, 'enabled + position are what carries').toEqual({ enabled: true, config: { position: 'bottom-right' } });
        ctx.expect(notes.some((note) => note.includes('cookieConsent') && note.includes('client.consent')), 'the drop is announced, not silent').toBeTruthy();
        ctx.expect(web.purgecss.safelist.standard, 'a UJM json build setting the schema declares is carried').toEqual(['keep-me']);

        // The schema is strict: what no omega.json5 key reads is dropped, one note per path
        for (const [dropped, note] of [
          [web.permalink, '`targets.web.permalink` dropped'],
          [web.defaults, '`targets.web.defaults` dropped'],
          [web.distribute, '`targets.web.distribute.input` dropped'],
          [web.workflows, '`targets.web.workflows.build.schedule` dropped'],
          [omega.theme.nav, '`theme.nav.enabled` dropped'],
        ]) {
          ctx.expect(dropped, note).toBe(undefined);
          ctx.expect(notes.some((entry) => entry.startsWith(note) && entry.includes('by hand')), `announced: ${note}`).toBeTruthy();
        }
        ctx.expect(omega.webpack, 'webpack dropped').toBe(undefined);

        ctx.expect(notes.some((note) => note.includes('gems')), 'non-empty gems noted').toBeTruthy();
        ctx.expect(notes.some((note) => note.includes('webpack.target')), 'webpack target noted').toBeTruthy();
        ctx.expect(notes.some((note) => note.includes('plugins')), 'Jekyll machinery drop noted').toBeTruthy();
        ctx.expect(notes.some((note) => note.includes('collections')), 'collections drop noted').toBeTruthy();
      },
    },

    {
      name: 'config: a legacy Jekyll collection is DROPPED with the manual step named (#589)',
      run: (ctx) => {
        const { omega, notes } = convertConfig({ jekyll: structuredClone(LEGACY_JEKYLL), ujm: null });

        ctx.expect(omega.targets.web.collections, 'carried verbatim it wrote a config whose FIRST build dies in readCollections — no Jekyll collection has a `field`').toBe(undefined);

        const note = notes.find((entry) => entry.includes('targets.web.collections.recipes'));
        ctx.expect(note, `the drop names the collection and its new home: ${notes.join(' | ')}`).toBeTruthy();
        ctx.expect(note, '…and the manual step is the `field` the converter cannot derive').toMatch(/field/);
      },
    },

    {
      name: 'config: the ARRAY form of Jekyll collections names the collection too (#589)',
      run: (ctx) => {
        // `collections: [recipes, docs]` is documented Jekyll shorthand for the
        // mapping form — the note has to name what the site called it.
        const jekyll = { ...structuredClone(LEGACY_JEKYLL), collections: ['recipes', 'docs'] };
        const { notes } = convertConfig({ jekyll, ujm: null });

        for (const name of ['recipes', 'docs']) {
          const note = notes.find((entry) => entry.includes(`targets.web.collections.${name}`));
          ctx.expect(note, `each collection is named by its own name, never by its index: ${notes.join(' | ')}`).toBeTruthy();
          ctx.expect(note, '…and so is the directory its documents move to').toMatch(new RegExp(`src/_${name}/`));
        }
      },
    },

    {
      name: 'config: the retired adsense gates are DROPPED with the note (#628)',
      run: (ctx) => {
        // #527 collapsed adsense to ONE switch, the `client` id. Carried through
        // verbatim, a legacy `enabled: false` emitted a config the manager no longer
        // honors — the account it was meant to leave alone starts being managed off
        // the ca-pub- id beside it, and the gate still reads like it works.
        const jekyll = structuredClone(LEGACY_JEKYLL);
        jekyll.advertising = {
          'google-adsense': {
            client: 'ca-pub-1234567890123456',
            enabled: false,
            units: false,
            'display-slot': '9023354299',
          },
        };

        const { omega, notes } = convertConfig({ jekyll, ujm: null });

        ctx.expect(omega.advertising, 'the id and its slots carry; the two retired gates do not').toEqual({ providers: { adsense: { client: 'ca-pub-1234567890123456', displaySlot: '9023354299' } } });

        for (const key of ['enabled', 'units']) {
          const note = notes.find((entry) => entry.includes(`advertising.providers.adsense.${key}`));
          ctx.expect(note, `the drop is announced, not silent: ${notes.join(' | ')}`).toBeTruthy();
          ctx.expect(note, '…and names the ruling that deleted the gate').toMatch(/#527/);
        }
      },
    },

    {
      name: 'config: the four schema-less web sections retire on the way in (#850)',
      run: (ctx) => {
        // Three are DROPPED with a note (nothing answers them with config any more)
        // and `currency` MOVES into the payment section, so a converted brand never
        // carries a key its own validator refuses.
        const jekyll = structuredClone(LEGACY_JEKYLL);
        jekyll.favicon = { path: 'https://cdn.sample.test/favicon', 'theme-color': '#ffffff' };
        jekyll.manifest = { name: 'Sample' };
        jekyll.icons = { style: 'solid' };
        jekyll.currency = 'EUR';

        const { omega, notes } = convertConfig({ jekyll, ujm: null });

        for (const key of ['favicon', 'manifest', 'icons', 'currency']) {
          ctx.expect(omega.targets.web[key], `targets.web.${key} is a retired path, so nothing writes it`).toBe(undefined);
          ctx.expect(omega[key], `${key} never lands at the root either`).toBe(undefined);
          const note = notes.find((entry) => entry.includes(`\`${key}\``) && entry.includes('#850'));
          ctx.expect(note, `the move is announced, not silent: ${notes.join(' | ')}`).toBeTruthy();
        }

        ctx.expect(omega.payment.currency, 'the currency lands beside the providers that charge in it').toBe('EUR');
      },
    },

    {
      name: 'config: a gates-ONLY adsense block converts to no advertising section (#628)',
      run: (ctx) => {
        // The note itself says "omit the block to serve no ads": a legacy block whose
        // whole content was the two retired gates converts to nothing at all, not to
        // an empty `adsense: {}` that reads as an authored opt-in to the managed
        // account. The drop is still announced.
        const jekyll = structuredClone(LEGACY_JEKYLL);
        jekyll.advertising = { 'google-adsense': { enabled: false, units: false } };

        const { omega, notes } = convertConfig({ jekyll, ujm: null });

        ctx.expect(omega.advertising, 'the emptied block is pruned, section and all').toBe(undefined);

        for (const key of ['enabled', 'units']) {
          const note = notes.find((entry) => entry.includes(`advertising.providers.adsense.${key}`));
          ctx.expect(note, `the drop is still announced, not silent: ${notes.join(' | ')}`).toBeTruthy();
        }
      },
    },

    {
      name: 'config: an adsense block that arrived EMPTY is kept (#628)',
      run: (ctx) => {
        // Nothing was dropped, so nothing is pruned — an authored empty block is the
        // brand opting the provider in and configuring the id later.
        const jekyll = structuredClone(LEGACY_JEKYLL);
        jekyll.advertising = { 'google-adsense': {} };

        const { omega } = convertConfig({ jekyll, ujm: null });

        ctx.expect(omega.advertising, 'an authored opt-in carries').toEqual({ providers: { adsense: {} } });
      },
    },

    {
      name: 'config: socials lands at the ROOT, its schema home (#483)',
      run: (ctx) => {
        const { omega } = convertConfig({ jekyll: structuredClone(LEGACY_JEKYLL), ujm: null });

        ctx.expect(omega.socials, 'socials is a SHARED_SCHEMA root key — the scaffold emits it there').toEqual({ twitter: 'sample' });
        ctx.expect(omega.targets.web.socials, 'and it never rides the web target as well').toBe(undefined);
      },
    },

    {
      name: 'config: translation lands at the ROOT, its schema home (#526)',
      run: (ctx) => {
        const { omega, notes } = convertConfig({ jekyll: structuredClone(LEGACY_JEKYLL), ujm: null });

        ctx.expect(omega.translation, 'translation is a SHARED_SECTIONS key: disperse copies it from the root to every target').toEqual({ languages: ['es'], include: ['**', '!account'] });
        ctx.expect(omega.targets.web.translation, 'and it never rides the web target as well').toBe(undefined);

        // #858: the legacy route list said what to SKIP, and that key is retired, so
        // carrying it through would emit a config the validator refuses. It converts
        // on the way out, translating exactly what the brand was translating before.
        ctx.expect(notes.some((note) => /translation\.exclude/.test(note) && /translation\.include/.test(note)), 'the conversion is a note, not a silent rewrite').toBeTruthy();
      },
    },

    {
      name: 'config: web_manager.sentry becomes monitoring.providers.sentry (#485)',
      run: (ctx) => {
        const { omega, notes } = convertConfig({ jekyll: structuredClone(LEGACY_JEKYLL), ujm: null });

        ctx.expect(omega.monitoring, 'the SDK knobs land under the provider — the home the manager\'s monitoring service reads').toEqual({
          enabled: true,
          providers: {
            sentry: { dsn: 'https://x@sentry.io/1', replaysSessionSampleRate: 0.01, replaysOnErrorSampleRate: 0.01 },
          },
        });
        ctx.expect(omega.targets.web.client.sentry, 'and the client blob keeps no stale copy to win over it').toBe(undefined);
        ctx.expect(notes.some((note) => note.includes('monitoring.providers.sentry')), 'the move is announced, not silent').toBeTruthy();
      },
    },

    {
      name: 'config: a legacy-disabled sentry block that still carries a DSN is called out (#485)',
      run: (ctx) => {
        const jekyll = structuredClone(LEGACY_JEKYLL);
        jekyll.web_manager.sentry.enabled = false;

        const { omega, notes } = convertConfig({ jekyll, ujm: null });

        ctx.expect(omega.monitoring.enabled, 'the legacy flag carries to the role-level switch').toBe(false);
        ctx.expect(omega.monitoring.providers.sentry.dsn, 'and the DSN is never silently dropped').toBe('https://x@sentry.io/1');
        ctx.expect(notes.some((note) => note.includes('RUNTIME switch')), 'the operator is told the two flags do not mean the same thing').toBeTruthy();
      },
    },

    {
      name: 'config: converted output passes the real loader for target web',
      run: (ctx) => {
        const { omega } = convertConfig({ jekyll: structuredClone(LEGACY_JEKYLL), ujm: structuredClone(LEGACY_UJM) });
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-config-'));
        try {
          fs.mkdirSync(path.join(tmp, 'config'));
          fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), serializeOmega(omega));
          const { config, errors, enabled } = loadConfig(tmp, 'web');
          ctx.expect(errors, 'no schema findings').toEqual([]);
          ctx.expect(enabled, 'web target enabled by key presence').toBe(true);
          ctx.expect(config.client.auth.enabled, 'targets.web overlays the top level').toBe(true);
          ctx.expect(config.brand.tagline, 'Liquid-bearing values survive').toBe('Sample - {{ site.brand.name }}');
          // The legacy title/description half is NOT carried (#607): the validator
          // refuses those. What resolves here is the schema's own site-wide index
          // default, `targets.web.meta.index` (#564), which no legacy config had.
          ctx.expect(config.meta, 'only the site-wide index default resolves under `meta`').toEqual({ index: true });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },

    // ---------------------------------------------------------------------------
    // End-to-end migration of a synthetic UJM consumer
    // ---------------------------------------------------------------------------

    {
      name: 'e2e: report mode reports everything and writes NOTHING',
      run: (ctx) => {
        const root = stageLegacyConsumer();
        try {
          const report = runMigration(root);
          ctx.expect(report.execute, 'report mode is the default').toBe(false);
          ctx.expect(report.codemod.totalEdits >= 4, 'edits previewed').toBeTruthy();
          ctx.expect(report.removed.length, 'legacy files + seed main.js listed').toBe(5);
          ctx.expect(fs.existsSync(path.join(root, 'src', 'assets', 'js', 'main.js')), 'seed main.js untouched in report mode').toBeTruthy();
          ctx.expect(report.lint.some((finding) => finding.check === 'jekyll-only-tag'), 'post_url flagged').toBeTruthy();
          ctx.expect(!fs.existsSync(path.join(root, 'config', 'omega.json5')), 'no config written').toBeTruthy();
          ctx.expect(fs.existsSync(path.join(root, 'Gemfile')), 'Gemfile untouched').toBeTruthy();
          ctx.expect(fs.readFileSync(path.join(root, 'src', 'pages', 'index.html'), 'utf8').includes('page.resolved'), 'templates untouched').toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'e2e: real migration converts config, rewrites templates, removes legacy files',
      run: (ctx) => {
        const root = stageLegacyConsumer();
        try {
          const report = runMigration(root, { execute: true });
          ctx.expect(report.errors).toEqual([]);
          ctx.expect(loadConfig(root, 'web').errors, 'written config passes the strict loader').toEqual([]);

          const page = fs.readFileSync(path.join(root, 'src', 'pages', 'index.html'), 'utf8');
          ctx.expect(page.includes('layout: frontend/core/base'), 'bracket layout rewritten').toBeTruthy();
          ctx.expect(page.includes('{{ resolved.meta.title }}'), 'page.resolved rewritten').toBeTruthy();
          ctx.expect(page.includes('{% include modules/thing.html %}'), 'include slash stripped').toBeTruthy();

          const layout = fs.readFileSync(path.join(root, 'src', '_layouts', 'custom.html'), 'utf8');
          ctx.expect(!layout.includes('forloop.parentloop'), 'parentloop hoisted').toBeTruthy();

          for (const rel of ['src/_config.yml', 'config/ultimate-jekyll-manager.json', 'Gemfile', 'Gemfile.lock']) {
            ctx.expect(!fs.existsSync(path.join(root, rel)), `${rel} removed`).toBeTruthy();
          }

          ctx.expect(!fs.existsSync(path.join(root, 'src', 'assets', 'js', 'main.js')), 'seed-identical main.js removed (core main takes over)').toBeTruthy();
          ctx.expect(fs.existsSync(path.join(root, 'src', 'assets', 'js', 'pages', 'custom.js')), 'customized js NOT deleted').toBeTruthy();
          ctx.expect(report.lint.some((finding) => finding.check === 'ujm-import'), 'non-seed ultimate-jekyll-manager import flagged').toBeTruthy();

          const scss = fs.readFileSync(path.join(root, 'src', 'assets', 'css', 'main.scss'), 'utf8');
          ctx.expect(scss.includes("@use 'omega:main' as * with ("), 'theme-variable customization rewired to the layered importer').toBeTruthy();
          ctx.expect(scss.includes('$primary: #5B47FB'), 'with-args preserved verbatim').toBeTruthy();

          // Second run: nothing legacy left, the config it wrote is right there —
          // already-converted is DONE, not an error ([#297]).
          const again = runMigration(root, { execute: true });
          ctx.expect(again.errors, 'a rerun is not a failure').toEqual([]);
          ctx.expect(again.config.skipped, 'rerun reports the config step already done').toBe(true);
          ctx.expect(again.codemod.totalEdits, 'rewrites are idempotent').toBe(0);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'e2e: a config VALUE reading `site.<section>` is rewritten with the templates (#671)',
      run: (ctx) => {
        // The converter carries a section's strings verbatim, and a UJM `_config.yml`
        // routinely spelled one "Sample - {{ site.brand.name }}" — which since #611
        // renders the brand name EMPTY wherever it lands, with no error and
        // nothing in the per-template census to catch it.
        const root = stageLegacyConsumer();
        try {
          const report = runMigration(root, { execute: true });
          const written = fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8');

          ctx.expect(written, 'the config value moves to the lane the config lives on').toMatch(/Sample - \{\{ resolved\.config\.brand\.name \}\}/);
          ctx.expect(written, 'and the dead spelling is gone from the file').not.toMatch(/site\.brand\.name/);
          ctx.expect(report.lint.some((finding) => finding.check === 'config-reads' && finding.file === path.join('config', 'omega.json5')), `the rewrite is reported against the CONFIG file, like any other file: ${report.lint.map((f) => `${f.file}`).join(', ')}`).toBeTruthy();
          ctx.expect(loadConfig(root, 'web').errors, 'and the rewritten config still loads').toEqual([]);

          const again = runMigration(root, { execute: true });
          ctx.expect(!again.lint.some((finding) => finding.check === 'config-reads' && finding.file === path.join('config', 'omega.json5')), 'a rerun finds nothing to move — the config rewrite is idempotent too').toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'e2e: report mode reports the config-value rewrite and writes NOTHING (#671)',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-configvalue-'));
        try {
          fs.mkdirSync(path.join(root, 'config'), { recursive: true });
          fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
          const configPath = path.join(root, 'config', 'omega.json5');
          const original = [
            '{',
            "  brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },",
            '  // The default <title> every page falls through to',
            '  targets: { web: { type: \'web\', meta: { title: \'Creative agency - {{ site.brand.name }}\' } } },',
            '}',
            '',
          ].join('\n');
          fs.writeFileSync(configPath, original);
          fs.writeFileSync(path.join(root, 'src', 'pages', 'index.html'), '<h1>Home</h1>\n');

          const report = runMigration(root);

          ctx.expect(fs.readFileSync(configPath, 'utf8'), 'report mode previews the config rewrite like every other edit').toBe(original);
          ctx.expect(report.codemod.files.some((file) => file.path === path.join('config', 'omega.json5')), `the preview names the config file among the edited files: ${report.codemod.files.map((f) => f.path).join(', ')}`).toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'e2e: report mode on a LEGACY root previews the config-value rewrite too (#671)',
      run: (ctx) => {
        // The pre-flight case the report exists for: nothing is converted yet, so the
        // config file the scan reads is not on disk — and the preview scanned it
        // anyway and reported a clean bill for a `meta.title` the real run rewrites.
        const root = stageLegacyConsumer();
        try {
          const report = runMigration(root);
          const rel = path.join('config', 'omega.json5');

          ctx.expect(!fs.existsSync(path.join(root, rel)), 'report mode still writes nothing').toBeTruthy();
          const file = report.codemod.files.find((entry) => entry.path === rel);
          ctx.expect(file, `the config the run WOULD write is previewed like any other file: ${report.codemod.files.map((f) => f.path).join(', ')}`).toBeTruthy();
          ctx.expect(file.edits.some((edit) => edit.after.includes('resolved.config.brand.name')), `…showing the value it moves: ${file.edits.map((edit) => edit.after).join(' | ')}`).toBeTruthy();
          ctx.expect(report.lint.some((finding) => finding.check === 'config-reads' && finding.file === rel), 'and the finding names the config file, exactly as the real run reports it').toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'e2e: the report lists a bare require the consumer package.json never declared (#600)',
      run: (ctx) => {
        const root = stageLegacyConsumer();
        try {
          fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
            name: 'legacy-site',
            dependencies: { 'node-powertools': '^3.0.0' },
          }, null, 2));
          fs.mkdirSync(path.join(root, 'src', 'assets', 'js', 'lib'), { recursive: true });
          fs.writeFileSync(path.join(root, 'src', 'assets', 'js', 'lib', 'io.js'), [
            "const path = require('node:path');",
            "const fs = require('fs');",
            "const local = require('./local.js');",
            'function buildPromptText() {',
            "  const jetpack = require('fs-jetpack');",
            "  const { wait } = require('node-powertools');",
            "  const { escapeHTML } = require('@omega.js/client/modules/utilities.js');",
            "  const theme = require('__theme__/config.js');",
            '  return { jetpack, wait, escapeHTML, theme };',
            '}',
            '',
          ].join('\n'));

          const report = runMigration(root);

          ctx.expect(report.bareRequires.map((entry) => entry.module), 'only what this project does not declare: a built-in resolves everywhere, a relative path is not a package, node-powertools IS declared, '
            + 'and the framework RESOLVES `@omega.js/client` (subpaths included) and `__theme__` through its own bundler aliases — a consumer must not install those').toEqual(['fs-jetpack']);

          const [jetpack] = report.bareRequires;
          ctx.expect(jetpack.file, 'the finding names the file').toBe('src/assets/js/lib/io.js');
          ctx.expect(jetpack.line, '…and the line, because the require is lazy and the route only 500s when it runs').toBe(5);
          ctx.expect(jetpack.fix, '…and the fix is the dependency, never an auto-install').toMatch(/npm install fs-jetpack/);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'e2e: a consumer with no package.json to judge against reports no bare requires (#600)',
      run: (ctx) => {
        const root = stageLegacyConsumer();
        try {
          fs.mkdirSync(path.join(root, 'src', 'assets', 'js', 'lib'), { recursive: true });
          fs.writeFileSync(path.join(root, 'src', 'assets', 'js', 'lib', 'io.js'), "const jetpack = require('fs-jetpack');\n");

          const report = runMigration(root);
          ctx.expect(report.bareRequires, 'with no manifest there is no "undeclared" — guessing would name every package the file uses').toEqual([]);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'e2e: a pre-converted app (brand config above, no legacy configs) succeeds and still codemods (#297)',
      run: (ctx) => {
        const { root, targetDir } = stagePreConvertedBrandTarget();
        try {
          const report = runMigration(targetDir, { execute: true });

          ctx.expect(report.errors, 'a converted config is not a failure').toEqual([]);
          ctx.expect(report.config.skipped, 'the config step reports itself already done').toBe(true);
          ctx.expect(report.config.path, 'names the config the loader resolves').toBe(path.join('..', '..', 'config', 'omega.json5'));

          const page = fs.readFileSync(path.join(targetDir, 'src', 'pages', 'index.html'), 'utf8');
          ctx.expect(page.includes('{{ resolved.meta.title }}'), 'the codemods still ran').toBeTruthy();
          ctx.expect(page.includes('layout: frontend/core/base'), 'bracket layout rewritten').toBeTruthy();
          ctx.expect(!fs.existsSync(path.join(targetDir, 'Gemfile')), 'legacy hygiene still ran').toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'e2e: the web leg never judges the brand config: that is the brand-root config pass\'s one job',
      run: (ctx) => {
        const { root, targetDir } = stagePreConvertedBrandTarget();
        try {
          // A brand config the strict schema refuses: the leg reports its own files only
          fs.writeFileSync(path.join(root, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' }, bogus: { a: 1 }, targets: { web: { type: 'web' } } }\n");

          const report = runMigration(targetDir, { execute: true });

          ctx.expect(report.config.skipped, 'still the skip branch').toBe(true);
          ctx.expect(report.errors, 'no second verdict on a file the manager already judges').toEqual([]);
          ctx.expect(report.config.validation, 'the leg never loads the brand config').toBe(undefined);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    // The mid-conversion boundary (#298): the legacy guard runs BEFORE the
    // converted-config probe. A root carrying BOTH — legacy sources and an
    // omega.json5 from an earlier partial run — is NOT done; the legacy files are
    // the truth to convert from, and hoisting the skip check above the guard would
    // strand every such root on a stale config.
    {
      name: 'e2e: legacy configs beside an existing omega.json5 still convert',
      run: (ctx) => {
        const root = stageLegacyConsumer();
        try {
          fs.writeFileSync(path.join(root, 'config', 'omega.json5'), "{ brand: { id: 'stale', name: 'Stale' }, targets: { web: { type: 'web' } } }\n");

          const report = runMigration(root, { execute: true });

          ctx.expect(report.errors).toEqual([]);
          ctx.expect(!report.config.skipped, 'an existing omega.json5 never short-circuits a root that still has legacy sources').toBeTruthy();
          ctx.expect(report.config.sources, 'the conversion reads the legacy files').toEqual([path.join('src', '_config.yml'), path.join('config', 'ultimate-jekyll-manager.json')]);

          const written = JSON5.parse(fs.readFileSync(path.join(root, 'config', 'omega.json5'), 'utf8'));
          ctx.expect(written.brand.id, 'the stale file was rewritten from the legacy sources').toBe('sample');
          ctx.expect(written.brand.url).toBe('https://sample.test');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'e2e: neither a legacy config nor a resolvable omega.json5 still fails loudly (#297)',
      run: (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-broken-'));
        try {
          fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
          fs.writeFileSync(path.join(root, 'src', 'pages', 'index.html'), '<h1>{{ page.resolved.meta.title }}</h1>\n');

          const report = runMigration(root, { execute: true });
          ctx.expect(report.config, 'nothing to report about a config that does not exist').toBe(null);
          ctx.expect(report.errors.some((error) => error.includes('no legacy configs found')), 'the broken state is an error').toBeTruthy();
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'e2e: the client-runtime renames reach templates, consumer JS and the service worker (#248)',
      run: (ctx) => {
        const root = stageClientRuntimeConsumer();
        try {
          const report = runMigration(root, { execute: true });
          ctx.expect(report.errors).toEqual([]);

          const page = fs.readFileSync(path.join(root, 'src', 'pages', 'account.html'), 'utf8');
          ctx.expect(page.includes('\nconfig:\n  client:\n'), 'frontmatter key renamed, and moved under the page config parent (#607)').toBeTruthy();
          ctx.expect(page.includes('{% include global/sections/account.html %}'), 'theme-prefixed include flattened').toBeTruthy();
          ctx.expect(page.includes('class="btn omega-signout"'), 'signout trigger class renamed').toBeTruthy();
          ctx.expect(page.includes('data-omega-bind="@show auth.user.authenticated"'), 'binding attribute renamed, the bare user read made the authenticated one').toBeTruthy();

          const section = fs.readFileSync(path.join(root, 'src', '_includes', 'frontend', 'sections', 'account.json'), 'utf8');
          ctx.expect(section.includes('"class": "btn omega-signout"'), 'the section descriptor is walked — no half-rename').toBeTruthy();
          ctx.expect(section.includes('"data-omega-bind": "@show auth.user.authenticated"'), 'the descriptor binding renamed with the JS that reads it').toBeTruthy();

          const worker = fs.readFileSync(path.join(root, 'src', 'service-worker.js'), 'utf8');
          ctx.expect(worker, 'the src-root entry is walked too').toBe("import Manager from '@omega.js/web/service-worker';\n");

          const contact = fs.readFileSync(path.join(root, 'src', 'assets', 'js', 'pages', 'contact.js'), 'utf8');
          ctx.expect(contact.includes("import omega from '@omega.js/web/runtime';"), 'consumer JS under src/assets is walked, and the singleton is the web runtime instance').toBeTruthy();
          ctx.expect(contact.includes("from '@omega.js/client/modules/form-manager.js'"), 'the lib moved to its client module').toBeTruthy();
          ctx.expect(contact.includes('${omega.getApiUrl()}'), 'the singleton identifier renamed').toBeTruthy();

          const again = runMigration(root, { execute: true });
          ctx.expect(again.codemod.totalEdits, 'the client-runtime rewrites are idempotent').toBe(0);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'e2e: a legacy test harness is reported as undiscoverable, not silently dark (#248)',
      run: (ctx) => {
        const root = stageClientRuntimeConsumer();
        try {
          const report = runMigration(root);

          ctx.expect(report.legacyTests, 'every harness-shaped file under test/ — any layer dir, any name — and no real node:test file, no `_`-prefixed helper').toEqual([
              path.join('test', 'boot', 'chat-shell.js'),
              path.join('test', 'build', 'config.test.js'),
              path.join('test', 'build', 'xp-curve.js'),
              path.join('test', 'smoke', 'nav.js'),
            ]);
          ctx.expect(report.errors, 'an undiscoverable suite is a warning, never a failed migration').toEqual([]);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'e2e: no legacy gradient utility survives a codemod run (#296)',
      run: (ctx) => {
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

          const report = runCodemod(root, { execute: true });
          const page = fs.readFileSync(path.join(root, 'src', 'pages', 'index.html'), 'utf8');
          ctx.expect(!/gradient-animated|gradient-grain/.test(page), 'the walk reaches the rule — nothing legacy left on disk').toBeTruthy();
          ctx.expect(page.includes('<section class="bg-gradient-rainbow omega-dotgrid text-light" data-omega-dotfield>'), 'the hero wears the v2 treatment').toBeTruthy();
          ctx.expect(page.includes('<div class="omega-dotgrid rounded-4">Grain only</div>'), 'the static half converts without the motion attribute').toBeTruthy();
          ctx.expect(report.files.some((file) => file.edits.some((edit) => edit.rule === 'gradient-utilities')), 'the edits are reported under the rule').toBeTruthy();

          const again = runCodemod(root, { execute: true });
          ctx.expect(again.totalEdits, 'converting is a ONE-time move — a rerun changes nothing').toBe(0);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },

    // ---------------------------------------------------------------------------
    // Runtime composition — omega.json5 homes render into the chrome contract
    // ---------------------------------------------------------------------------

    {
      name: 'composition: cloud/payment/analytics at their omega homes reach the chrome',
      run: async (ctx) => {
        const MINI = path.join(__dirname, 'fixtures', 'mini-site');
        const siteData = {
          ...JSON.parse(fs.readFileSync(path.join(MINI, 'site-data.json'), 'utf8')),
          cloud: { provider: 'firebase', config: { apiKey: 'AIza-COMPOSE', projectId: 'compose-test' } },
          payment: { providers: { chargebee: { site: 'compose' } }, products: [{ id: 'basic', name: 'Basic' }] },
          analytics: { providers: { google: { id: 'G-COMPOSE1' } } },
        };

        const OUT = path.join(PKG, '.omega', 'migrate-test-out');
        setEnvironment('development');
        const Eleventy = require('@11ty/eleventy').default;
        const elev = new Eleventy(MINI, OUT, {
          quietMode: true,
          configPath: false,
          config: (eleventyConfig) => {
            eleventyConfig.setUseTemplateCache(false);
            return configureOmega(eleventyConfig, {
              consumerDir: MINI,
              siteData,
              assetManifest: { js: { main: '/assets/js/main-TEST.js', pages: {} }, css: { main: '/assets/css/main-TEST.css', pages: {}, layouts: {} } },
            });
          },
        });
        const pages = new Map((await elev.toJSON()).map((result) => [result.url, result.content]));
        const html = pages.get('/');

        // The delivery is ONE FILE (#894, #743): the run writes `build.js` at the site
        // root and the chrome loads it with its FIRST script tag, so what a browser
        // reads of these three homes is read out of that snapshot, never out of the
        // page. The engine composes it on `eleventy.before`, so a toJSON run writes it
        // like any other.
        const buildJs = fs.readFileSync(path.join(OUT, 'build.js'), 'utf8');
        ctx.expect(html.includes('<script src="/build.js'), 'the chrome loads the one snapshot').toBeTruthy();

        // The id reaches the browser as CONFIG and nothing else (#383): no loader is
        // emitted anywhere, so the runtime gate decides whether gtag.js is ever
        // fetched. `analytics` is the whole contract now.
        ctx.expect(buildJs.includes('"google":{"id":"G-COMPOSE1"}'), 'the snapshot carries the canonical providers shape (flat bridge dead, cp106a)').toBeTruthy();
        ctx.expect(!html.includes('G-COMPOSE1'), 'and the chrome bakes no second copy of the id').toBeTruthy();
        ctx.expect(!html.includes('googletagmanager.com/gtag/js'), 'and no loader ships with the chrome').toBeTruthy();
        // The canonical homes ride as they are authored (#894): @omega.js/client
        // boots Firebase from `cloud.config`, and nothing composes a second copy.
        ctx.expect(buildJs.includes('"apiKey":"AIza-COMPOSE"'), 'cloud.config reaches the browser').toBeTruthy();
        ctx.expect(buildJs.includes('"site":"compose"'), 'and so does the payment section').toBeTruthy();
      },
    },
  ],
});
