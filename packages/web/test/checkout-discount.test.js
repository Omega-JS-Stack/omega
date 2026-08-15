/**
 * The checkout discount code, client end (`core/js/pages/payment/checkout/
 * modules/discount.js` + `modules/api.js`) — a code the server accepts must
 * land as an APPLIED discount, not as "Invalid discount code".
 *
 * The bug this pins: wonderful-fetch defaults `response` to `'raw'`, so a call
 * made without `response: 'json'` hands back the untouched Response and every
 * body property (`.valid`, `.percent`) reads `undefined` — so every code, valid
 * or not, fell into the invalid branch while the server logged `valid=true`.
 *
 * The modules are browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL files through esbuild —
 * the convention auth-policy.test.js and checkout-decline.test.js set — with
 * the client and wonderful-fetch stubbed. The fetch stub MODELS wonderful-fetch
 * rather than short-circuiting it: it returns a Response-shaped object unless
 * the caller asked for `response: 'json'`, which is what makes the parsing bug
 * reproducible here at all. The assertion is the discount UI state the bindings
 * would have rendered.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const MODULES_DIR = path.join(CORE_DIR, 'js', 'pages', 'payment', 'checkout', 'modules');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-checkout-discount-'));
const BUNDLE = path.join(BUNDLE_DIR, 'discount.cjs');

let building = null;

// One entry exporting both seams, so the REAL discount module and the REAL
// state module it mutates stay the same instance (a separate bundle each would
// hand the test a second, unrelated `state`).
function bundleOnce() {
  building ||= esbuild.build({
    stdin: {
      contents: [
        `export { applyDiscountCode } from './discount.js';`,
        `export { state } from './state.js';`,
      ].join('\n'),
      resolveDir: MODULES_DIR,
      loader: 'js',
    },
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
        build.onResolve({ filter: /^wonderful-fetch$/ }, () => {
          return { path: 'fetch', namespace: 'wonderful-fetch-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'wonderful-fetch-stub' }, () => {
          return { contents: 'export default (...args) => globalThis.__wonderfulFetch(...args);' };
        });
      },
    }],
  });

  return building;
}

/**
 * Apply one code against a stubbed server answer; hand back the discount UI
 * state, the mutated state, and the request the module actually made.
 */
async function applyCode(code, answer) {
  await bundleOnce();

  const calls = [];

  globalThis.window = { location: { search: '' } };
  globalThis.__omegaClient = {
    getApiUrl: () => 'https://api.test',
    auth: () => ({ getUser: () => null }),
  };
  globalThis.__wonderfulFetch = async (url, options = {}) => {
    calls.push({ url, options });

    // wonderful-fetch's own contract: `response` defaults to 'raw', and a raw
    // answer is the Response object — the body is only reachable via .json().
    if (options.response === 'json') {
      return answer;
    }

    return { ok: true, status: 200, headers: {}, json: async () => answer };
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const bundle = require(BUNDLE);

  const renders = [];
  await bundle.applyDiscountCode(code, () => renders.push(bundle.state.discountUI));

  return { ui: bundle.state.discountUI, state: bundle.state, calls, renders };
}

test('discount: a code the server accepts is applied, not rejected', async () => {
  const { ui, state } = await applyCode('save20', { valid: true, code: 'SAVE20', percent: 20 });

  assert.strictEqual(ui.success, true, 'a server answer of valid=true must reach the success state');
  assert.strictEqual(ui.error, false, 'and must never render the invalid message');
  assert.strictEqual(ui.message, 'Discount applied: 20% off', 'the percent comes off the parsed body');
  assert.strictEqual(state.discountCode, 'SAVE20', 'the applied code is what the intent call sends');
  assert.strictEqual(state.discountPercent, 20, 'and the percent is what the receipt rows price against');
});

test('discount: the validate call asks wonderful-fetch to parse the body', async () => {
  const { calls } = await applyCode('save20', { valid: true, code: 'SAVE20', percent: 20 });

  assert.strictEqual(calls.length, 1, 'one validation request per apply');
  assert.strictEqual(calls[0].url, 'https://api.test/omega/payments/discount', 'the discount route');
  assert.deepStrictEqual(calls[0].options.query, { code: 'SAVE20' }, 'the code is normalized before it is sent');
  assert.strictEqual(
    calls[0].options.response,
    'json',
    'without this wonderful-fetch returns the raw Response and .valid is undefined forever',
  );
});

test('discount: a code the server rejects still lands the error message', async () => {
  const { ui, state } = await applyCode('nope', { valid: false });

  assert.strictEqual(ui.error, true, 'an invalid code is still an error');
  assert.strictEqual(ui.success, false, 'and never a success');
  assert.strictEqual(ui.message, 'Invalid discount code', 'with the message the bindings show');
  assert.strictEqual(state.discountCode, null, 'nothing is carried into the intent call');
  assert.strictEqual(state.discountPercent, 0, 'and the receipt keeps full price');
});

test('discount: an empty code asks for one instead of calling the server', async () => {
  const { ui, calls } = await applyCode('   ', { valid: true, code: 'X', percent: 5 });

  assert.strictEqual(calls.length, 0, 'an empty field is answered locally');
  assert.strictEqual(ui.error, true, 'and reads as an error');
  assert.strictEqual(ui.message, 'Please enter a discount code', 'with the prompt, not the rejection');
});
