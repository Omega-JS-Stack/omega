/**
 * #467 (Phase 2 checklist): the head warms the origins the page will actually
 * talk to.
 *
 * Chatsy has had a config-gated `preconnect` + `dns-prefetch` pair in
 * `core/_includes/core/head.html` since forever; none of the third parties the
 * page loads FIRST did. The analytics loader
 * (`core/js/core/analytics-loader.js`) injects gtag.js, fbevents.js and the
 * TikTok pixel from three fixed origins, and `@omega.js/client` boots the
 * Firebase SDK (auth token refresh + the account doc read) as soon as
 * `cloud.config.apiKey` resolves. Each one costs a cold DNS + TLS handshake on
 * the critical path.
 *
 * The gate is the SAME config read the loader makes — a provider with no id is
 * never injected, so it must never be warmed either. An unconfigured brand
 * ships exactly the head it shipped before.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const { buildWith, miniData } = require('./lib/build.js');

// The preconnect block only: a later origin in the body must not pass for one
// in the head's warmup list.
const warmupBlock = (html) => {
  const start = html.indexOf('<!-- Prefetch and Preconnect -->');
  assert.ok(start !== -1, 'the head still opens a warmup block');
  const end = html.indexOf('<!-- Meta -->', start);
  assert.ok(end !== -1, 'and closes it before the meta block');
  return html.slice(start, end);
};

// A commented-out candidate (the head parks several) is not a warmup.
const warms = (block, origin) => {
  const live = block.split('\n').filter((line) => !line.trim().startsWith('<!--')).join('\n');
  return {
    preconnect: live.includes(`rel="preconnect" href="${origin}"`),
    dnsPrefetch: live.includes(`rel="dns-prefetch" href="${origin}"`),
  };
};

test('#467: an analytics provider with an id gets its origin warmed', async () => {
  const pages = await buildWith(
    {
      ...miniData,
      analytics: { providers: { google: { id: 'G-TEST' }, tiktok: { id: 'TT-TEST' } } },
    },
    {},
    'head-preconnect-analytics',
  );
  const block = warmupBlock(pages.get('/'));

  // gtag.js — a plain <script src>, so no crossorigin: an anonymous
  // preconnect would open a SECOND connection the tag never reuses.
  const gtag = warms(block, 'https://www.googletagmanager.com');
  assert.ok(gtag.preconnect, 'GA4 loads gtag.js from googletagmanager.com');
  assert.ok(gtag.dnsPrefetch, 'with the dns-prefetch fallback beside it');
  assert.ok(
    !block.includes('href="https://www.googletagmanager.com" crossorigin'),
    'a script fetch is not CORS, so the warmup is not anonymous',
  );

  const tiktok = warms(block, 'https://analytics.tiktok.com');
  assert.ok(tiktok.preconnect, 'the TikTok pixel loads from analytics.tiktok.com');
  assert.ok(tiktok.dnsPrefetch, 'with its dns-prefetch fallback');

  // Meta was NOT configured in this build, so its origin stays cold.
  assert.ok(!warms(block, 'https://connect.facebook.net').preconnect, 'an unconfigured provider is never warmed');
});

test('#467: no analytics ids, no analytics warmup', async () => {
  const pages = await buildWith(miniData, {}, 'head-preconnect-none');
  const block = warmupBlock(pages.get('/'));

  for (const origin of ['https://www.googletagmanager.com', 'https://connect.facebook.net', 'https://analytics.tiktok.com']) {
    assert.ok(!warms(block, origin).preconnect, `${origin} is not warmed for a brand that loads nothing from it`);
    assert.ok(!warms(block, origin).dnsPrefetch, `${origin} gets no dns-prefetch either`);
  }
});

test('#467: the Meta pixel origin rides its own id', async () => {
  const pages = await buildWith(
    { ...miniData, analytics: { providers: { meta: { id: '1234567890' } } } },
    {},
    'head-preconnect-meta',
  );
  const block = warmupBlock(pages.get('/'));

  assert.ok(warms(block, 'https://connect.facebook.net').preconnect, 'fbevents.js loads from connect.facebook.net');
  assert.ok(!warms(block, 'https://www.googletagmanager.com').preconnect, 'and GA4 stays cold on its own gate');
});

test('#467: Firebase origins ride the apiKey the client boots on', async () => {
  const pages = await buildWith(
    { ...miniData, cloud: { config: { projectId: 'demo-mini', apiKey: 'AIza-TEST' } } },
    {},
    'head-preconnect-firebase',
  );
  const block = warmupBlock(pages.get('/'));

  // Both are XHR/fetch from the SDK, so the warmup MUST be anonymous or the
  // connection is not the one the request reuses.
  for (const origin of ['https://securetoken.googleapis.com', 'https://firestore.googleapis.com']) {
    assert.ok(warms(block, origin).dnsPrefetch, `${origin} carries the dns-prefetch fallback`);
    assert.ok(block.includes(`rel="preconnect" href="${origin}" crossorigin/>`), `${origin} is warmed as a CORS origin`);
  }
});

test('#467: a Firebase-less brand warms no Google API origin', async () => {
  const pages = await buildWith(
    { ...miniData, cloud: { config: { projectId: 'demo-mini' } } },
    {},
    'head-preconnect-no-apikey',
  );
  const block = warmupBlock(pages.get('/'));

  // projectId alone resolves for URL derivation but never boots the SDK
  // (@omega.js/client index.js: `_resolveFirebaseConfig()?.apiKey`).
  for (const origin of ['https://securetoken.googleapis.com', 'https://firestore.googleapis.com']) {
    assert.ok(!warms(block, origin).preconnect, `${origin} stays cold without an apiKey to boot on`);
  }
});
