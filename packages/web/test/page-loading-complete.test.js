/**
 * The page-loading state's LAST step: who is allowed to keep a finished page in
 * it ([#803](https://github.com/Omega-JS-Stack/omega/issues/803)).
 *
 * `core/js/core/complete.js` decides the page is done four ways (readyState,
 * the load event, a poll, a 3s timeout) and then dropped `data-page-loading`
 * inside a `requestAnimationFrame`, so the whole decision hung on a frame the
 * renderer may never produce: headless Chrome on a Mac whose display has gone
 * to sleep fires no frames at all, while `setTimeout` still runs and the page
 * has long since drawn. Everything gated on the attribute (a form's submit
 * control, the panel's gated controls, a browser lane's waits) stayed held on a
 * page that was finished.
 *
 * The frame stays, because on a drawing renderer it is what keeps the
 * transition on a paint boundary, and a timer runs beside it at
 * `FRAMELESS_CLEAR_DELAY` (100ms), far enough out that a real paint (the next
 * vsync, 0-16ms away) always wins it. So the timer is a rescue, not a race:
 * the three cases below are the frame arriving, never arriving, and arriving
 * late, and the state is cleared exactly once in all three.
 *
 * The module is browser code, so the harness drives the REAL file through
 * esbuild over a hand-rolled document with `requestAnimationFrame` under the
 * test's control, the lazy-loading/auth-policy convention (node has no DOM and
 * web pulls in no jsdom).
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const ENTRY = path.join(CORE_DIR, 'js', 'core', 'complete.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-page-loading-'));
const BUNDLE = path.join(BUNDLE_DIR, 'complete.cjs');

// The module's own FRAMELESS_CLEAR_DELAY, written out rather than read off the
// source: a change to the delay lands here as a failing case, deliberately.
const FRAMELESS_CLEAR_DELAY = 100;

// Past the delay, with room for a loaded machine's timer slack.
const PAST_DELAY = FRAMELESS_CLEAR_DELAY + 50;

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

/** @param {number} ms - How long to wait. @returns {Promise<void>} The wait. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The <html> the module touches, mid-load, recording every attribute write. */
function makeDocumentElement() {
  const attributes = { 'data-page-loading': 'true', 'aria-busy': 'true' };
  const removed = [];

  return {
    removed: removed,
    getAttribute: (name) => attributes[name] ?? null,
    setAttribute: (name, value) => { attributes[name] = value; },
    removeAttribute: (name) => {
      removed.push(name);
      delete attributes[name];
    },
  };
}

/**
 * Run the REAL completion path over a document that is already `complete`, and
 * hand back what it did plus the frames it asked for, so a case can fire one
 * whenever it wants to.
 *
 * @param {object} options - The renderer to run under.
 * @param {boolean} options.framesFire - Whether a requested frame calls back on its own.
 * @returns {Promise<object>} The document element and the frame callbacks.
 */
async function runCompletion({ framesFire }) {
  await bundleOnce();

  const documentElement = makeDocumentElement();
  const frames = [];

  globalThis.document = { readyState: 'complete', documentElement: documentElement };
  globalThis.window = { addEventListener: () => {} };
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);

    // A drawing renderer paints at the next vsync, 0-16ms out, so the frame
    // lands far inside the 100ms fallback: a microtask is that ordering.
    if (framesFire) {
      queueMicrotask(callback);
    }

    return frames.length;
  };

  delete require.cache[require.resolve(BUNDLE)];
  require(BUNDLE).default();

  // One turn of the loop: enough for a fired frame, nowhere near the fallback.
  await delay(0);

  return { documentElement: documentElement, frames: frames };
}

test('#803: the page-loading state clears even when no frame ever fires', async () => {
  const { documentElement, frames } = await runCompletion({ framesFire: false });

  assert.equal(frames.length, 1, 'the frame was still asked for, so the paint boundary is unchanged');
  assert.equal(documentElement.getAttribute('data-page-loading'), 'true', 'and nothing clears the state in the frame window');

  await delay(PAST_DELAY);

  assert.deepEqual(documentElement.removed, ['data-page-loading'], 'the timer cleared the state the frame never did');
  assert.equal(documentElement.getAttribute('aria-busy'), 'false', 'the page tells assistive tech it is done, too');
});

test('#803: on a drawing renderer the FRAME clears the state, well before the timer', async () => {
  const { documentElement, frames } = await runCompletion({ framesFire: true });

  assert.equal(frames.length, 1, 'one frame requested');
  assert.deepEqual(documentElement.removed, ['data-page-loading'], 'the paint boundary is what cleared it, not the fallback');
  assert.equal(documentElement.getAttribute('aria-busy'), 'false', 'and the busy flag is down');

  await delay(PAST_DELAY);

  assert.deepEqual(documentElement.removed, ['data-page-loading'], 'the timer behind it is a no-op');
});

test('#803: a frame that arrives after the timer is a no-op, not a second clear', async () => {
  const { documentElement, frames } = await runCompletion({ framesFire: false });

  await delay(PAST_DELAY);

  assert.deepEqual(documentElement.removed, ['data-page-loading'], 'the timer went first');

  // The display wakes: the frame the module asked for finally runs
  frames[0]();

  assert.deepEqual(documentElement.removed, ['data-page-loading'], 'and the late frame clears nothing a second time');
  assert.equal(documentElement.getAttribute('aria-busy'), 'false', 'the busy flag stays down');
});
