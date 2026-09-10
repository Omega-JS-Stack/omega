/**
 * The social sharing bar's "Copy Link" confirmation
 * ([#718](https://github.com/Omega-JS-Stack/omega/issues/718)).
 *
 * The confirmation swap guarded on `img[data-icon-type="share"]`, which
 * matches NOTHING: the share icon is an `<i>` the module builds itself, and
 * that attribute appears nowhere in the package. So copying a link only
 * changed the label, and the dead branch behind the guard reached for an
 * `ICON_BASE_URL` that was never defined — a ReferenceError, had it ever run.
 * The swap now moves the `<i>`'s own name class to `fa-check`, which the
 * runtime icon watcher ([#619](https://github.com/Omega-JS-Stack/omega/issues/619))
 * re-renders on a class change.
 *
 * Browser code behind the `@omega.js/client` alias, so the harness drives the
 * REAL module through esbuild with the client stubbed, over a hand-rolled
 * document that is only what it touches (node has no DOM and web pulls in no
 * jsdom) — the convention dev-palette.test.js set.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const ENTRY = path.join(CORE_DIR, 'js', 'core', 'social-sharing.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-social-sharing-'));
const BUNDLE = path.join(BUNDLE_DIR, 'social-sharing.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        // The analytics facade is a seam here, not the subject: the events the
        // bar fires are pinned where they are owned (analytics-blocked.test.js).
        build.onResolve({ filter: /^__main_assets__\/js\/libs\/analytics\.js$/ }, () => {
          return { path: 'analytics', namespace: 'omega-analytics-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-analytics-stub' }, () => {
          return { contents: 'export const event = (...args) => globalThis.__omegaEvents.push(args);' };
        });
        build.onResolve({ filter: /^__main_assets__\//, namespace: 'file' }, (args) => {
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
  });

  return building;
}

/** Only the selector forms the module asks for: `[attr]`, `[attr="v"]`, a tag, `tag:not(.class)`. */
function matches(element, selector) {
  const [, part, excluded] = /^([^:]+)(?::not\(\.([^)]+)\))?$/.exec(selector.trim());

  if (excluded && element.classList.contains(excluded)) {
    return false;
  }

  if (part.startsWith('[')) {
    const [, name, value] = /^\[([^\]=]+)(?:="([^"]*)")?\]$/.exec(part);

    return value === undefined
      ? element.getAttribute(name) !== null
      : element.getAttribute(name) === value;
  }

  return element.tagName === part.toUpperCase();
}

/** Every descendant, depth-first. */
function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

