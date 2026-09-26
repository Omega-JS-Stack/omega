// Build-layer pin for the verts auto-bind (ads-system phase 4): the page
// contexts (popup/options/sidepanel/page, ONE class in page-context.js) wire
// lib/verts.js after the client boots, the binder pins the house lane (extension surfaces
// never run AdSense: store policy + MV3 CSP), the client subset carries
// advertising/company through to the client, and content/background/
// offscreen deliberately do NOT bind. Surface files are browser-context ES
// modules (window/chrome at module scope), so this pins the SOURCE text
// rather than importing them — same model as cache-warming.test.js. The
// binder's runtime behavior (lazy mount, ladder, no-fill) is pinned in
// @omega.js/client's own suite (client test/verts.test.js).

const fs = require('fs');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...segments) => fs.readFileSync(path.join(ROOT, ...segments), 'utf8');

const SURFACES = ['popup.js', 'options.js', 'sidepanel.js', 'page.js'];
const PAGE_CONTEXT = read('page-context.js');
const NON_SURFACES = ['content.js', 'background.js', 'offscreen.js'];
const VERTS_LIB = read('lib', 'verts.js');
// What the baked snapshot may carry is @omega.js/config's declaration since
// [#894](https://github.com/Omega-JS-Stack/omega/issues/894): one row per
// section, read by all three browser bakes.
const { CLIENT_SECTIONS } = require('@omega.js/config');

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'verts auto-bind — surface wiring + house-lane pin + build-JSON plumbing',
  tests: [
    {
      name: 'every page surface is the page class, which calls wireAds(this) after the client boots',
      run: (ctx) => {
        for (const surface of SURFACES) {
          ctx.expect(read(surface)).toMatch(/import \{ Omega \} from '\.\/page-context\.js';/);
        }
        ctx.expect(PAGE_CONTEXT).toMatch(/import \{ wireAds \} from '\.\/lib\/verts\.js';/);
        // The call sits inside initialize(), after the client boot
        ctx.expect(/await super\.initialize\(window\.OMEGA_BUILD_JSON\?\.config\);[\s\S]*wireAds\(this\);/.test(PAGE_CONTEXT)).toBe(true);
      },
    },
    {
      name: 'content/background/offscreen do NOT auto-bind (host-DOM / no-DOM contexts)',
      run: (ctx) => {
        for (const context of NON_SURFACES) {
          ctx.expect(read(context).includes('wireAds')).toBe(false);
          ctx.expect(read(context).includes('page-context.js')).toBe(false);
        }
      },
    },
    {
      name: 'the binder pins the house lane — mount() type override, no AdSense path',
      run: (ctx) => {
        ctx.expect(VERTS_LIB).toMatch(/omega\.verts\.mount\(\$el, \{ type: 'house' \}\);/);
        // The instance arrives as the argument: no singleton import
        ctx.expect(VERTS_LIB.includes("from '@omega.js/client'")).toBe(false);
        // The wiring marks bound hosts for observability (tests + debugging)
        ctx.expect(VERTS_LIB).toMatch(/data-omega-vert-bound/);
        // Live binding: new [data-omega-vert] elements mount on arrival
        ctx.expect(VERTS_LIB).toMatch(/new MutationObserver\(/);
      },
    },
    {
      name: 'the client subset carries advertising + company (the house lane\'s config)',
      run: (ctx) => {
        // The inhouse source 'company' derives its api URL from company.url, so
        // both sections have to reach a browser: one schema row each, and the
        // bake test (build/build-json-bake) proves the artifact carries them.
        ctx.expect(CLIENT_SECTIONS.advertising).toBe(true);
        ctx.expect(CLIENT_SECTIONS.company).toBe(true);
      },
    },
  ],
});
