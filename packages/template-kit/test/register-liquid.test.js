/**
 * register-liquid.test.js — the adapter against REAL LiquidJS.
 *
 * Proves the whole surface works through an actual engine render: filters in
 * templates, block/inline tags, context-coupled filters (liquify /
 * content_format / increment_return), the Jekyll-compat pack, and the
 * collection-backed tags — the exact wiring the Eleventy spike will use.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { Liquid } = require('liquidjs');
const { registerLiquid } = require('../src/register-liquid.js');

const FIXTURES = path.join(__dirname, 'fixtures');

const SITE = {
  url: 'https://bakeoff.example.com',
  baseurl: '',
  brand: { name: 'Bakeoff' },
  translation: { default: 'en', languages: ['en', 'es'] },
};

function makeEngine(overrides = {}) {
  const engine = new Liquid();
  registerLiquid(engine, {
    site: SITE,
    getCollection: overrides.getCollection,
    getCollectionNames: overrides.getCollectionNames,
    fileExists: overrides.fileExists,
    markdown: overrides.markdown,
    logos: { dir: path.join(FIXTURES, 'logos') },
  });
  return engine;
}

test('omega_ filters render through the engine', async () => {
  const engine = makeEngine();

  assert.strictEqual(await engine.parseAndRender('{{ "hello world" | omega_title_case }}'), 'Hello World');
  assert.strictEqual(await engine.parseAndRender('{{ 10000 | omega_commaify }}'), '10,000');
  assert.strictEqual(await engine.parseAndRender('{{ "hello" | omega_hash: 1000 }}'), '994');
  assert.strictEqual(await engine.parseAndRender('{{ 5 | omega_pluralize: "post", "posts" }}'), 'posts');
  assert.match(await engine.parseAndRender('{{ "https://x.com/a.png" | omega_cachebreak }}'), /a\.png\?cb=\d+$/);
});

test('omega_liquify recursively resolves through the render scope', async () => {
  const engine = makeEngine();
  const scope = { nested: '{{ inner }}', inner: 'DEEP', wrapper: 'A {{ nested }} Z' };

  assert.strictEqual(await engine.parseAndRender('{{ wrapper | omega_liquify }}', scope), 'A DEEP Z');
});

test('omega_content_format markdownifies only for .md pages', async () => {
  const markdown = (str) => `<md>${str}</md>`;
  const engine = makeEngine({ markdown });

  const mdScope = { page: { extension: '.md' }, body: 'hello {{ page.extension }}' };
  assert.strictEqual(await engine.parseAndRender('{{ body | omega_content_format }}', mdScope), '<md>hello .md</md>');

  const htmlScope = { page: { extension: '.html' }, body: 'hello' };
  assert.strictEqual(await engine.parseAndRender('{{ body | omega_content_format }}', htmlScope), 'hello');
});

test('omega_increment_return counts within one render and resets across renders', async () => {
  const engine = makeEngine();
  const tpl = '{{ 1 | omega_increment_return }}-{{ 1 | omega_increment_return }}-{{ 2 | omega_increment_return }}';

  assert.strictEqual(await engine.parseAndRender(tpl), '1-2-4');
  assert.strictEqual(await engine.parseAndRender(tpl), '1-2-4'); // fresh context => fresh counter
});

test('block tags work in-template with rendered inner content', async () => {
  const engine = makeEngine();
  const tpl = '{% iftruthy user %}Hi {{ user }}{% endiftruthy %}{% iffalsy user %}Guest{% endiffalsy %}';

  assert.strictEqual(await engine.parseAndRender(tpl, { user: 'Ian' }), 'Hi Ian');
  assert.strictEqual(await engine.parseAndRender(tpl, { user: '' }), 'Guest');
  assert.strictEqual(await engine.parseAndRender(tpl, {}), 'Guest');
});

test('iffile renders through the injected fileExists', async () => {
  const engine = makeEngine({ fileExists: (p) => p === '/exists.png' });
  const tpl = '{% iffile "/exists.png" %}YES{% endiffile %}{% iffile "/nope.png" %}NO{% endiffile %}';

  assert.strictEqual(await engine.parseAndRender(tpl), 'YES');
});

test('urlmatches reads page.url from the render scope', async () => {
  const engine = makeEngine();
  const tpl = '{% urlmatches "/about", "current" %}';

  assert.strictEqual(await engine.parseAndRender(tpl, { page: { url: '/about/index.html' } }), 'current');
  assert.strictEqual(await engine.parseAndRender(tpl, { page: { url: '/pricing' } }), '');
});

test('omega_logo renders an inline SVG through the engine', async () => {
  const engine = makeEngine();

  const logo = await engine.parseAndRender('{% omega_logo acme %}');
  assert.match(logo, /id="acme-\d+-grad"/);
});

test('omega_external uses the configured site.url', async () => {
  const engine = makeEngine();
  assert.strictEqual(
    await engine.parseAndRender('{% omega_external "pricing" %}'),
    'https://bakeoff.example.com/pricing'
  );
});

test('omega_translation_url uses the configured site.translation', async () => {
  const engine = makeEngine();
  assert.strictEqual(await engine.parseAndRender('{% omega_translation_url "es", "/pricing" %}'), '/es/pricing');
  assert.strictEqual(await engine.parseAndRender('{% omega_translation_url "en", "/pricing" %}'), '/pricing');
});

test('collection-backed tags resolve through injected accessors', async () => {
  const team = [{ id: '/team/ian', url: '/team/ian', data: { member: { name: 'Ian' } } }];
  const posts = [{ id: '/posts/2024-01-15-hello', url: '/blog/hello', data: { title: 'Hello World' } }];
  const engine = makeEngine({
    getCollection: (name) => (name === 'team' ? team : name === 'posts' ? posts : []),
    getCollectionNames: () => ['team', 'posts'],
  });

  assert.strictEqual(await engine.parseAndRender('{% omega_member "ian" %}'), 'Ian');
  assert.strictEqual(await engine.parseAndRender('{% omega_post "hello" %}'), 'Hello World');
  assert.strictEqual(
    await engine.parseAndRender('{% omega_post "hello", "url" %}'),
    'https://bakeoff.example.com/blog/hello'
  );
});

test('Jekyll-compat pack renders through the engine', async () => {
  const engine = makeEngine({ markdown: (str) => `<p>${str.trim()}</p>` });

  assert.strictEqual(await engine.parseAndRender('{{ "Hello World & Friends" | slugify }}'), 'hello-world-friends');
  assert.strictEqual(await engine.parseAndRender('{{ "# Hi" | markdownify }}'), '<p># Hi</p>');
  assert.strictEqual(await engine.parseAndRender('{{ "/about" | relative_url }}'), '/about');
  assert.strictEqual(
    await engine.parseAndRender('{{ "/about" | absolute_url }}'),
    'https://bakeoff.example.com/about'
  );
  assert.strictEqual(await engine.parseAndRender('{{ obj | jsonify }}', { obj: { a: 1 } }), '{"a":1}');
  assert.strictEqual(await engine.parseAndRender('{{ "<b>hi</b> there" | strip_html }}'), 'hi there');

  const scope = { items: [{ type: 'post', n: 1 }, { type: 'page', n: 2 }, { type: 'post', n: 3 }] };
  const filtered = await engine.parseAndRender(
    '{% assign posts = items | where_exp: "item", "item.type == \'post\'" %}{{ posts | size }}',
    scope
  );
  assert.strictEqual(filtered, '2');

  assert.strictEqual(
    await engine.parseAndRender('{{ date | date_to_xmlschema }}', { date: new Date('2024-01-15T12:00:00Z') }),
    '2024-01-15T12:00:00+00:00' // UTC, CI-Jekyll parity (OMEGA date convention)
  );
});

test('variable-resolver arguments flow through real tag markup', async () => {
  const engine = makeEngine();
  const scope = { platformName: 'es' };

  // unquoted variable resolves; quoted literal stays literal (unknown codes
  // echo back DOWNCASED — Ruby downcases before the lookup)
  assert.strictEqual(await engine.parseAndRender('{% omega_language platformName %}', scope), 'Spanish');
  assert.strictEqual(await engine.parseAndRender('{% omega_language "platformName" %}'), 'platformname');
});
