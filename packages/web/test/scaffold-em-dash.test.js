/**
 * Every scaffold file is copied into a consumer's repo, whose own guard may
 * refuse an em dash (U+2014) at commit time. So no scaffold file carries one.
 */
const assert = require('node:assert');
const path = require('node:path');
const { test } = require('node:test');
const { dashedFiles } = require('@omega.js/devkit/test/dashed-files');

const SCAFFOLD = path.resolve(__dirname, '..', 'scaffold');

test('no scaffold file carries an em dash', () => {
  assert.deepStrictEqual(dashedFiles(SCAFFOLD), []);
});
