/**
 * Built output: /download carries the brand name and a link to every desktop
 * installer this brand releases, each from the derived releases repo
 * (`<brand.id>-releases`) under its versionless asset name.
 *
 * Reads dist/, which `omega test` builds before it runs this suite (or run
 * `omega build` first when calling node --test directly).
 *
 * Run (from this target): npx omega test build/download
 */
const { defineCases } = require('@omega.js/web/test');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = path.join(__dirname, '..', '..', 'dist', 'download.html');
const LATEST = 'https://github.com/Omega-JS-Stack/playground-releases/releases/latest/download';

// The html minifier drops attribute quotes where it can, so the match allows both spellings
const href = (url) => new RegExp(`href=["']?${url.replace(/[.?]/g, '\\$&')}["' >]`);

module.exports = defineCases({
  type: 'group',
  description: 'download',
  tests: [
    {
      name: '/download names the brand',
      run: (ctx) => {
        ctx.expect(fs.readFileSync(PAGE, 'utf8')).toMatch(/<title>Download - OMEGA Playground<\/title>/);
      },
    },

    {
      name: '/download links every desktop installer',
      run: (ctx) => {
        const html = fs.readFileSync(PAGE, 'utf8');

        for (const asset of [
          'OMEGA-Playground-mac-dmg.dmg',
          'OMEGA-Playground-windows-nsis.exe',
          'OMEGA-Playground-linux-deb.deb',
          'OMEGA-Playground-linux-appimage.AppImage',
        ]) {
          ctx.expect(html, `${asset} is linked`).toMatch(href(`${LATEST}/${asset}`));
        }
      },
    },
  ],
});
