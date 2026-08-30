/**
 * live-page — the primitives a page that REFRESHES ITSELF needs, ported from
 * the workkit tower's page runtime.
 *
 * A live page is polled: it re-reads its feeds on a timer and re-renders with
 * the answers. The naive shape of that — write the whole body on every tick —
 * repaints identical markup ten times a minute, which blinks the cards, drops
 * the scroll position inside a scrolling strip and closes whatever `details`
 * was open. And before the first answer arrives the same render draws an empty
 * region, so a slow feed looks like an empty one.
 *
 * Three primitives, one rule each:
 *   - `swap(host, markup)` writes ONLY when the markup differs from what was
 *     written last, so an unchanged section is left alone — DOM, focus, scroll
 *     and all.
 *   - `loading(message)` is what a section shows while its feed has never
 *     answered: a first paint says which read it is waiting on, never a blank.
 *   - `createFeedPoller(options)` owns the declared feed table, the in-flight
 *     count and the keep-last-good rule — a refresh that fails leaves the last
 *     good answer on screen, marked stale with the reason.
 *
 * Transport-free, like `icon-renderer` and `motion`: nothing here fetches. The
 * poller takes its fetcher as an ARGUMENT — an `omega.request`-shaped function
 * (resolves with the body, throws an Error carrying `.code`) — so the embedding
 * page passes `omega.request` and a non-singleton context (desktop main, the
 * extension service worker) passes its own `createRequest(...)` instance, the
 * same seam `request.js` already offers.
 */

import Utilities from './utilities.js';

// Escaping is utilities' job, never this module's. The helpers are pure — they
// touch no manager state — so a manager-free instance is the whole dependency.
const { escapeHTML } = new Utilities();

/** What swap last wrote into each host, keyed by the element itself. */
const written = new WeakMap();

/**
 * The markup a section shows while its feed has not answered yet.
 *
 * The theme's spinner, in the muted voice a "nothing here" line uses.
 *
 * @param {string} message - what is being read, in the page's own words
 * @returns {string} markup
 */
export function loading(message) {
  return `<div class="d-flex align-items-center gap-2 text-body-secondary">
  <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
  <span class="classy-micro" aria-live="polite">${escapeHTML(message)}</span>
</div>`;
}

/**
 * Write markup into a host, but only when it is not already there.
 *
 * The comparison is against what swap itself last wrote, held in a WeakMap, and
 * NOT against `host.innerHTML` — the browser re-serializes what it parses
 * (attribute order, entities, void tags), so reading it back never matches the
 * string that produced it and every tick would count as a change.
 *
 * @param {{innerHTML: string}} host - the element to draw into
 * @param {string} markup - what the render produced this time
 * @returns {boolean} true when the DOM was written, false when it was left
 *   alone — the caller's post-draw work (charts, listeners) hangs off this
 */
export function swap(host, markup) {
  if (written.get(host) === markup) {
    return false;
  }

  written.set(host, markup);
  host.innerHTML = markup;

  return true;
}

/**
 * Boot a feed poller over a declared feed table.
 *
 * The cadence is the poller's own: it stops while the page is hidden (a covered
 * tab) and resumes on the way back with one immediate read. There is no option
 * for it.
 *
 * @param {object} options
 * @param {Object<string, {path: string, every: number, fresh?: string}>} options.feeds -
 *   every feed this page reads: where it lives, how often it is re-read, and
 *   the optional path a user-triggered refresh uses instead (a cache bypass)
 * @param {(path: string) => Promise<any>} options.fetcher - an
 *   `omega.request`-shaped function: resolves with the body, throws on failure
 * @param {() => void} [options.onChange] - called at every state transition (a
 *   read starting, a read landing), which is when the page repaints
 * @returns {{state: object, read: Function, readAll: Function, staleFeeds: Function, start: Function, stop: Function}}
 */
