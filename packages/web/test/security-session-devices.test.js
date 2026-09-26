/**
 * The account page's ACTIVE SESSIONS list (`core/js/pages/dashboard/account/
 * sections/security.js`) and the device mark it draws per session
 * ([#929](https://github.com/Omega-JS-Stack/omega/issues/929)).
 *
 * The builder's device map carries the FULL Font Awesome class string and the
 * emit adds only the size, so a platform mark lands in the brands family: the
 * old `fa-solid fa-${name}` wrap asked the solid family for `apple`, which has
 * no such glyph, and the session row drew nothing at all.
 *
 * Same harness as billing-usage-bars.test.js: the REAL module through esbuild
 * behind its bundler aliases, over a document that answers only the ids the
 * section writes, and the assertion is the HTML it wrote.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { User } = require('@omega.js/account');

// A seeded persona as the page receives it: the stored document built into a User
const persona = (document) => new User(document, { uid: 'u1' });

const CORE_DIR = path.join(__dirname, '..', 'core');
const SECURITY_ENTRY = path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'sections', 'security.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-security-devices-'));
const BUNDLE = path.join(BUNDLE_DIR, 'security.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [SECURITY_ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          return { path: path.join(CORE_DIR, args.path.slice('__main_assets__/'.length)) };
        });
        build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/form-manager\.js$/ }, () => {
          return { path: 'form-manager', namespace: 'omega-form-manager-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-form-manager-stub' }, () => {
          return { contents: 'export class FormManager {}' };
        });
      },
    }],
  });

  return building;
}

function makeElement() {
  return { innerHTML: '', textContent: '', listeners: {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
}

/** Render the sessions list for one signed-in client and hand back the HTML it wrote. */
async function renderSessions(client) {
  await bundleOnce();

  const list = makeElement();
  globalThis.document = {
    getElementById: (id) => (id === 'active-sessions-list' ? list : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  globalThis.window = { location: { search: '', href: 'https://x.test/account' }, history: { replaceState() {} }, addEventListener() {} };
  globalThis.__omegaClient = {
    auth: { user: new User() },
    utilities: { showNotification: () => {}, escapeHTML: (value) => `${value}` },
  };

  delete require.cache[require.resolve(BUNDLE)];
  const security = require(BUNDLE);

  security.loadData(persona({
    activity: {
      client: { userAgent: client.userAgent, platform: client.platform },
      created: { timestamp: '2026-01-01T00:00:00.000Z', timestampUNIX: 1767225600 },
    },
  }));

  return list.innerHTML;
}

test('#929: a platform session draws the BRAND mark, the family a bare name could never reach', async () => {
  const html = await renderSessions({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'macOS' });

  assert.match(html, /<i class="fa-brands fa-apple fa-xl"><\/i>/, 'the map\'s class string is emitted verbatim');
  assert.ok(!html.includes('fa-solid fa-apple'), 'the solid family carries no apple glyph, so the old wrap drew nothing');
});

test('#929: an unrecognized platform keeps the solid default, class string and all', async () => {
  const html = await renderSessions({ userAgent: 'Mozilla/5.0 (Unknown)', platform: 'FreeBSD' });

  assert.match(html, /<i class="fa-solid fa-desktop fa-xl"><\/i>/, 'the default is one class string too');
  assert.ok(!html.includes('fa-fa-'), 'and nothing wraps it a second time');
});
