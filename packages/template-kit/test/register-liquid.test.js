/**
 * register-liquid.test.js — the adapter against REAL LiquidJS.
 *
 * Proves the whole surface works through an actual engine render: filters in
 * templates, block/inline tags, context-coupled filters (liquify /
 * content_format / increment_return), the omega_* helper pack and the retired
 * Jekyll names that throw, and the collection-backed tags: the exact wiring
 * the Eleventy spike will use.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('path');
const { Liquid } = require('liquidjs');
const { registerLiquid } = require('../src/register-liquid.js');
const { COMPAT_REPLACEMENTS } = require('../src/jekyll-compat.js');

const FIXTURES = path.join(__dirname, 'fixtures');

const SITE = {
  url: 'https://bakeoff.example.com',
  baseurl: '',
  brand: { name: 'Bakeoff' },
  translation: { default: 'en', languages: ['en', 'es'] },
};

// The thrower's whole message, the `<name>` placeholder included.
function jekyllThrow(old, successor) {
  return new RegExp(`\\[@omega\\.js/template-kit\\] ${old} is a Jekyll filter: use ${successor} \\(npx omega migrate --target=<name> --execute rewrites it\\)`);
}

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

module.exports = defineCases({
  type: 'group',
  description: 'register-liquid',
  tests: [
    {
      name: 'omega_ filters render through the engine',
      run: async (ctx) => {
        const engine = makeEngine();

        ctx.expect(await engine.parseAndRender('{{ "hello world" | omega_title_case }}')).toBe('Hello World');
        ctx.expect(await engine.parseAndRender('{{ 10000 | omega_commaify }}')).toBe('10,000');
        ctx.expect(await engine.parseAndRender('{{ "hello" | omega_hash: 1000 }}')).toBe('994');
        ctx.expect(await engine.parseAndRender('{{ 5 | omega_pluralize: "post", "posts" }}')).toBe('posts');
        ctx.expect(await engine.parseAndRender('{{ "https://x.com/a.png" | omega_cachebreak }}')).toMatch(/a\.png\?cb=\d+$/);
      },
    },

    {
      name: 'omega_liquify recursively resolves through the render scope',
      run: async (ctx) => {
        const engine = makeEngine();
        const scope = { nested: '{{ inner }}', inner: 'DEEP', wrapper: 'A {{ nested }} Z' };

        ctx.expect(await engine.parseAndRender('{{ wrapper | omega_liquify }}', scope)).toBe('A DEEP Z');
      },
    },

    {
      name: 'omega_content_format markdownifies only for .md pages',
      run: async (ctx) => {
        const markdown = (str) => `<md>${str}</md>`;
        const engine = makeEngine({ markdown });

        const mdScope = { page: { extension: '.md' }, body: 'hello {{ page.extension }}' };
        ctx.expect(await engine.parseAndRender('{{ body | omega_content_format }}', mdScope)).toBe('<md>hello .md</md>');

        const htmlScope = { page: { extension: '.html' }, body: 'hello' };
        ctx.expect(await engine.parseAndRender('{{ body | omega_content_format }}', htmlScope)).toBe('hello');
      },
    },

    {
      name: 'omega_increment_return counts within one render and resets across renders',
      run: async (ctx) => {
        const engine = makeEngine();
        const tpl = '{{ 1 | omega_increment_return }}-{{ 1 | omega_increment_return }}-{{ 2 | omega_increment_return }}';

        ctx.expect(await engine.parseAndRender(tpl)).toBe('1-2-4');
        ctx.expect(await engine.parseAndRender(tpl)).toBe('1-2-4'); // fresh context => fresh counter
      },
    },

    {
      name: 'block tags work in-template with rendered inner content',
      run: async (ctx) => {
        const engine = makeEngine();
        const tpl = '{% iftruthy user %}Hi {{ user }}{% endiftruthy %}{% iffalsy user %}Guest{% endiffalsy %}';

        ctx.expect(await engine.parseAndRender(tpl, { user: 'Ian' })).toBe('Hi Ian');
        ctx.expect(await engine.parseAndRender(tpl, { user: '' })).toBe('Guest');
        ctx.expect(await engine.parseAndRender(tpl, {})).toBe('Guest');
      },
    },

    {
      name: 'iffile renders through the injected fileExists',
      run: async (ctx) => {
        const engine = makeEngine({ fileExists: (p) => p === '/exists.png' });
        const tpl = '{% iffile "/exists.png" %}YES{% endiffile %}{% iffile "/nope.png" %}NO{% endiffile %}';

        ctx.expect(await engine.parseAndRender(tpl)).toBe('YES');
      },
    },

    {
      name: 'urlmatches reads page.url from the render scope',
      run: async (ctx) => {
        const engine = makeEngine();
        const tpl = '{% urlmatches "/about", "current" %}';

        ctx.expect(await engine.parseAndRender(tpl, { page: { url: '/about/index.html' } })).toBe('current');
        ctx.expect(await engine.parseAndRender(tpl, { page: { url: '/pricing' } })).toBe('');
      },
    },

    {
      name: 'omega_logo renders an inline SVG through the engine',
      run: async (ctx) => {
        const engine = makeEngine();

        const logo = await engine.parseAndRender('{% omega_logo acme %}');
        ctx.expect(logo).toMatch(/id="acme-\d+-grad"/);
      },
    },

    {
      name: 'omega_external uses the configured site.url',
      run: async (ctx) => {
        const engine = makeEngine();
        ctx.expect(await engine.parseAndRender('{% omega_external "pricing" %}')).toBe('https://bakeoff.example.com/pricing');
      },
    },

    {
      name: 'omega_translation_url uses the configured site.translation',
      run: async (ctx) => {
        const engine = makeEngine();
        ctx.expect(await engine.parseAndRender('{% omega_translation_url "es", "/pricing" %}')).toBe('/es/pricing');
        ctx.expect(await engine.parseAndRender('{% omega_translation_url "en", "/pricing" %}')).toBe('/pricing');
      },
    },

    {
      name: 'collection-backed tags resolve through injected accessors',
      run: async (ctx) => {
        const team = [{ id: '/team/ian', url: '/team/ian', data: { member: { name: 'Ian' } } }];
        const posts = [{ id: '/posts/2024-01-15-hello', url: '/blog/hello', data: { title: 'Hello World' } }];
        const engine = makeEngine({
          getCollection: (name) => (name === 'team' ? team : name === 'posts' ? posts : []),
          getCollectionNames: () => ['team', 'posts'],
        });

        ctx.expect(await engine.parseAndRender('{% omega_member "ian" %}')).toBe('Ian');
        ctx.expect(await engine.parseAndRender('{% omega_post "hello" %}')).toBe('Hello World');
        ctx.expect(await engine.parseAndRender('{% omega_post "hello", "url" %}')).toBe('https://bakeoff.example.com/blog/hello');
      },
    },

    {
      name: '#830: omega_slugify deletes an apostrophe through the engine (#597)',
      run: async (ctx) => {
        const engine = makeEngine();

        ctx.expect(await engine.parseAndRender('{{ "Ian\'s Title" | omega_slugify }}')).toBe('ians-title');
      },
    },

    {
      name: '#830: each renamed helper renders through the engine as its Jekyll name did',
      run: async (ctx) => {
        const engine = makeEngine({ markdown: (str) => `<p>${str.trim()}</p>` });

        ctx.expect(await engine.parseAndRender('{{ "Hello World & Friends" | omega_slugify }}')).toBe('hello-world-friends');
        ctx.expect(await engine.parseAndRender('{{ "# Hi" | omega_markdownify }}')).toBe('<p># Hi</p>');
        ctx.expect(await engine.parseAndRender('{{ "/about" | omega_relative_url }}')).toBe('/about');
        ctx.expect(await engine.parseAndRender('{{ "/about" | omega_absolute_url }}')).toBe('https://bakeoff.example.com/about');
        ctx.expect(await engine.parseAndRender('{{ "<b>hi</b> there" | omega_strip_html }}')).toBe('hi there');
        ctx.expect(await engine.parseAndRender('{{ "one two three" | omega_number_of_words }}')).toBe('3');

        const scope = { items: [{ type: 'post', n: 1 }, { type: 'page', n: 2 }, { type: 'post', n: 3 }] };
        const filtered = await engine.parseAndRender(
          '{% assign posts = items | omega_where: "item", "item.type == \'post\'" %}{{ posts | size }}',
          scope
        );
        ctx.expect(filtered).toBe('2');
        const grouped = await engine.parseAndRender(
          '{% assign groups = items | omega_group_by: "item", "item.type" %}{% for group in groups %}{{ group.name }}:{{ group.size }};{% endfor %}',
          scope
        );
        ctx.expect(grouped).toBe('post:2;page:1;');

        const date = { date: new Date('2024-01-15T12:00:00Z') };
        ctx.expect(await engine.parseAndRender('{{ date | omega_date_xmlschema }}', date)).toBe('2024-01-15T12:00:00+00:00');
        ctx.expect(await engine.parseAndRender('{{ date | omega_date_rfc822 }}', date)).toBe('Mon, 15 Jan 2024 12:00:00 +0000');
      },
    },

    {
      name: '#830: jsonify throws naming omega_jsonify; omega_jsonify is compact, and pretty with an indent',
      run: async (ctx) => {
        const engine = makeEngine();
        const scope = { obj: { a: 1 } };

        await ctx.expect(engine.parseAndRender('{{ obj | jsonify }}', scope)).rejects.toThrow(jekyllThrow('jsonify', 'omega_jsonify'));
        ctx.expect(await engine.parseAndRender('{{ obj | omega_jsonify }}', scope)).toBe('{"a":1}');
        ctx.expect(await engine.parseAndRender('{{ obj | omega_jsonify: 2 }}', scope)).toBe('{\n  "a": 1\n}');
      },
    },

    {
      name: '#830: every retired Jekyll name throws through the engine, naming its successor and the migrate fix',
      run: async (ctx) => {
        const engine = makeEngine({ markdown: (str) => str });
        const retired = Object.entries(COMPAT_REPLACEMENTS);

        ctx.expect(retired.length, 'the whole table is walked').toBe(11);
        for (const [old, successor] of retired) {
          await ctx.expect(engine.parseAndRender(`{{ "x" | ${old} }}`), `${old} fails the render`).rejects.toThrow(jekyllThrow(old, successor));
        }
      },
    },

    {
      name: 'variable-resolver arguments flow through real tag markup',
      run: async (ctx) => {
        const engine = makeEngine();
        const scope = { platformName: 'es' };

        // unquoted variable resolves; quoted literal stays literal (unknown codes
        // echo back DOWNCASED — Ruby downcases before the lookup)
        ctx.expect(await engine.parseAndRender('{% omega_language platformName %}', scope)).toBe('Spanish');
        ctx.expect(await engine.parseAndRender('{% omega_language "platformName" %}')).toBe('platformname');
      },
    },
  ],
});