export function createFeedPoller(options) {
  if (typeof options.fetcher !== 'function') {
    throw new Error('createFeedPoller requires a fetcher');
  }

  const feeds = options.feeds || {};
  const names = Object.keys(feeds);
  const onChange = options.onChange || (() => {});

  // `pending` is how many reads are in flight, which a page's chrome draws its
  // spinner from: a refresh is visible while it happens, and the page under it
  // keeps showing the data it already has.
  const state = { feeds: {}, pending: 0, stamp: '' };

  let timers = [];
  let started = false;

  // The hidden-tab rule needs a document to read: a poller running where there
  // is none (the extension service worker the fetcher seam exists for) has no
  // tab that can be covered, and just keeps its cadence.
  const page = typeof document === 'undefined' ? null : document;

  // The fetcher throws; a feed result never does. Every way a read can let a
  // page down lands in the same four-key shape, told apart by status and reason.
  const ask = async (path) => {
    try {
      return { ok: true, data: await options.fetcher(path), status: null, reason: null };
    } catch (error) {
      return { ok: false, data: null, status: error?.code ?? null, reason: error?.message || 'the read failed' };
    }
  };

  const read = async (name, fresh) => {
    const spec = feeds[name];
    if (!spec) {
      throw new Error(`createFeedPoller: no feed named "${name}"`);
    }

    state.pending += 1;
    onChange();

    const answer = await ask(fresh && spec.fresh ? spec.fresh : spec.path);
    const previous = state.feeds[name];
    state.pending -= 1;

    // A refresh that fails does not take the page down with it. The last good
    // answer stays on screen, marked stale so the chrome can say a feed is
    // unavailable — replacing a full board with an error line because one poll
    // missed is the "clearing to empty" this module exists to prevent.
    state.feeds[name] = !answer.ok && previous && previous.ok
      ? { ...previous, stale: answer.reason }
      : answer;
    state.stamp = `updated ${new Date().toLocaleTimeString()}`;
    onChange();
  };

  const readAll = (fresh) => Promise.all(names.map((name) => read(name, fresh)));

  /**
   * Every feed that is not currently telling the truth — one that failed
   * outright, and one showing a last-good answer behind a failed refresh.
   *
   * @returns {Array<{name: string, reason: string}>}
   */
  const staleFeeds = () => Object.entries(state.feeds)
    .filter(([, result]) => result && (!result.ok || result.stale))
    .map(([name, result]) => ({ name, reason: result.stale || result.reason }));

  const arm = () => {
    timers = names.map((name) => setInterval(() => { read(name, false); }, feeds[name].every));
  };

  const disarm = () => {
    timers.forEach((timer) => clearInterval(timer));
    timers = [];
  };

  // A covered TAB reads nothing. Polling a page nobody is looking at spends the
  // device's battery and the backend's quota on answers that are thrown away,
  // so the intervals are cleared while the page is hidden and re-armed when it
  // comes back — with ONE immediate read, because whatever is on screen is as
  // old as the time the tab spent covered.
  //
  // `document.hidden` on purpose, and never focus: a visible-but-unfocused
  // window is still being WATCHED — a board on a second monitor is the case
  // this module exists for — and keeps its cadence.
  const onVisibilityChange = () => {
    if (!started) {
      return;
    }

    if (page.hidden) {
      disarm();
      return;
    }

    // Armed already means this was not a return from hidden (a browser can say
    // "visible" to a page that never left), and there is nothing to catch up on.
    if (timers.length) {
      return;
    }

    readAll(false);
    arm();
  };

  const start = async () => {
    if (started) {
      return;
    }
    started = true;

    await readAll(false);

    // Armed AFTER the first pass so a slow first read is never overlapped by
    // its own timer. A stop() during that first pass flips `started` back off
    // before this line runs — arming anyway would leave intervals nothing can
    // ever clear, so the re-check is what makes stop() final.
    if (!started) {
      return;
    }

    page?.addEventListener('visibilitychange', onVisibilityChange);

    // A start in a tab that is ALREADY covered arms nothing: the listener above
    // is what gives the page its cadence when it comes into view.
    if (page?.hidden) {
      return;
    }

    arm();
  };

  const stop = () => {
    page?.removeEventListener('visibilitychange', onVisibilityChange);
    disarm();
    started = false;
  };

  return { state, read, readAll, staleFeeds, start, stop };
}
