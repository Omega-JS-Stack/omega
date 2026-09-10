/**
 * The account page's CONNECT button while the browser is leaving
 * ([#797](https://github.com/Omega-JS-Stack/omega/issues/797)).
 *
 * `handleConnect()` used to set `location.href` and RETURN. FormManager reads a
 * resolved submit callback as success, so with the default `allowResubmit` it
 * flipped the form back to `ready`, re-enabled the controls, and the
 * `statechange` listener redrew the card with a clickable Connect. Navigation
 * is asynchronous, so the visitor saw Connect come back before the provider's
 * page appeared and clicked it a second time. The connect path never resolves
 * now: the form stays `submitting` until the page unloads.
 *
 * The REAL FormManager runs here, because the bug lives in the interaction
 * between the page's submit handler and the state machine that calls it. Only
 * the client SINGLETON is stubbed, at the boundary the page imports it from
 * (the convention connections-return.test.js and connections-cards.test.js
 * set). Node has no DOM and web pulls in no jsdom, so the document is
 * hand-rolled to what FormManager and the section actually touch, with the
 * card ids and the form markup the base theme's connection-card include
 * renders.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const CONNECTIONS_ENTRY = path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'sections', 'connections.js');
// Where the REAL FormManager lives, so its own `../index.js` reach for the
// client singleton can be pointed at the harness stub without dragging the
// whole runtime (and firebase) into the bundle.
const CLIENT_MODULES_DIR = path.dirname(require.resolve('@omega.js/client/modules/form-manager.js'));

const PROVIDER = 'twitch';
const AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize?x=1';
const CONNECTIONS_CONFIG = {
  [PROVIDER]: { enabled: true, name: 'Twitch', logo: 'twitch', description: 'Connect your Twitch account' },
};

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-connections-connect-state-'));
const BUNDLE = path.join(BUNDLE_DIR, 'connections.cjs');

let building = null;

// The section, bundled the way the site bundles it: the page's aliases, the
// real FormManager, and the client answering from globalThis at require time.
function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [CONNECTIONS_ENTRY],
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
        // The client's own modules import the singleton as `../index.js`
        build.onResolve({ filter: /^\.\.\/index\.js$/ }, (args) => {
          if (path.dirname(args.importer) !== CLIENT_MODULES_DIR) {
            return null;
          }

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

/** One compound selector against one element: tags, classes, `[attr="value"]`. */
function matchesToken(element, token) {
  if (token.startsWith('#')) {
    return element.id === token.slice(1);
  }

  if (token.startsWith('.')) {
    return element.classes.has(token.slice(1));
  }

  if (token.startsWith('[')) {
    const [, name, , value] = token.match(/^\[([^\]=]+)(="([^"]*)")?\]$/);
    const actual = name in element.attributes ? element.attributes[name] : element[name];

    return value === undefined ? actual !== undefined && actual !== null : `${actual}` === value;
  }

  return element.tag === token;
}

