// Build-layer pin for the verts auto-bind (ads-system phase 4): every page
// surface (popup/options/sidepanel/page) wires lib/verts.js after
// omega.initialize(), the binder pins the house lane (extension surfaces
// never run AdSense — store policy + MV3 CSP), the build-JSON allowlist
// carries advertising/company through to the client, and content/background/
// offscreen deliberately do NOT bind. Surface files are browser-context ES
// modules (window/chrome at module scope), so this pins the SOURCE text
// rather than importing them — same model as cache-warming.test.js. The
// binder's runtime behavior (lazy mount, ladder, no-fill) is pinned in
// @omega.js/client's own suite (client test/verts.test.js).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...segments) => fs.readFileSync(path.join(ROOT, ...segments), 'utf8');

const SURFACES = ['popup.js', 'options.js', 'sidepanel.js', 'page.js'];
const NON_SURFACES = ['content.js', 'background.js', 'offscreen.js'];
const VERTS_LIB = read('lib', 'verts.js');
const PACKAGE_TASK = read('gulp', 'tasks', 'package.js');

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'verts auto-bind — surface wiring + house-lane pin + build-JSON plumbing',
  tests: [
    {
      name: 'every page surface imports and calls wireAds after omega.initialize()',
      run: (ctx) => {
        for (const surface of SURFACES) {
          const source = read(surface);
          ctx.expect(source).toMatch(/import \{ wireAds \} from '\.\/lib\/verts\.js';/);
          // The call sits inside initialize(), after the client boot
          ctx.expect(/await this\.omega\.initialize\(configuration\);[\s\S]*wireAds\(\);/.test(source)).toBe(true);
        }
      },
    },
    {
      name: 'content/background/offscreen do NOT auto-bind (host-DOM / no-DOM contexts)',
      run: (ctx) => {
        for (const context of NON_SURFACES) {
          ctx.expect(read(context).includes('wireAds')).toBe(false);
        }
      },
    },
    {
      name: 'the binder pins the house lane — mount() type override, no AdSense path',
      run: (ctx) => {
        ctx.expect(VERTS_LIB).toMatch(/omega\.verts\(\)\.mount\(\$el, \{ type: 'house' \}\);/);
        // The wiring marks bound hosts for observability (tests + debugging)
        ctx.expect(VERTS_LIB).toMatch(/data-omega-vert-bound/);
        // Live binding: new [data-omega-vert] elements mount on arrival
        ctx.expect(VERTS_LIB).toMatch(/new MutationObserver\(/);
      },
    },
    {
      name: 'build-JSON allowlist carries advertising + company to the client',
      run: (ctx) => {
        ctx.expect(PACKAGE_TASK).toMatch(/advertising: config\.advertising \|\| \{\},/);
        ctx.expect(PACKAGE_TASK).toMatch(/company: config\.company \|\| \{\},/);
      },
    },
  ],
};
