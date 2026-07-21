/**
 * Test: GET /omega/ads/serve — public serve route round-trips
 *
 * Uses native fetch (not the JSON http client) because the route answers
 * with a self-contained HTML page. Docs are seeded directly via the admin
 * firestore helper; the emulator's serve route reads fresh (TTL 0 under
 * FIRESTORE_EMULATOR_HOST).
 *
 * Run: npx omega test backend:routes/ads/serve
 */
const BASE_URL = 'http://localhost:5002';

async function seedAds(firestore) {
  // Intra-run isolation: wipe docs left by earlier suites (cache/crud/redirect
  // seed ads too) so the no-fill assertion is deterministic
  const existing = await firestore.collection('ads').get();

  for (const doc of existing.docs) {
    await doc.ref.delete();
  }

  // Idempotent seed — every ad blacklists nofill.example so the no-fill
  // path has a deterministic parent
  await firestore.set('ads/serve-open', {
    id: 'serve-open',
    enabled: true,
    title: 'Open Ad',
    description: 'An ad with no targeting.',
    button: 'Learn more',
    link: 'https://open-shop.example/products',
    image: '',
    footer: 'Sponsored by Open Shop',
    weight: 1,
    targeting: { sites: [], categories: [], keywords: [] },
    whitelist: [],
    blacklist: ['nofill.example'],
  });
  await firestore.set('ads/serve-target', {
    id: 'serve-target',
    enabled: true,
    title: 'Music Tools Ad',
    link: 'https://music-shop.example/tools',
    weight: 1,
    targeting: { sites: [], categories: ['music'], keywords: ['audio'] },
    whitelist: [],
    blacklist: ['nofill.example'],
  });
  await firestore.set('ads/serve-self', {
    id: 'serve-self',
    enabled: true,
    title: 'Self Ad',
    link: 'https://self-test.example/promo',
    weight: 1,
    whitelist: [],
    blacklist: ['nofill.example'],
  });
  await firestore.set('ads/serve-xss', {
    id: 'serve-xss',
    enabled: true,
    title: '<script>alert("xss")</script>',
    description: '"><img src=x onerror=alert(1)>',
    link: 'https://xss-shop.example/x',
    weight: 1,
    whitelist: [],
    blacklist: ['nofill.example'],
  });
}

module.exports = {
  description: 'Ads serve route (HTML unit)',
  type: 'suite',
  tests: [
    {
      name: 'serves-self-contained-html-unit',
      timeout: 30000,
      async run({ assert, firestore }) {
        await seedAds(firestore);

        const response = await fetch(`${BASE_URL}/omega/ads/serve?parent=site.example&adId=serve-open`);
        const body = await response.text();

        assert.equal(response.status, 200, 'Serve should return 200');
        assert.match(response.headers.get('content-type') || '', /text\/html/, 'Response should be HTML');
        assert.ok(body.includes('Open Ad'), 'Unit should render the ad title');
        assert.ok(body.includes('Learn more'), 'Unit should render the button');
        assert.ok(body.includes('Sponsored by Open Shop'), 'Unit should render the footer');
        assert.ok(body.includes('omega-ad:set-dimensions'), 'Unit should report dimensions via postMessage');
        assert.ok(body.includes('omega-ad:click'), 'Unit should forward clicks via postMessage');
        assert.ok(body.includes('/omega/ads/redirect?id=serve-open'), 'Click link should point at the redirect route');
        assert.ok(body.includes('https://site.example'), 'postMessage should target the parent origin (origin-checked)');
        assert.ok(!body.includes('setInterval') && !body.includes('setTimeout'), 'Unit must have NO self-refresh timers (host owns lifecycle)');
        assert.ok(!body.includes('<script src') && !body.includes('<link'), 'Unit must be self-contained (no external scripts/styles)');
      },
    },

    {
      name: 'postmessage-target-preserves-dev-port',
      timeout: 30000,
      async run({ assert }) {
        // A dev site's parent host carries a port (localhost:4100). The unit's
        // postMessage target origin must keep it — a portless 'http://localhost'
        // origin makes the browser silently DROP every dimension report, so
        // house ads would always collapse as no-fill in local dev (found by
        // the ads step 6 company-mode proof).
        const response = await fetch(`${BASE_URL}/omega/ads/serve?parent=localhost:4100&adId=serve-open`);
        const body = await response.text();

        assert.equal(response.status, 200, 'Serve should return 200');
        assert.ok(body.includes('"http://localhost:4100"'), 'postMessage target origin should preserve the dev port');
        assert.ok(!body.includes('"http://localhost"'), 'portless localhost origin must not appear as the target');
      },
    },

    {
      name: 'tag-matching-serves-top-scorer',
      timeout: 30000,
      async run({ assert }) {
        // serve-target is the only ad scoring > 0 for these tags — deterministic
        for (let i = 0; i < 5; i++) {
          const response = await fetch(`${BASE_URL}/omega/ads/serve?parent=site.example&tags=music,audio`);
          const body = await response.text();

          assert.equal(response.status, 200, 'Serve should return 200');
          assert.ok(body.includes('id=serve-target'), 'Top-scoring targeted ad should always win');
        }
      },
    },

    {
      name: 'never-serves-an-ad-on-its-own-host',
      timeout: 30000,
      async run({ assert }) {
        // Pin the self-linked ad while requesting from its own link host —
        // the pin is ineligible so another ad (or none) must serve
        const response = await fetch(`${BASE_URL}/omega/ads/serve?parent=self-test.example&adId=serve-self`);
        const body = response.status === 200 ? await response.text() : '';

        assert.ok(!body.includes('id=serve-self'), 'An ad must never serve on its own link host');
      },
    },

    {
      name: 'no-eligible-ads-returns-204',
      timeout: 30000,
      async run({ assert }) {
        // Every seeded ad blacklists nofill.example
        const response = await fetch(`${BASE_URL}/omega/ads/serve?parent=nofill.example`);

        assert.equal(response.status, 204, 'No fill should return 204');
      },
    },

    {
      name: 'ad-content-is-escaped',
      timeout: 30000,
      async run({ assert }) {
        const response = await fetch(`${BASE_URL}/omega/ads/serve?parent=site.example&adId=serve-xss`);
        const body = await response.text();

        assert.equal(response.status, 200, 'Serve should return 200');
        assert.ok(!body.includes('<script>alert'), 'Ad title must not inject raw script tags');
        assert.ok(!body.includes('<img src=x'), 'Ad description must not inject raw elements');
        assert.ok(body.includes('&lt;script&gt;'), 'Ad title should render escaped');
        assert.ok(body.includes('&lt;img src=x'), 'Ad description should render escaped');
      },
    },

    {
      name: 'theme-and-size-params-are-accepted',
      timeout: 30000,
      async run({ assert }) {
        const response = await fetch(`${BASE_URL}/omega/ads/serve?parent=site.example&adId=serve-open&width=300&height=250&theme=dark`);
        const body = await response.text();

        assert.equal(response.status, 200, 'Serve should return 200');
        assert.ok(body.includes('data-theme="dark"'), 'Theme pin should render on the page');
        assert.ok(body.includes('max-width: 300px'), 'Width hint should apply');
        assert.ok(body.includes('max-height: 250px'), 'Height hint should apply');
      },
    },
  ],
};