/** Every selector FormManager and the section use is a comma-separated list. */
function matchesSelector(element, selector) {
  return selector.split(',').some((part) => {
    return part.trim().split(/(?=[.#[])/).every((token) => matchesToken(element, token));
  });
}

/** An element with the surface the section and FormManager reach for. */
function makeElement(tag, attributes = {}) {
  const classes = new Set((attributes.class || '').split(' ').filter(Boolean));
  const listeners = {};

  const element = {
    tag,
    classes,
    attributes: { ...attributes },
    id: attributes.id || '',
    name: attributes.name || '',
    type: attributes.type || '',
    value: attributes.value || '',
    // The markup the include renders for a button: what FormManager saves
    // before it writes the spinner, and restores after.
    innerHTML: attributes.innerHTML || '',
    textContent: '',
    disabled: false,
    isConnected: true,
    children: [],
    dataset: {},
    style: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    getAttribute: (name) => (name in element.attributes ? element.attributes[name] : null),
    setAttribute: (name, value) => { element.attributes[name] = value; },
    hasAttribute: (name) => name in element.attributes,
    matches: (selector) => matchesSelector(element, selector),
    querySelector: (selector) => element.children.find((child) => matchesSelector(child, selector)) || null,
    querySelectorAll: (selector) => element.children.filter((child) => matchesSelector(child, selector)),
    addEventListener: (type, handler) => { (listeners[type] ||= []).push(handler); },
    dispatchEvent: (event) => { (listeners[event.type] || []).forEach((handler) => handler(event)); },
    appendChild: (child) => element.children.push(child),
    focus: () => {},
    scrollIntoView: () => {},
    reset: () => {},
  };

  return element;
}

/**
 * The account page as the base theme renders it for one provider: the section's
 * three list elements, the card, and the connection form with the two submit
 * buttons the include draws.
 */
function makeDocument() {
  const elements = {};

  const add = (tag, attributes) => {
    const element = makeElement(tag, attributes);

    if (element.id) {
      elements[element.id] = element;
    }

    return element;
  };

  add('div', { id: 'connections-list' });
  add('div', { id: 'connections-loading' });
  add('div', { id: 'connections-empty', class: 'd-none' });
  add('div', { id: `connection-${PROVIDER}`, class: 'd-none' });
  add('small', { id: `${PROVIDER}-connection-status` });
  add('small', { id: `${PROVIDER}-connection-description` });

  const $form = add('form', { id: `connection-form-${PROVIDER}`, novalidate: '', 'data-form-state': 'initializing' });

  $form.children.push(
    makeElement('input', { type: 'hidden', name: 'provider', value: PROVIDER }),
    makeElement('button', {
      type: 'submit',
      'data-action': 'connect',
      class: 'btn btn-sm btn-adaptive',
      innerHTML: '<i class="fa-solid fa-link fa-sm"></i><span class="button-text">Connect</span>',
    }),
    makeElement('button', {
      type: 'submit',
      'data-action': 'disconnect',
      class: 'btn btn-sm btn-outline-danger d-none',
      innerHTML: '<i class="fa-solid fa-unlink fa-sm"></i><span class="button-text">Disconnect</span>',
    }),
  );

  const all = () => [...Object.values(elements), ...$form.children];

  globalThis.document = {
    readyState: 'complete',
    getElementById: (id) => elements[id] || null,
    querySelector: (selector) => all().find((element) => matchesSelector(element, selector)) || null,
    querySelectorAll: (selector) => all().filter((element) => matchesSelector(element, selector)),
    createElement: (tag) => makeElement(tag),
    addEventListener: () => {},
  };

  return { elements, $form };
}

/** A beat long enough for every microtask the submit path chains to settle. */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Boot the REAL section over the hand-rolled card, with an authorize answer
 * waiting, and hand back the form, its Connect button, and the location the
 * page assigned.
 */
async function bootConnections() {
  const bundle = await bundleOnce();
  const { $form } = makeDocument();
  const windowListeners = {};

  // A plain settable stand-in for location: the assignment is the assertion,
  // and node has nothing to navigate
  const location = {
    search: '',
    origin: 'https://brand.test',
    href: 'https://brand.test/dashboard/account',
  };

  globalThis.window = {
    location,
    addEventListener: (type, handler) => { (windowListeners[type] ||= []).push(handler); },
    removeEventListener: () => {},
  };

  globalThis.navigator = { userAgent: 'node', language: 'en-US' };
  globalThis.__omegaClient = {
    getApiUrl: () => 'https://api.test',
    utilities: () => ({
      escapeHTML: (value) => `${value}`,
      getDevice: () => 'desktop',
      showNotification: () => {},
    }),
    request: async () => ({ url: AUTHORIZE_URL }),
  };

  delete require.cache[require.resolve(bundle)];
  const section = require(bundle);

  await section.init();
  await section.loadData({}, CONNECTIONS_CONFIG);

  // The form arms itself behind the client's dom ready promise
  await tick();

  const $connect = $form.querySelector('button[data-action="connect"]');

  return {
    $form,
    $connect,
    location,
    /** What the browser does to the page: the visitor clicked Connect. */
    submit: async () => {
      $form.dispatchEvent({ type: 'submit', submitter: $connect, preventDefault: () => {} });
      await tick();
      await tick();
    },
    /** The page coming back out of the back-forward cache. */
    restore: async () => {
      (windowListeners.pageshow || []).forEach((handler) => handler({ type: 'pageshow', persisted: true }));
      await tick();
    },
  };
}

test('#797: the Connect button stays disabled while the browser is leaving for the provider', async () => {
  const { $form, $connect, location, submit } = await bootConnections();

  assert.strictEqual($form.getAttribute('data-form-state'), 'ready', 'the card starts with a clickable Connect');

  await submit();

  assert.strictEqual(location.href, AUTHORIZE_URL, 'the click sent the visitor to the provider');
  assert.strictEqual($form.getAttribute('data-form-state'), 'submitting', 'and the form is still submitting, because the page is on its way out');
  assert.strictEqual($connect.disabled, true, 'so the button cannot be clicked a second time');
  assert.ok($connect.innerHTML.includes('Connecting...'), `and it still says what is happening: ${$connect.innerHTML}`);
});

test('#797: the back button lands on a usable form', async () => {
  const { $form, $connect, submit, restore } = await bootConnections();

  await submit();
  await restore();

  assert.strictEqual($form.getAttribute('data-form-state'), 'ready', 'a page restored from the back-forward cache resets the form FormManager left submitting');
  assert.strictEqual($connect.disabled, false, 'the button is clickable again');
  assert.ok($connect.innerHTML.includes('>Connect<'), `and it says Connect again: ${$connect.innerHTML}`);
});
