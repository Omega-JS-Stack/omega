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
const defineCases = require('@omega.js/devkit/test/define-cases');
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

/**
 * Render the sessions list for one signed-in client, plus the other sessions
 * the server reports, and hand back the HTML it wrote.
 *
 * @param {object} client - the current session's userAgent and platform
 * @param {object} [others] - the sessions answer, by session id
 * @returns {Promise<string>} the list's HTML
 */
async function renderSessions(client, others = {}) {
  await bundleOnce();

  const list = makeElement();
  let answered = null;

  globalThis.document = {
    getElementById: (id) => (id === 'active-sessions-list' ? list : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  globalThis.window = { location: { search: '', href: 'https://x.test/account' }, history: { replaceState() {} }, addEventListener() {} };
  globalThis.__omegaClient = {
    auth: { user: new User() },
    getApiUrl: () => 'https://api.test',
    request: (url) => {
      answered = Promise.resolve(url.endsWith('/omega/user/sessions') ? others : {});
      return answered;
    },
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

  // The list is written once the sessions answer has been read.
  await answered;
  await new Promise((resolve) => setImmediate(resolve));

  return list.innerHTML;
}

/** The one session row that carries `marker`. */
function rowWith(html, marker) {
  return html.split('<div class="px-0 py-3').find((row) => row.includes(marker)) || '';
}

module.exports = defineCases({
  type: 'group',
  description: 'security-session-devices',
  tests: [
    {
      name: 'another session on platform `mac` reads macOS and draws the apple brand mark',
      run: async (ctx) => {
        const html = await renderSessions(
          { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'windows' },
          { 'session-mac': { platform: 'mac', ip: '203.0.113.7', timestamp: '2026-01-02T00:00:00.000Z', timestampUNIX: 1767312000 } },
        );
        const row = rowWith(html, '203.0.113.7');

        ctx.expect(row, 'the other session has a row of its own').toBeTruthy();
        ctx.expect(row, 'the client\'s platform word reads as its label').toMatch(/<strong>macOS<\/strong>/);
        ctx.expect(row, 'and the mark is the brands-family apple, emitted verbatim').toMatch(/<i class="fa-brands fa-apple fa-xl"><\/i>/);
      },
    },

    {
      name: '#929: an unrecognized platform keeps the solid default, class string and all',
      run: async (ctx) => {
        const html = await renderSessions({ userAgent: 'Mozilla/5.0 (Unknown)', platform: 'FreeBSD' });

        ctx.expect(html, 'the default is one class string too').toMatch(/<i class="fa-solid fa-desktop fa-xl"><\/i>/);
        ctx.expect(!html.includes('fa-fa-'), 'and nothing wraps it a second time').toBeTruthy();
      },
    },
  ],
});
