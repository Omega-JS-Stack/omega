/**
 * filters.test.js — omega_* filter semantics, incl. Ruby-parity pins.
 *
 * Parity values verified against real Ruby (ruby 4.0.0, 2026-07-06):
 *   Digest::MD5.hexdigest('hello').hex % 1000 == 994
 *   Digest::MD5.hexdigest('somiibo').hex % 360 == 305
 *   'hello WORLD' per-word capitalize == 'Hello World'
 * Documented divergence: Ruby's omega_commaify groups DECIMAL digits too
 * ('1234.5678' => '1,234.5,678' — a latent bug); ours commas only the whole
 * part ('1,234.5678') per the best-implementation-wins rule.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const filters = require('../src/filters.js');

module.exports = defineCases({
  type: 'group',
  description: 'filters',
  tests: [
    {
      name: 'omegaStripAds removes ad-unit blocks and adunit includes',
      run: (ctx) => {
        const input = 'before\n<ad-unit>\nstuff\n</ad-unit>\nafter {% include /master/modules/adunits/banner.html %} end';
        const out = filters.omegaStripAds(input);
        ctx.expect(!out.includes('ad-unit')).toBeTruthy();
        ctx.expect(!out.includes('adunits')).toBeTruthy();
        ctx.expect(out.includes('before')).toBeTruthy();
        ctx.expect(out.includes('after')).toBeTruthy();
        ctx.expect(out.includes('end')).toBeTruthy();
      },
    },

    {
      name: 'omegaJsonEscape escapes without surrounding quotes',
      run: (ctx) => {
        ctx.expect(filters.omegaJsonEscape('say "hi"\nnow')).toBe('say \\"hi\\"\\nnow');
        ctx.expect(filters.omegaJsonEscape('back\\slash')).toBe('back\\\\slash');
      },
    },

    {
      name: 'omegaHash matches Ruby full-hexdigest BigInt semantics',
      run: (ctx) => {
        ctx.expect(filters.omegaHash('hello', 1000)).toBe(994);
        ctx.expect(filters.omegaHash('somiibo', 360)).toBe(305);
        // Deterministic
        ctx.expect(filters.omegaHash('hello', 1000)).toBe(filters.omegaHash('hello', 1000));
      },
    },

    {
      name: 'omegaRandom stays in [0, max)',
      run: (ctx) => {
        for (let i = 0; i < 50; i++) {
          const value = filters.omegaRandom(10);
          ctx.expect(value >= 0 && value < 10 && Number.isInteger(value)).toBeTruthy();
        }
      },
    },

    {
      name: 'omegaTitleCase matches Ruby per-word capitalize',
      run: (ctx) => {
        ctx.expect(filters.omegaTitleCase('hello WORLD')).toBe('Hello World');
        ctx.expect(filters.omegaTitleCase('social media automation')).toBe('Social Media Automation');
      },
    },

    {
      name: 'omegaJsonify pretty-prints with configurable indent',
      run: (ctx) => {
        ctx.expect(filters.omegaJsonify({ a: 1 })).toBe('{\n  "a": 1\n}');
        ctx.expect(filters.omegaJsonify({ a: 1 }, 4)).toBe('{\n    "a": 1\n}');
      },
    },

    {
      name: 'omegaAppendParam handles bare and existing query strings',
      run: (ctx) => {
        ctx.expect(filters.omegaAppendParam('https://x.com/img.png', 'cb', '123')).toBe('https://x.com/img.png?cb=123');
        ctx.expect(filters.omegaAppendParam('https://x.com/img.png?w=200', 'cb', '123')).toBe('https://x.com/img.png?w=200&cb=123');
        ctx.expect(filters.omegaAppendParam('', 'cb', '1')).toBe('');
        ctx.expect(filters.omegaAppendParam(null, 'cb', '1')).toBe(null);
      },
    },

    {
      name: 'omegaCachebreak appends a process-consistent cb param',
      run: (ctx) => {
        const a = filters.omegaCachebreak('https://x.com/a.png');
        const b = filters.omegaCachebreak('https://x.com/b.png?w=1');
        ctx.expect(a).toMatch(/^https:\/\/x\.com\/a\.png\?cb=\d+$/);
        ctx.expect(b).toMatch(/&cb=\d+$/);
        ctx.expect(a.split('cb=')[1]).toBe(b.split('cb=')[1]);
        ctx.expect(a.split('cb=')[1]).toBe(filters.CACHE_TIMESTAMP);
      },
    },

    {
      name: 'omegaPluralize picks singular only for exactly 1',
      run: (ctx) => {
        ctx.expect(filters.omegaPluralize(1, 'post', 'posts')).toBe('post');
        ctx.expect(filters.omegaPluralize(5, 'post', 'posts')).toBe('posts');
        ctx.expect(filters.omegaPluralize(0, 'post', 'posts')).toBe('posts');
        ctx.expect(filters.omegaPluralize(2, 'box')).toBe('boxs'); // Ruby parity: naive default
      },
    },

    {
      name: 'omegaCommaify formats integers and passes junk through',
      run: (ctx) => {
        ctx.expect(filters.omegaCommaify(10000)).toBe('10,000');
        ctx.expect(filters.omegaCommaify('1234567')).toBe('1,234,567');
        ctx.expect(filters.omegaCommaify('-1234567')).toBe('-1,234,567');
        ctx.expect(filters.omegaCommaify('1234.5678')).toBe('1,234.5678'); // divergence: Ruby gives '1,234.5,678'
        ctx.expect(filters.omegaCommaify('not a number')).toBe('not a number');
        ctx.expect(filters.omegaCommaify('')).toBe('');
        ctx.expect(filters.omegaCommaify(null)).toBe(null);
        ctx.expect(filters.omegaCommaify(123)).toBe('123');
      },
    },

    {
      name: 'createIncrementReturn accumulates per registers object',
      run: (ctx) => {
        const registers = {};
        const increment = filters.createIncrementReturn(() => registers);
        ctx.expect(increment(1)).toBe(1);
        ctx.expect(increment(1)).toBe(2);
        ctx.expect(increment(5)).toBe(7);

        const fresh = {};
        const increment2 = filters.createIncrementReturn(() => fresh);
        ctx.expect(increment2(1)).toBe(1);
      },
    },

    {
      name: 'createLiquify renders recursively with depth + no-change guards',
      run: (ctx) => {
        const scope = { a: '{{ b }}', b: 'done' };
        const render = (str) => str.replace(/\{\{ *(\w+) *\}\}/g, (m, key) => scope[key] ?? m);

        const liquify = filters.createLiquify(render);
        ctx.expect(liquify('x {{ a }} y')).toBe('x done y');
        ctx.expect(liquify(null)).toBe('');
        // Unresolvable syntax stops on no-change instead of looping
        ctx.expect(liquify('{{ missing }}')).toBe('{{ missing }}');
      },
    },

    {
      name: 'createContentFormat markdownifies only .md pages',
      run: (ctx) => {
        const render = (str) => str;
        const markdown = (str) => `<p>${str}</p>`;

        const forMd = filters.createContentFormat(render, { markdown, getPage: () => ({ extension: '.md' }) });
        ctx.expect(forMd('hello')).toBe('<p>hello</p>');

        const forHtml = filters.createContentFormat(render, { markdown, getPage: () => ({ extension: '.html' }) });
        ctx.expect(forHtml('hello')).toBe('hello');

        ctx.expect(forMd(null)).toBe('');
      },
    },
  ],
});
