/**
 * The one spelling of a config path: keys joined with `.`, a list position in
 * brackets. keyPath and itemPath build it, pathSteps alone reads it back.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { keyPath, itemPath, pathSteps, spellSteps } = require('../src/paths.js');

module.exports = defineCases({
  type: 'group',
  description: 'paths',
  tests: [
    {
      name: 'keyPath: a key at the root is the key alone, under a parent it joins with a dot',
      run: (ctx) => {
        ctx.expect(keyPath('', 'seo')).toBe('seo');
        ctx.expect(keyPath('seo.github', 'content')).toBe('seo.github.content');
      },
    },

    {
      name: 'itemPath: a list position is spelled in brackets',
      run: (ctx) => {
        ctx.expect(itemPath('seo.github.content', 0)).toBe('seo.github.content[0]');
      },
    },

    {
      name: 'pathSteps: a bracketed position reads back as a number step',
      run: (ctx) => {
        ctx.expect(pathSteps('seo.github.content[0].org')).toEqual(['seo', 'github', 'content', 0, 'org']);
      },
    },

    {
      name: 'the builders and the parser round-trip',
      run: (ctx) => {
        const built = keyPath(itemPath(keyPath(keyPath(keyPath('', 'seo'), 'github'), 'content'), 0), 'org');

        ctx.expect(built).toBe('seo.github.content[0].org');
        ctx.expect(pathSteps(built)).toEqual(['seo', 'github', 'content', 0, 'org']);
        ctx.expect(spellSteps(['seo', 'github', 'content', 0, 'org'])).toBe(built);

        // A path with no position: its steps join back to the same path
        ctx.expect(pathSteps('marketing.campaigns.enabled')).toEqual(['marketing', 'campaigns', 'enabled']);
        ctx.expect(pathSteps('marketing.campaigns.enabled').join('.')).toBe('marketing.campaigns.enabled');
      },
    },
  ],
});
