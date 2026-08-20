/**
 * Browser transport tests — the #306 contract: a missing or blocked page
 * global is a silent no-op, never a ReferenceError that takes the customer's
 * action with it.
 *
 * The globals are set on globalThis and deleted again, so each case runs
 * against the state a real page would be in.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const browser = require('../src/transports/browser.js');
const ga4 = require('../src/adapters/ga4.js');
const meta = require('../src/adapters/meta.js');
const tiktok = require('../src/adapters/tiktok.js');

function clearGlobals() {
  delete globalThis.gtag;
  delete globalThis.fbq;
  delete globalThis.ttq;
}

test('no globals at all: every provider no-ops without throwing', (t) => {
  clearGlobals();
  t.after(clearGlobals);

  for (const adapter of [ga4, meta, tiktok]) {
    const descriptor = adapter.resolve('sign_up', { method: 'email' });
    assert.strictEqual(browser.send(descriptor), false, `${adapter.provider} reports it could not deliver`);
  }
});

test('gtag takes the event command with the native name and payload', (t) => {
  clearGlobals();
  t.after(clearGlobals);

  const calls = [];
  globalThis.gtag = (...args) => calls.push(args);

  assert.strictEqual(browser.send(ga4.resolve('sign_up', { method: 'email' })), true);
  assert.deepEqual(calls, [['event', 'sign_up', { method: 'email' }]]);
});

test('fbq picks track or trackCustom by the mapping kind', (t) => {
  clearGlobals();
  t.after(clearGlobals);

  const calls = [];
  globalThis.fbq = (...args) => calls.push(args);

  browser.send(meta.resolve('sign_up', { method: 'email' }));        // standard
  browser.send(meta.resolve('login', { method: 'email' }));          // custom

  assert.deepEqual(calls[0], ['track', 'CompleteRegistration', { method: 'email' }]);
  assert.deepEqual(calls[1], ['trackCustom', 'Login', { method: 'email' }]);
});

test('ttq.track takes the native name and payload', (t) => {
  clearGlobals();
  t.after(clearGlobals);

  const calls = [];
  globalThis.ttq = { track: (...args) => calls.push(args) };

  assert.strictEqual(browser.send(tiktok.resolve('search', { search_term: 'omega' })), true);
  assert.deepEqual(calls, [['Search', { search_string: 'omega' }]]);
});

test('a dedupe id rides in each platform\'s own option slot', (t) => {
  clearGlobals();
  t.after(clearGlobals);

  const calls = [];
  globalThis.fbq = (...args) => calls.push(['fbq', ...args]);
  globalThis.ttq = { track: (...args) => calls.push(['ttq', ...args]) };
  globalThis.gtag = (...args) => calls.push(['gtag', ...args]);

  const params = { transaction_id: 'ORD-1', value: 10, currency: 'USD', items: [{ item_id: 'pro' }] };
  const withId = (descriptor) => Object.assign(descriptor, { eventId: 'purchase.ORD-1' });

  browser.send(withId(meta.resolve('purchase', params)));
  browser.send(withId(tiktok.resolve('purchase', params)));
  browser.send(withId(ga4.resolve('purchase', params)));

  assert.deepEqual(calls[0].at(-1), { eventID: 'purchase.ORD-1' }, 'Meta reads eventID from the fourth argument');
  assert.deepEqual(calls[1].at(-1), { event_id: 'purchase.ORD-1' }, 'TikTok reads event_id from the third');
  assert.strictEqual(calls[2].length, 4, 'gtag takes no dedupe option — GA4 has no cross-source dedupe');
});

test('a half-present ttq (object without track) still no-ops', (t) => {
  clearGlobals();
  t.after(clearGlobals);

  globalThis.ttq = {};

  assert.strictEqual(browser.send(tiktok.resolve('search', { search_term: 'omega' })), false);
});

test('blockers are per-list: Google allowed still counts while Meta is gone', (t) => {
  clearGlobals();
  t.after(clearGlobals);

  const calls = [];
  globalThis.gtag = (...args) => calls.push(args);

  assert.strictEqual(browser.send(ga4.resolve('sign_up', { method: 'email' })), true);
  assert.strictEqual(browser.send(meta.resolve('sign_up', { method: 'email' })), false);
  assert.strictEqual(calls.length, 1);
});

test('an unknown provider is a no-op, not a crash', () => {
  assert.strictEqual(browser.send({ provider: 'pinterest', name: 'X', kind: 'standard', payload: {} }), false);
});
