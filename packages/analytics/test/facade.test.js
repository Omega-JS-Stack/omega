/**
 * Facade tests — the one consumer call: consent, resolution, transport,
 * the dev log, and the unknown-name contract.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const analytics = require('../src/index.js');

// A transport that records instead of reaching a page. Returns `delivered` so
// the "blocked global" path is testable without page globals.
function recordingTransport(delivered = true) {
  const sent = [];
  return {
    sent,
    send(descriptor) {
      sent.push(descriptor);
      return delivered;
    },
  };
}

// Every test starts from the package defaults — module state is process-wide.
function reset(options = {}) {
  return analytics.configure({
    transport: null,
    consent: analytics.createConsentGate(() => ({ analytics: true, marketing: true })),
    context: {},
    environment: 'production',
    ...options,
  });
}

// Capture the dev log without letting it reach the runner's stdout.
function captureLog(run) {
  const lines = [];
  const real = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    run();
  } finally {
    console.log = real;
  }
  return lines;
}

test('a mapped event reaches every provider through the transport', () => {
  const transport = recordingTransport();
  reset({ transport });

  const result = analytics.event('sign_up', { method: 'email' });

  assert.deepEqual(transport.sent.map((d) => d.provider), ['ga4', 'meta', 'tiktok']);
  assert.deepEqual(transport.sent.map((d) => d.name), ['sign_up', 'CompleteRegistration', 'CompleteRegistration']);
  assert.deepEqual(result.results.map((r) => r.outcome), ['sent', 'sent', 'sent']);
});

test('an unmapped provider is skipped, never a throw', () => {
  const transport = recordingTransport();
  reset({ transport });

  const result = analytics.event('vert_click', { vert_id: 'omega-promo', vert_lane: 'promo' });

  assert.deepEqual(transport.sent.map((d) => d.provider), ['ga4'], 'only the mapped provider is executed');
  assert.deepEqual(result.results.map((r) => r.outcome), ['sent', 'skipped (no mapping)', 'skipped (no mapping)']);
});

test('a zero-provider event fires nothing and dev-logs all-skipped', () => {
  const transport = recordingTransport();
  reset({ transport, environment: 'development' });

  let result;
  const lines = captureLog(() => {
    result = analytics.event('logout');
  });

  assert.deepEqual(transport.sent, [], 'logout reaches no provider');
  assert.deepEqual(result.results.map((r) => r.outcome), ['skipped (no mapping)', 'skipped (no mapping)', 'skipped (no mapping)']);
  assert.deepEqual(lines, ['[@omega.js/analytics:events] logout → ga4 skipped (no mapping), meta skipped (no mapping), tiktok skipped (no mapping)']);
});

test('the dev log prints one tagged line per fire', () => {
  const transport = recordingTransport();
  reset({ transport, environment: 'development' });

  const lines = captureLog(() => analytics.event('sign_up', { method: 'email' }));

  assert.deepEqual(lines, ['[@omega.js/analytics:events] sign_up → ga4 sent, meta sent, tiktok sent']);
});

test('production prints nothing per fire', () => {
  reset({ transport: recordingTransport() });

  const lines = captureLog(() => analytics.event('sign_up', { method: 'email' }));

  assert.deepEqual(lines, []);
});

test('an unknown event name throws in development', () => {
  reset({ transport: recordingTransport(), environment: 'development' });

  assert.throws(() => analytics.event('sign_upp', { method: 'email' }), /Unknown analytics event "sign_upp"/);
});

test('an unknown event name is logged and skipped in production', () => {
  const transport = recordingTransport();
  reset({ transport });

  const warnings = [];
  const real = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let result;
  try {
    result = analytics.event('sign_upp', { method: 'email' });
  } finally {
    console.warn = real;
  }

  assert.deepEqual(result.results, [], 'nothing resolves');
  assert.deepEqual(transport.sent, [], 'nothing is sent');
  assert.match(warnings[0], /^\[@omega\.js\/analytics:events\] Unknown event "sign_upp"/);
});

test('marketing denied blocks meta and tiktok; ga4 still fires', () => {
  const transport = recordingTransport();
  reset({
    transport,
    consent: analytics.createConsentGate(() => ({ analytics: true, marketing: false })),
  });

  const result = analytics.event('purchase', { value: 10, currency: 'USD', items: [{ item_id: 'pro' }] });

  assert.deepEqual(transport.sent.map((d) => d.provider), ['ga4']);
  assert.deepEqual(result.results.map((r) => r.outcome), ['sent', 'skipped (consent: marketing)', 'skipped (consent: marketing)']);
});

test('analytics denied blocks ga4 while the ad platforms still fire', () => {
  const transport = recordingTransport();
  reset({
    transport,
    consent: analytics.createConsentGate(() => ({ analytics: false, marketing: true })),
  });

  analytics.event('purchase', { value: 10, currency: 'USD', items: [{ item_id: 'pro' }] });

  assert.deepEqual(transport.sent.map((d) => d.provider), ['meta', 'tiktok']);
});

test('the consent gate is read live, so a mid-session accept counts', () => {
  const transport = recordingTransport();
  let marketing = false;
  reset({
    transport,
    consent: analytics.createConsentGate(() => ({ analytics: true, marketing })),
  });

  analytics.event('sign_up', { method: 'email' });
  assert.deepEqual(transport.sent.map((d) => d.provider), ['ga4']);

  marketing = true;
  analytics.event('sign_up', { method: 'email' });
  assert.deepEqual(transport.sent.map((d) => d.provider), ['ga4', 'ga4', 'meta', 'tiktok']);
});

test('a missing consent category reads as denied', () => {
  const transport = recordingTransport();
  reset({ transport, consent: analytics.createConsentGate(() => ({})) });

  analytics.event('sign_up', { method: 'email' });

  assert.deepEqual(transport.sent, [], 'nothing is granted by omission');
});

test('with no transport configured the walk still resolves and reports', () => {
  reset();

  const result = analytics.event('sign_up', { method: 'email' });

  assert.deepEqual(result.results.map((r) => r.outcome), ['skipped (no transport)', 'skipped (no transport)', 'skipped (no transport)']);
  assert.strictEqual(result.results[0].descriptor.name, 'sign_up');
});

test('a transport that could not deliver reports blocked, never throws', () => {
  reset({ transport: recordingTransport(false), environment: 'development' });

  let result;
  const lines = captureLog(() => {
    result = analytics.event('page_view', { page_path: '/' });
  });

  assert.strictEqual(result.results[0].outcome, 'blocked (no global)');
  assert.deepEqual(lines, ['[@omega.js/analytics:events] page_view → ga4 blocked (no global), meta skipped (no mapping), tiktok skipped (no mapping)']);
});

// ─── The two-half fire (a browser twin of a server event) ───

test('an eventId rides onto every descriptor the fire resolves', () => {
  const transport = recordingTransport();
  reset({ transport });

  analytics.event('sign_up', { method: 'email' }, { eventId: 'sign_up.uid-9' });

  assert.deepEqual(
    transport.sent.map((d) => d.eventId),
    ['sign_up.uid-9', 'sign_up.uid-9', 'sign_up.uid-9'],
    'both halves of a conversion can name the same id',
  );
});

test('without an eventId no descriptor carries one', () => {
  const transport = recordingTransport();
  reset({ transport });

  analytics.event('sign_up', { method: 'email' });

  assert.deepEqual(transport.sent.map((d) => d.eventId), [undefined, undefined, undefined]);
});

test('a providers restriction fires only the half this side owns', () => {
  const transport = recordingTransport();
  reset({ transport });

  // The purchase pixel: the backend owns GA4 (revenue truth, and GA4 has no
  // cross-source dedupe), the browser owns the two platforms that deduplicate.
  const result = analytics.event(
    'purchase',
    { transaction_id: 'ORD-1', value: 10, currency: 'USD', items: [{ item_id: 'pro' }] },
    { providers: ['meta', 'tiktok'], eventId: 'purchase.ORD-1' },
  );

  assert.deepEqual(transport.sent.map((d) => d.provider), ['meta', 'tiktok'], 'GA4 is never asked');
  assert.deepEqual(result.results.map((r) => r.outcome), ['skipped (not selected)', 'sent', 'sent']);
  assert.deepEqual(transport.sent.map((d) => d.eventId), ['purchase.ORD-1', 'purchase.ORD-1']);
});

test('selection comes before consent — an unselected provider is never asked', () => {
  const transport = recordingTransport();
  reset({
    transport,
    consent: analytics.createConsentGate(() => ({ analytics: true, marketing: false })),
  });

  const result = analytics.event('purchase', { value: 10 }, { providers: ['ga4'] });

  assert.deepEqual(result.results.map((r) => r.outcome), ['sent', 'skipped (not selected)', 'skipped (not selected)']);
});

test('the pure pieces are exported for hosts that skip the facade', () => {
  assert.ok(analytics.catalog.purchase, 'the catalog');
  assert.ok(analytics.adapters.ga4 && analytics.adapters.meta && analytics.adapters.tiktok, 'the adapters');
  assert.strictEqual(typeof analytics.core.deriveNamespace, 'function', 'the moved core');
  assert.strictEqual(typeof analytics.transports.browser.send, 'function', 'the browser transport');
  assert.deepEqual(analytics.CONSENT_CATEGORIES, ['analytics', 'marketing']);
});
