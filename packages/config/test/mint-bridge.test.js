/**
 * mint-bridge.js: the ONE list of minted files a site serves. The web build
 * copies them and the deploy snapshot carries them, so both read this list.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MINT_ROOT, MINT_BRIDGE, mintBridgeSources } = require('../src/index.js');

// Build a brand root holding the given brand-root relative files.
function brandWith(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-mint-bridge-'));
  for (const relative of files) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), 'minted');
  }
  return root;
}

// A folder source may be spelled with or without its trailing slash.
const bare = (sources) => sources.map((source) => source.replace(/\/$/, ''));

test('MINT_ROOT and MINT_BRIDGE name the minted folder and the four site paths (#1027)', () => {
  assert.equal(MINT_ROOT, '.omega/assets');
  assert.deepEqual(MINT_BRIDGE.map((entry) => entry.dest), [
    'assets/images/favicon',
    'assets/images/brand/brandmark.svg',
    'assets/images/brand/brandmark.png',
    'assets/images/brand/social.png',
  ]);
});

test('mintBridgeSources: every bridged source a full mint holds, brand-root relative (#1027)', () => {
  const root = brandWith([
    '.omega/assets/favicon/favicon.ico',
    '.omega/assets/favicon/site.webmanifest',
    '.omega/assets/logo/brandmark/color-x.svg',
    '.omega/assets/logo/brandmark/color-512.png',
    '.omega/assets/logo/brandmark/color-256.png',
    '.omega/assets/social/brandmark/color-1024.png',
  ]);

  assert.deepEqual(bare(mintBridgeSources(root)), [
    '.omega/assets/favicon',
    '.omega/assets/logo/brandmark/color-x.svg',
    '.omega/assets/logo/brandmark/color-512.png',
    '.omega/assets/social/brandmark/color-1024.png',
  ]);
});

test('mintBridgeSources: only the sources that exist, and none for a brand with no mint (#1027)', () => {
  const partial = brandWith(['.omega/assets/favicon/favicon.ico', '.omega/assets/logo/brandmark/color-512.png']);
  assert.deepEqual(bare(mintBridgeSources(partial)), ['.omega/assets/favicon', '.omega/assets/logo/brandmark/color-512.png']);

  assert.deepEqual(mintBridgeSources(brandWith(['.omega/state.json'])), []);
});