/** The minimum element the module builds and then reads back. */
function makeElement(tagName) {
  const classes = new Set();

  const element = {
    tagName: tagName.toUpperCase(),
    children: [],
    textContent: '',
    innerHTML: '',
    attributes: {},
    listeners: {},
    get className() {
      return [...classes].join(' ');
    },
    set className(value) {
      classes.clear();
      String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
    },
    classList: {
      contains: (name) => classes.has(name),
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
    appendChild: (node) => { element.children.push(node); return node; },
    setAttribute: (name, value) => { element.attributes[name] = value; },
    getAttribute: (name) => (name in element.attributes ? element.attributes[name] : null),
    hasAttribute: (name) => name in element.attributes,
    addEventListener: (type, handler) => { (element.listeners[type] ||= []).push(handler); },
    querySelector: (selector) => descendants(element).find((node) => matches(node, selector)) || null,
    click: () => (element.listeners.click || []).forEach((handler) => handler({ preventDefault: () => {} })),
  };

  return element;
}

/** The minimum document the bar mounts into, holding one sharing container. */
function makeDocument(container) {
  return {
    title: 'A post worth sharing',
    createElement: (tagName) => makeElement(tagName),
    querySelector: () => null,
    querySelectorAll: (selector) => {
      if (matches(container, selector)) {
        return [container];
      }

      return descendants(container).filter((node) => matches(node, selector));
    },
  };
}

/** The client the module reaches for: the config, DOM-ready, and the clipboard. */
function makeClient(showLabels, { fail = false } = {}) {
  const copied = [];

  return {
    copied,
    config: {
      socialSharing: {
        config: {
          selector: '[data-social-share]',
          defaultPlatforms: ['facebook', 'copy'],
          buttonClass: '',
          showLabels,
          openInNewWindow: true,
          windowWidth: 600,
          windowHeight: 400,
        },
      },
    },
    dom: () => ({ ready: () => Promise.resolve() }),
    utilities: () => ({
      // The REAL contract since #726: a promise, and a refused clipboard
      // rejects. The confirmation therefore lands a microtask after the click.
      clipboardCopy: async (value) => {
        if (fail) {
          throw new Error('clipboard denied');
        }
        copied.push(value);
      },
    }),
  };
}

test.after(() => {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.__omegaClient;
  delete globalThis.__omegaEvents;
});

/** Render one sharing bar and hand back its copy button. */
async function boot({ showLabels = true, fail = false } = {}) {
  await bundleOnce();

  const container = makeElement('div');
  container.setAttribute('data-social-share', '');
  container.setAttribute('data-url', 'https://example.com/blog/post');

  const client = makeClient(showLabels, { fail });

  globalThis.document = makeDocument(container);
  globalThis.window = { location: { href: 'https://example.com/blog/post' }, open: () => {} };
  globalThis.__omegaClient = client;
  globalThis.__omegaEvents = [];

  delete require.cache[require.resolve(BUNDLE)];
  require(BUNDLE).default();

  // The bar renders behind `omega.dom().ready()` — one turn of the microtask queue.
  await new Promise((resolve) => setImmediate(resolve));

  const $copy = document.querySelectorAll('[data-platform="copy"]')[0];

  return { client, container, $copy, $icon: $copy.querySelector('i'), $label: $copy.querySelector('span:not(.me-2)') };
}

/** Run something with `setTimeout` captured rather than scheduled. */
async function captureTimers(run) {
  const real = globalThis.setTimeout;
  const timers = [];

  globalThis.setTimeout = (fn, delay) => { timers.push({ fn, delay }); return timers.length; };

  try {
    run();

    // The confirmation is drawn only once the clipboard promise settles (#726),
    // so the queue has to drain while the capture is still installed.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    globalThis.setTimeout = real;
  }

  return timers;
}

test('the copy button is built with a real `<i>` icon, not an `<img>`', async () => {
  // The premise of the whole bug: the guard looked for markup the module never
  // creates, so the confirmation could not fire.
  const { $copy, $icon } = await boot();

  assert.ok($icon, 'the button carries an icon element');
  assert.equal($icon.tagName, 'I');
  assert.ok($icon.classList.contains('fa-link'), 'the share state is the link icon');
  assert.equal($copy.querySelector('[data-icon-type]'), null, 'nothing carries the attribute the dead guard matched');
});

test('copying a link swaps the icon to a check, then puts it back', async () => {
  const { client, $copy, $icon } = await boot();

  const timers = await captureTimers(() => $copy.click());

  assert.deepEqual(client.copied, ['https://example.com/blog/post'], 'the share URL was copied');
  assert.ok($icon.classList.contains('fa-check'), 'the icon confirms the copy');
  assert.ok(!$icon.classList.contains('fa-link'), 'the link icon is gone while confirming');
  assert.ok($icon.classList.contains('fa-solid'), 'the style class the icon watcher reads survives the swap');

  assert.equal(timers.length, 1, 'one revert is scheduled');
  assert.equal(timers[0].delay, 2000);

  timers[0].fn();

  assert.ok($icon.classList.contains('fa-link'), 'the icon goes back to the link');
  assert.ok(!$icon.classList.contains('fa-check'), 'the check is cleared');
});

test('the label confirms and reverts alongside the icon', async () => {
  const { $copy, $label } = await boot();

  assert.equal($label.textContent, 'Copy Link');

  const timers = await captureTimers(() => $copy.click());

  assert.equal($label.textContent, 'Copied!');

  timers[0].fn();

  assert.equal($label.textContent, 'Copy Link');
});

test('a double click leaves the button named "Copy Link", not "Copied!" forever', async () => {
  // The revert used to put back whatever the label READ when the click landed:
  // a second click inside the 2000ms window captured 'Copied!' as the original,
  // so the button kept that name for the rest of the page's life
  // ([#727](https://github.com/Omega-JS-Stack/omega/issues/727)).
  const { $copy, $label } = await boot();

  const first = await captureTimers(() => $copy.click());
  const second = await captureTimers(() => $copy.click());

  assert.equal($label.textContent, 'Copied!', 'the second click confirms too');

  // Both reverts fire, oldest first, the way the real timers would.
  first[0].fn();
  second[0].fn();

  assert.equal($label.textContent, 'Copy Link', 'the button carries its own name again');
});

test('a refused clipboard confirms nothing', async () => {
  // The clipboard rejects on a real refusal since
  // [#726](https://github.com/Omega-JS-Stack/omega/issues/726) — a check mark
  // would claim a copy that never happened.
  const { client, $copy, $icon, $label } = await boot({ fail: true });

  const timers = await captureTimers(() => $copy.click());

  assert.deepEqual(client.copied, [], 'nothing reached the clipboard');
  assert.equal(timers.length, 0, 'no revert was scheduled, because nothing was swapped');
  assert.ok($icon.classList.contains('fa-link'), 'the icon still says copy');
  assert.equal($label.textContent, 'Copy Link', 'the label still says copy');
});

test('a bar with no labels still confirms', async () => {
  // `showLabels: false` is the default: with no span to change, the icon IS
  // the entire confirmation, which is what made the dead guard invisible.
  const { $copy, $icon, $label } = await boot({ showLabels: false });

  assert.equal($label, null, 'no label was rendered');

  const timers = await captureTimers(() => $copy.click());

  assert.ok($icon.classList.contains('fa-check'), 'the icon still confirms');

  timers[0].fn();

  assert.ok($icon.classList.contains('fa-link'));
});

test('the undefined ICON_BASE_URL and its dead branch are gone', async () => {
  const source = fs.readFileSync(ENTRY, 'utf8');

  assert.ok(!source.includes('ICON_BASE_URL'), 'no reference to a constant that never existed');
  assert.ok(!source.includes('data-icon-type'), 'no guard on markup the module never builds');
});
