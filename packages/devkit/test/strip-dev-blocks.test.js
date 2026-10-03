// Unit tests for src/strip-dev-blocks.js — the ONE home of the `@dev-only` marker
// contract (#18). Every framework's bundle lane cuts through this via the esbuild
// plugin src/strip-dev-blocks-plugin.js, so the marker TEXT is part of the
// contract: every source file in the ecosystem writes those exact comments.

const defineCases = require('@omega.js/devkit/test/define-cases');
const { stripDevBlocks, START_MARKER, END_MARKER } = require('../src/strip-dev-blocks');

module.exports = defineCases({
  type: 'group',
  description: 'strip-dev-blocks',
  tests: [
    {
      name: 'the markers are the exact comment text every framework source writes',
      run: (ctx) => {
        ctx.expect(START_MARKER).toBe('/* @dev-only:start */');
        ctx.expect(END_MARKER).toBe('/* @dev-only:end */');
      },
    },

    {
      name: 'removes every marked block, leaves the rest',
      run: (ctx) => {
        const source = [
          'const keep = 1;',
          START_MARKER,
          'const devWarningOne = "DEV_ONLY_SENTINEL_A";',
          END_MARKER,
          'const alsoKeep = 2;',
          `${START_MARKER} const devTwo = "DEV_ONLY_SENTINEL_B"; ${END_MARKER}`,
        ].join('\n');

        const out = stripDevBlocks(source);
        ctx.expect(out).toMatch(/const keep = 1;/);
        ctx.expect(out).toMatch(/const alsoKeep = 2;/);
        ctx.expect(out).not.toMatch(/DEV_ONLY_SENTINEL_A/);
        ctx.expect(out).not.toMatch(/DEV_ONLY_SENTINEL_B/);
      },
    },

    {
      name: 'source without markers is returned unchanged',
      run: (ctx) => {
        const source = 'const untouched = true;\n';
        ctx.expect(stripDevBlocks(source)).toBe(source);
      },
    },

    {
      name: 'an unterminated block is left alone rather than swallowing the rest of the file',
      run: (ctx) => {
        const source = `${START_MARKER}\nconst dangling = 1;\nconst tail = 2;\n`;
        ctx.expect(stripDevBlocks(source)).toBe(source);
      },
    },
  ],
});
