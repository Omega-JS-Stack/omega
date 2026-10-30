/**
 * The palette signs a persona in at `<localpart>@<brand host>`, the host config's
 * case table names for the same config (no host known: the page's hostname).
 * Harness as dev-palette.test.js: the REAL module through esbuild, client stubbed.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { User } = require('@omega.js/account');

const CASES = require('../../config/test/_brand-host-cases.js');

const CORE_DIR = path.join(__dirname, '..', 'core');
const PALETTE = path.join(CORE_DIR, 'js', 'core', 'dev-palette.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dev-palette-domain-'));
const BUNDLE = path.join(BUNDLE_DIR, 'dev-palette.cjs');

// The page the palette runs on: its hostname is the fallback when no brand host resolves.
const PAGE_HOSTNAME = 'localhost';
const PERSONA = '_test.premium-active';

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [PALETTE],
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
      },
    }],
  });

  return building;
}

/** The minimum element the palette builds with: children, text, listeners. */
function makeElement(tagName) {
  const element = {
    tagName,
    children: [],
    className: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    value: '',
    dataset: {},
    style: {},
    attributes: {},
    listeners: {},
    append: (...nodes) => element.children.push(...nodes),
    appendChild: (node) => { element.children.push(node); return node; },
    replaceChildren: (...nodes) => { element.children = nodes; },
    setAttribute: (name, value) => { element.attributes[name] = value; },
    getAttribute: (name) => (name in element.attributes ? element.attributes[name] : null),
    addEventListener: (type, handler) => { (element.listeners[type] ||= []).push(handler); },
    click: () => Promise.all((element.listeners.click || []).map((handler) => handler())),
    change: () => Promise.all((element.listeners.change || []).map((handler) => handler())),
  };

  return element;
}

/** Every element in the tree, depth-first. */
function flatten(node) {
  return (node.children || []).flatMap((child) => [child, ...flatten(child)]);
}

/** Boot the real palette on `config`, switch to the persona, and hand back the sign-ins it made. */
async function signInAs(config) {
  await bundleOnce();

  const signIns = [];
  const storage = {};

  globalThis.document = {
    head: makeElement('head'),
    body: makeElement('body'),
    createElement: (tagName) => makeElement(tagName),
    querySelector: () => null,
    addEventListener: () => {},
  };
  globalThis.window = {
    location: { hostname: PAGE_HOSTNAME, pathname: '/', search: '', reload: () => {} },
    setTimeout: () => {},
  };
  globalThis.__omegaClient = {
    config,
    auth: {
      user: new User(),
      listen: () => {},
      signInWithEmailAndPassword: async (email, password) => { signIns.push({ email, password }); },
    },
    storage: {
      get: (keyPath, defaultValue) => (keyPath ? (storage[keyPath] ?? defaultValue) : storage),
      set: (keyPath, value) => { storage[keyPath] = value; },
      remove: (keyPath) => { delete storage[keyPath]; },
      clear: () => { Object.keys(storage).forEach((key) => delete storage[key]); },
    },
    request: async () => ({ personas: [{ localpart: PERSONA, label: 'Premium' }] }),
  };

  // The cache is keyed by the real path (macOS's tmpdir is a symlink), and a
  // fresh require gives each boot its own module state.
  delete require.cache[require.resolve(BUNDLE)];
  require(BUNDLE).default();
  await new Promise((resolve) => setImmediate(resolve));

  const dropdown = flatten(globalThis.document.body).find((element) => element.tagName === 'select');
  dropdown.value = PERSONA;
  await dropdown.change();

  return signIns;
}

module.exports = defineCases({
  type: 'group',
  description: 'dev-palette persona domain',
  tests: [
    {
      name: 'the palette signs a persona in on the host resolvedBrandHost answers, for every row of the shared table',
      run: async (ctx) => {
        for (const row of CASES) {
          const signIns = await signInAs(row.config);
          const host = row.host || PAGE_HOSTNAME;

          ctx.expect(signIns.map((entry) => entry.email), `${row.name}: signs in at ${host}`).toEqual([`${PERSONA}@${host}`]);
        }
      },
    },
  ],
});
