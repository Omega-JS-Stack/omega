/**
 * renderTokens / unresolvedTokens / unresolvedTokensError: the one `{{ path }}`
 * renderer the desktop and extension builds share, the leftover check each
 * build fails on, and the error it fails with.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { renderTokens, unresolvedTokens, unresolvedTokensError } = require('../src/tokens.js');

module.exports = defineCases({
  type: 'group',
  description: 'tokens',
  tests: [
    {
      name: 'a {{ path }} token renders its value, dot paths included',
      run: (ctx) => {
        ctx.expect(renderTokens('<h1>{{ brand.name }}</h1>', { brand: { name: 'Paperloom' } })).toBe('<h1>Paperloom</h1>');
        ctx.expect(renderTokens('{{brand.name}} v{{ app.version }}', { brand: { name: 'Paperloom' }, app: { version: '3.1.4' } })).toBe('Paperloom v3.1.4');
      },
    },

    {
      name: 'a token nothing resolves stays as written, and a falsy value still renders',
      run: (ctx) => {
        ctx.expect(renderTokens('Hi {{ missing }}!', { brand: {} })).toBe('Hi {{ missing }}!');
        ctx.expect(renderTokens('[{{ empty }}|{{ zero }}]', { empty: '', zero: 0 })).toBe('[|0]');
      },
    },

    {
      name: 'other bracket idioms pass through untouched',
      run: (ctx) => {
        const text = 'v%%%version%%% [name] ${{ secrets.TOKEN }}';
        ctx.expect(renderTokens(text, { version: '1', name: 'x' })).toBe('v%%%version%%% [name] ${{ secrets.TOKEN }}');
      },
    },

    {
      name: 'unresolvedTokens names each leftover once, as written',
      run: (ctx) => {
        const rendered = renderTokens('{{ brand.name }} {{ missing }} {{ missing }} {{other.key}}', { brand: { name: 'P' } });
        ctx.expect(unresolvedTokens(rendered)).toEqual(['{{ missing }}', '{{other.key}}']);
      },
    },

    {
      name: 'fully rendered text has no leftovers',
      run: (ctx) => {
        ctx.expect(unresolvedTokens(renderTokens('{{ brand.name }}', { brand: { name: 'P' } }))).toEqual([]);
        ctx.expect(unresolvedTokens('')).toEqual([]);
      },
    },

    {
      name: 'unresolvedTokensError names the view, each leftover, and where to look',
      run: (ctx) => {
        const err = unresolvedTokensError('src/views/main/index.html', ['{{ missing }}', '{{other.key}}']);
        ctx.expect(err instanceof Error).toBe(true);
        ctx.expect(err.message).toBe('Cannot build src/views/main/index.html: unresolved token(s) {{ missing }}, {{other.key}}. Check config/omega.json5 and the token spelling');
      },
    },
  ],
});
