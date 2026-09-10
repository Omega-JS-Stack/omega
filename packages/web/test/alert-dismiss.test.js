/**
 * The site alerts' dismiss ([#719](https://github.com/Omega-JS-Stack/omega/issues/719))
 * — pressing the × on a `.main-alert` actually closes it.
 *
 * #719 turned the dismiss into a real `<button>` so it is keyboard-reachable
 * and named, but nothing was listening: every alert `core/_includes/core/body.html`
 * ships (outdated browser, suspended payment method, the flash-sale banner)
 * carried an operable control that did nothing at all. The handler is delegated
 * off `document`, the idiom app-shell.js and appearance.js already use, so the
 * alerts stay pure markup — no per-alert wiring, and an alert injected after
 * boot is dismissible too.
 *
 * Browser code behind a bundler alias, so the harness drives the REAL file
 * through esbuild over a hand-rolled document that is only what the handler
 * touches (node has no DOM and web pulls in no jsdom) — the convention
 * consent-banner.test.js set.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const ENTRY = path.join(CORE_DIR, 'js', 'libs', 'alert-dismiss.js');
const BODY_INCLUDE = path.join(CORE_DIR, '_includes', 'core', 'body.html');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-alert-dismiss-'));
const BUNDLE = path.join(BUNDLE_DIR, 'alert-dismiss.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
  });

  return building;
}

/** The minimum element the handler walks: classes, a parent chain, `hidden`. */
function makeElement(tagName, className = '') {
  const classes = new Set(String(className).split(/\s+/).filter(Boolean));

  const element = {
    tagName,
    parent: null,
    children: [],
    hidden: false,
    classList: {
      contains: (name) => classes.has(name),
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
    appendChild: (node) => {
      node.parent = element;
      element.children.push(node);
      return node;
    },
    // Class selectors only — that is all the handler asks for.
    closest: (selector) => {
      const names = selector.split(',').map((part) => part.trim().replace(/^\./, ''));
      let node = element;

      while (node) {
        if (names.some((name) => node.classList.contains(name))) {
          return node;
        }
        node = node.parent;
      }

      return null;
    },
  };

  return element;
}

/** One alert, shaped like the ones body.html ships: a close button and a body. */
function makeAlert(variant) {
  const alert = makeElement('div', `main-alert main-alert-top main-alert-fixed main-alert-${variant} bg-danger`);
  const close = makeElement('button', 'main-alert-close');
  const body = makeElement('div');
  const link = makeElement('a');

  alert.appendChild(close);
  alert.appendChild(body);
  body.appendChild(link);

  return { alert, close, link };
}

/** The minimum document the handler binds to, plus a way to click on it. */
function makeDocument() {
  const listeners = {};

  return {
    listeners,
    addEventListener: (type, handler) => { (listeners[type] ||= []).push(handler); },
    click: (target) => {
      const event = {
        target,
        defaultPrevented: false,
        preventDefault: () => { event.defaultPrevented = true; },
      };

      (listeners.click || []).forEach((handler) => handler(event));

      return event;
    },
  };
}

test.after(() => {
  delete globalThis.document;
});

/** Arm the real handler over one fresh document. */
async function boot() {
  await bundleOnce();

  const doc = makeDocument();
  globalThis.document = doc;

  delete require.cache[require.resolve(BUNDLE)];
  require(BUNDLE).setupAlertDismiss();

  return doc;
}

test('pressing the close button hides its own alert', async () => {
  const doc = await boot();
  const outdated = makeAlert('outdated');

  const event = doc.click(outdated.close);

  assert.equal(outdated.alert.hidden, true, 'the alert the button sits in is hidden');
  assert.equal(event.defaultPrevented, true, 'the dismiss owns the click');
});

test('only the nearest alert closes — a second banner stays up', async () => {
  // Two alerts can be on screen at once (an outdated browser AND a failed
  // payment method), and dismissing one is not an answer about the other.
  const doc = await boot();
  const outdated = makeAlert('outdated');
  const suspended = makeAlert('suspended');

  doc.click(suspended.close);

  assert.equal(suspended.alert.hidden, true, 'the pressed alert closes');
  assert.equal(outdated.alert.hidden, false, 'the other one is untouched');
});

test('a click elsewhere in the alert leaves it open', async () => {
  // The alerts carry links ("click here to update your browser"): a click on
  // the message is not a dismiss, and must keep its default navigation.
  const doc = await boot();
  const outdated = makeAlert('outdated');

  const event = doc.click(outdated.link);

  assert.equal(outdated.alert.hidden, false, 'the message is not a dismiss target');
  assert.equal(event.defaultPrevented, false, 'the link still navigates');
});

test('the shipped alerts carry the class the handler listens for', () => {
  // The handler is markup wiring, so the markup is half the contract: every
  // alert body.html ships must reach it.
  const body = fs.readFileSync(BODY_INCLUDE, 'utf8');
  const alerts = body.match(/class="main-alert /g) || [];
  const closes = body.match(/<button[^>]*class="main-alert-close"/g) || [];

  assert.ok(alerts.length > 0, 'body.html ships alerts');
  assert.equal(closes.length, alerts.length, 'every shipped alert has a real close button the handler can find');
});
