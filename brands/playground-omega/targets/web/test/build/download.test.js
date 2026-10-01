/**
 * Built output: /download carries the brand name and a link to every desktop
 * installer this brand releases, each from the derived releases repo
 * (`<brand.id>-releases`) under its versionless asset name.
 *
 * Reads dist/, which `omega test` builds before it runs this suite (or run
 * `omega build` first when calling node --test directly).
 *
 *   node --test test/build/download.test.js
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = path.join(__dirname, '..', '..', 'dist', 'download.html');
const LATEST = 'https://github.com/Omega-JS-Stack/playground-releases/releases/latest/download';

// The html minifier drops attribute quotes where it can, so the match allows both spellings
const href = (url) => new RegExp(`href=["']?${url.replace(/[.?]/g, '\\$&')}["' >]`);

test('/download names the brand', () => {
  assert.match(fs.readFileSync(PAGE, 'utf8'), /<title>Download - OMEGA Playground<\/title>/);
});

test('/download links every desktop installer', () => {
  const html = fs.readFileSync(PAGE, 'utf8');

  for (const asset of [
    'OMEGA-Playground-mac-dmg.dmg',
    'OMEGA-Playground-windows-nsis.exe',
    'OMEGA-Playground-linux-deb.deb',
    'OMEGA-Playground-linux-appimage.AppImage',
  ]) {
    assert.match(html, href(`${LATEST}/${asset}`), `${asset} is linked`);
  }
});
