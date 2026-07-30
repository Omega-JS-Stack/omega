// Build-layer pin for the extension's click-trigger wiring (#16).
//
// `omega-signin` and `omega-account` are the extension's OWN triggers (only an
// extension opens a brand page in a tab), registered on @omega.js/client's shared
// registry instead of the delegated `document` click listener auth-helpers used
// to roll itself. auth-helpers.js is a browser-context ES module (it imports the
// client by bare specifier), so the wiring is pinned by SOURCE — the same model
// as global-handlers / cache-warming / verts-binding.
//
// The whole class of regression is covered, not just the rename: a legacy class
// name anywhere in the source, or a hand-rolled listener coming back, both fail.

const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, '..', '..', '..');
const AUTH_HELPERS = fs.readFileSync(path.join(SRC, 'lib', 'auth-helpers.js'), 'utf8');
const LEGACY_CLASSES = ['auth-signin-btn', 'auth-signout-btn', 'uj-password-toggle'];

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'click triggers: omega-signin / omega-account ride the shared registry (#16, #122)',
  tests: [
    {
      name: 'setupAuthEventListeners registers the `signin` trigger, no hand-rolled listener',
      run: (ctx) => {
        ctx.expect(AUTH_HELPERS.includes("import { registerTrigger } from '@omega.js/client/modules/triggers.js'")).toBe(true);

        const fnSource = AUTH_HELPERS.slice(AUTH_HELPERS.indexOf('export function setupAuthEventListeners'));
        ctx.expect(fnSource.includes("registerTrigger('signin'")).toBe(true);
        ctx.expect(fnSource.includes('openAuthPage(context)')).toBe(true);
        // The trigger class is the registry's to spell — never written by hand.
        ctx.expect(fnSource.includes('omega-signin')).toBe(false);
        ctx.expect(fnSource.includes('addEventListener')).toBe(false);
      },
    },
    {
      name: 'setupAuthEventListeners registers the `account` trigger, opening /account on the brand site',
      run: (ctx) => {
        const fnSource = AUTH_HELPERS.slice(AUTH_HELPERS.indexOf('export function setupAuthEventListeners'));
        ctx.expect(fnSource.includes("registerTrigger('account'")).toBe(true);
        // Same resolver as signin: brand.url + tabs.create, only the path differs.
        ctx.expect(fnSource.includes("openAuthPage(context, { path: '/account' })")).toBe(true);
        // The trigger class is the registry's to spell — never written by hand.
        ctx.expect(fnSource.includes('omega-account')).toBe(false);
      },
    },
    {
      name: 'no legacy trigger class survives anywhere in the extension source',
      run: (ctx) => {
        const offenders = [];
        for (const entry of fs.readdirSync(SRC, { recursive: true, withFileTypes: true })) {
          if (!entry.isFile() || !/\.(js|html)$/.test(entry.name)) { continue; }
          const file = path.join(entry.parentPath, entry.name);
          // The framework's own sources only — `defaults/` is consumer scaffold
          // markup and is swept the same way. Skipped: node_modules (not ours),
          // and this suite tree (it NAMES the retired classes on purpose).
          if (file.includes(`${path.sep}node_modules${path.sep}`)) { continue; }
          if (file.startsWith(path.join(SRC, 'test') + path.sep)) { continue; }
          const contents = fs.readFileSync(file, 'utf8');
          for (const name of LEGACY_CLASSES) {
            if (contents.includes(name)) { offenders.push(`${path.relative(SRC, file)} → ${name}`); }
          }
        }
        ctx.expect(offenders).toEqual([]);
      },
    },
  ],
};
