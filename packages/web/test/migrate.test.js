/**
 * `omega migrate` — the B4 codemod + liquid-lint suite.
 *
 * Three layers: rule units (pure text transforms, incl. the false-positive
 * guards), SEMANTIC proofs (the rewrites render identically / correctly
 * through the real LiquidJS + template-kit adapter — the same path the
 * engine uses), and the end-to-end migration of a synthetic UJM consumer in
 * a temp dir (config conversion validated through the real @omega.js/config
 * loader, legacy files removed, check mode writes nothing). Plus the runtime
 * composition the migration relies on: firebaseConfig/payment/analytics at
 * their omega.json5 homes render into the chrome's composed spots.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { Liquid } = require('liquidjs');
const { registerLiquid } = require('@omega.js/template-kit');
const { loadConfig } = require('@omega.js/config');
const { applyRules } = require('../src/migrate/codemod.js');
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
  assert.strictEqual(lines[4], '{{ site.analytics.providers.google.id }} {{ resolved.analytics.providers.tiktok.id }}');
  assert.strictEqual(edits.length, 5, 'one edit recorded per changed line per rule');
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

test('rules: tag-arg hoist scoped to the tag span', () => {
  const input = '<a title="{{ t }}">{% uj_icon "{{ stat.icon }} fa-2x" %}</a>';
  const { text } = applyRules(input, 'unit.html');
  const lines = text.split('\n');
  assert.strictEqual(lines[0].trim(), '{% capture uj_migrate_arg_1 %}{{ stat.icon }} fa-2x{% endcapture %}');
  assert.ok(lines[1].includes('title="{{ t }}"'), 'HTML attribute interpolation untouched');
  assert.ok(lines[1].includes('{% uj_icon uj_migrate_arg_1 %}'), 'tag arg replaced with the capture var');
});

// ---------------------------------------------------------------------------
// Semantic proofs — rewrites render correctly through the REAL adapter
// ---------------------------------------------------------------------------

function realEngine() {
  const engine = new Liquid({ jekyllInclude: true });
  registerLiquid(engine, {
    icons: {
      fontAwesomeDir: path.join(PKG, 'core', 'icons'),
      flagsDir: path.join(PKG, 'core', 'icons', 'flags'),
      style: 'solid',
    },
  });
  return engine;
}

test('semantic: hoisted tag arg renders identically to a literal quoted arg', async () => {
  const engine = realEngine();
  const { text } = applyRules('{% uj_icon "{{ stat.icon }} text-primary" %}', 'semantic.html');
  const rewritten = await engine.parseAndRender(text, { stat: { icon: 'star' } });
  const literal = await engine.parseAndRender('{% uj_icon "star text-primary" %}', {});
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

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

test('lint: Jekyll-only tags error, unknown filters warn, known names pass', () => {
  const findings = lintText([
    '{% post_url 2020-01-01-hello %}',
    '{% assign related = site.posts | where_exp: "p", "p.url" | limit: 3 %}',
    '{% uj_icon "star" %} {{ title | uj_title_case | markdownify }}',
    '{% iftruthy site.brand %}x{% endiftruthy %}',
  ].join('\n'), 'lint.html');
  assert.ok(findings.some((finding) => finding.check === 'jekyll-only-tag' && finding.line === 1), 'post_url flagged');
  assert.ok(findings.some((finding) => finding.check === 'unknown-filter' && finding.message.includes('limit')), 'limit flagged (Jekyll never had it either)');
  assert.strictEqual(findings.filter((finding) => finding.line >= 3).length, 0, 'template-kit tags/filters + block ends all known');
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
    sentry: { enabled: true, config: { dsn: 'https://x@sentry.io/1' } },
  },
  oauth2: { discord: { enabled: true } },
  analytics: { google: 'G-TEST123', meta: '', tiktok: 'TIKTOK1' },
  socials: { twitter: 'sample' },
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
  assert.strictEqual(omega.firebaseConfig.apiKey, 'AIza-TEST', 'firebase app config extracted');
  assert.strictEqual(omega.payment.processors.chargebee.site, 'sample');
  assert.strictEqual(omega.payment.processors.stripe.publishableKey, undefined, 'publishableKey: false dropped');
  assert.strictEqual(omega.oauth2.discord.enabled, true);

  const web = omega.targets.web;
  assert.strictEqual(web.web_manager.payment, undefined, 'payment moved out of the client blob');
  assert.strictEqual(web.web_manager.firebase.app.config, undefined, 'firebase config moved out');
  assert.strictEqual(web.web_manager.firebase.app.enabled, true, 'client firebase toggles stay');
  assert.strictEqual(web.web_manager.sentry.config.dsn, 'https://x@sentry.io/1', 'client sentry settings stay whole');
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

test('config: converted output passes the real loader for target web', () => {
  const { omega } = convertConfig({ jekyll: structuredClone(LEGACY_JEKYLL), ujm: structuredClone(LEGACY_UJM) });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-config-'));
  try {
    fs.mkdirSync(path.join(tmp, 'config'));
    fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), serializeOmega(omega));
    const { config, errors, enabled } = loadConfig(tmp, 'web');
    assert.deepStrictEqual(errors, [], 'no schema findings');
    assert.strictEqual(enabled, true, 'web target enabled by key presence');
    assert.strictEqual(config.web_manager.auth.enabled, true, 'targets.web overlays the top level');
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

    // Second run: nothing legacy left — reported, not destructive
    const again = runMigration(root, {});
    assert.ok(again.errors.some((error) => error.includes('already migrated')), 'rerun reports already-migrated');
    assert.strictEqual(again.codemod.totalEdits, 0, 'rewrites are idempotent');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Runtime composition — omega.json5 homes render into the chrome contract
// ---------------------------------------------------------------------------

test('composition: firebaseConfig/payment/analytics at their omega homes reach the chrome', async () => {
  const MINI = path.join(__dirname, 'fixtures', 'mini-site');
  const siteData = {
    ...JSON.parse(fs.readFileSync(path.join(MINI, 'site-data.json'), 'utf8')),
    firebaseConfig: { apiKey: 'AIza-COMPOSE', projectId: 'compose-test' },
    payment: { processors: { chargebee: { site: 'compose' } }, products: [{ id: 'basic', name: 'Basic' }] },
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

  assert.ok(html.includes('googletagmanager.com/gtag/js?id=G-COMPOSE1'), 'gtag reads analytics.providers.google.id');
  assert.ok(html.includes('google: "G-COMPOSE1"'), 'Configuration.analytics flat bridge for the client');
  assert.ok(html.includes('"apiKey":"AIza-COMPOSE"'), 'firebaseConfig composed into web_manager.firebase.app.config');
  assert.ok(html.includes('"site":"compose"'), 'payment composed into web_manager.payment');
});
