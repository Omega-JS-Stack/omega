/**
 * Where the connections callback page lands
 * ([#784](https://github.com/Omega-JS-Stack/omega/issues/784)).
 *
 * The page used to hardcode `/dashboard/account#connections` on both of its
 * exits, so a brand page that started a connect from its own surface — the
 * issue's case is a dashboard listing the platform connections — could never
 * get the visitor back to it. `authorize` takes a `returnUrl` path now, it rides
 * the encrypted state, and `tokenize` answers it; this suite is the browser
 * half: the page lands on what came back, and only when it is a path on this
 * site.
 *
 * The re-check is not redundant with the backend's. That value arrives over the
 * wire and is assigned to `location`, so the page proves it is a path itself
 * before it navigates — the same rule, in the one place that does the navigating.
 *
 * Same convention as wakeup-ping.test.js: the REAL page module through esbuild
 * behind its bundler aliases, with the client stubbed at its boundary.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const PAGE = path.join(CORE_DIR, 'js', 'pages', 'connections', 'callback', 'index.js');
const DEFAULT_LANDING = '/dashboard/account#connections';
const RETURN_URL = '/dashboard/channels?tab=live#connections';

// Every shape the backend refuses on the way in, refused again on the way out:
// each one is a way of leaving the site with something that reads like a path.
const OFF_SITE = [
  'https://evil.test/steal',
  '//evil.test/steal',
  '/\\evil.test/steal',
  ' /dashboard/channels',
  'javascript:alert(1)',
];

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-connections-return-'));
const BUNDLE = path.join(BUNDLE_DIR, 'callback.cjs');

let building = null;

// The callback page, bundled the way the site bundles it — with the client
// stubbed, because it does not exist off a page.
function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [PAGE],
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
        build.onResolve({ filter: /^@omega\.js\/client$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
      },
    }],
  }).then(() => BUNDLE);

  return building;
}

/** An inert element per id, so a test can read what the page wrote onto one. */
function makeDocument() {
  const elements = {};

  const element = () => ({
    href: '',
    value: '',
    textContent: '',
    dataset: {},
    style: {},
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    addEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  });

  const byId = (id) => {
    elements[id] ||= element();

    return elements[id];
  };

  return {
    elements,
    document: {
      readyState: 'complete',
      // No `data-omega-path-prefix`: the harness site is at the domain root, so
      // siteUrl() is a passthrough and the assertion reads the page's own value
      documentElement: element(),
      body: element(),
      head: element(),
      createElement: () => element(),
      getElementById: byId,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
  };
}

/**
 * Boot the REAL callback page against one tokenize answer and report where it
 * put the visitor.
 *
 * @param {object} options
 * @param {object} [options.answer] - what the tokenize POST resolves with
 * @param {Error} [options.rejection] - what it rejects with instead
 * @param {string} [options.search] - the query the provider came back with
 * @returns {Promise<object>} `navigations` (every location assignment) and the
 *   elements the page wrote to
 */
async function bootCallback({ answer, rejection, search = '?code=auth-code-784&state=encrypted-state' } = {}) {
  const bundle = await bundleOnce();
  const { document, elements } = makeDocument();
  const navigations = [];

  globalThis.window = {
    location: {
      search,
      origin: 'https://brand.test',
      get href() {
        return 'https://brand.test/connections/callback';
      },
      set href(value) {
        navigations.push(value);
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.document = document;
  globalThis.navigator = { userAgent: 'node', language: 'en-US' };

  globalThis.__omegaClient = {
    getApiUrl: () => 'https://api.test',
    dom: () => ({ ready: async () => {} }),
    // The page does its whole job inside this callback
    auth: () => ({ listen: (options, handler) => handler() }),
    request: async (url, options = {}) => {
      if (options.wakeup) {
        return {};
      }

      if (rejection) {
        throw rejection;
      }

      return answer;
    },
  };

  delete require.cache[require.resolve(bundle)];
  const page = require(bundle);

  await page.default();

  // The success exit navigates behind a 500ms beat, so the visitor sees the
  // confirmation before the page moves
  await new Promise((resolve) => setTimeout(resolve, 700));

  return { navigations, elements };
}

test('#784: a returned returnUrl is where the success exit lands', async () => {
  const { navigations } = await bootCallback({ answer: { success: true, returnUrl: RETURN_URL } });

  assert.deepStrictEqual(
    navigations,
    [RETURN_URL],
    'the page lands on the path the connect started from — query and hash included — and nowhere else',
  );
});

test('#784: an answer with no returnUrl keeps the default landing', async () => {
  const { navigations } = await bootCallback({ answer: { success: true } });

  assert.deepStrictEqual(navigations, [DEFAULT_LANDING], 'nothing named a destination, so the account page answers');
});

test('#784: an off-site returnUrl is refused and the default answers', async () => {
  for (const value of OFF_SITE) {
    const { navigations } = await bootCallback({ answer: { success: true, returnUrl: value } });

    assert.deepStrictEqual(
      navigations,
      [DEFAULT_LANDING],
      `${JSON.stringify(value)} never becomes a navigation — the page checks the wire's value itself`,
    );
  }
});

test('#784: the error exit offers the same landing the success exit would have', async () => {
  // The page's own guard on an answer that came back without success: the
  // destination was already read off it, so the way back is the way in.
  const { navigations, elements } = await bootCallback({
    answer: { success: false, message: 'Token exchange failed', returnUrl: RETURN_URL },
  });

  assert.deepStrictEqual(navigations, [], 'a failure never navigates on its own');
  assert.strictEqual(elements['return-button'].href, RETURN_URL, 'and the button back points where the connect started');
  assert.strictEqual(elements['error-message'].textContent, 'Token exchange failed', 'with the reason on the page');
});

test('#784: an error before any answer keeps the default landing', async () => {
  const { navigations, elements } = await bootCallback({ rejection: new Error('Invalid OAuth state') });

  assert.deepStrictEqual(navigations, [], 'still no navigation');
  assert.strictEqual(
    elements['return-button'].href,
    DEFAULT_LANDING,
    'nothing ever named a destination, so the page invents none',
  );
});

test('#784: a provider that denied the authorization keeps the default landing', async () => {
  const { navigations, elements } = await bootCallback({ search: '?error=access_denied&error_description=Denied' });

  assert.deepStrictEqual(navigations, []);
  assert.strictEqual(elements['return-button'].href, DEFAULT_LANDING, 'the tokenize call never ran, so there is no path to land on');
  assert.strictEqual(elements['error-message'].textContent, 'Denied', 'and the provider’s own reason is what the page says');
});
