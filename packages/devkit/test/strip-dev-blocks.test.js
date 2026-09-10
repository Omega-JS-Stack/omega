// Unit tests for src/strip-dev-blocks.js — the ONE home of the `@dev-only` marker
// contract (#18). Every framework's bundle lane cuts through this via the esbuild
// plugin src/strip-dev-blocks-plugin.js, so the marker TEXT is part of the
// contract: every source file in the ecosystem writes those exact comments.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripDevBlocks, START_MARKER, END_MARKER } = require('../src/strip-dev-blocks');

test('the markers are the exact comment text every framework source writes', () => {
  assert.equal(START_MARKER, '/* @dev-only:start */');
  assert.equal(END_MARKER, '/* @dev-only:end */');
});

test('removes every marked block, leaves the rest', () => {
  const source = [
    'const keep = 1;',
    START_MARKER,
    'const devWarningOne = "DEV_ONLY_SENTINEL_A";',
    END_MARKER,
    'const alsoKeep = 2;',
    `${START_MARKER} const devTwo = "DEV_ONLY_SENTINEL_B"; ${END_MARKER}`,
  ].join('\n');

  const out = stripDevBlocks(source);
  assert.match(out, /const keep = 1;/);
  assert.match(out, /const alsoKeep = 2;/);
  assert.doesNotMatch(out, /DEV_ONLY_SENTINEL_A/);
  assert.doesNotMatch(out, /DEV_ONLY_SENTINEL_B/);
});

test('source without markers is returned unchanged', () => {
  const source = 'const untouched = true;\n';
  assert.equal(stripDevBlocks(source), source);
});

test('an unterminated block is left alone rather than swallowing the rest of the file', () => {
  const source = `${START_MARKER}\nconst dangling = 1;\nconst tail = 2;\n`;
  assert.equal(stripDevBlocks(source), source);
});
