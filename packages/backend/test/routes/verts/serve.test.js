/**
 * Test: GET /omega/verts/serve — public serve route round-trips
 *
 * Uses native fetch (not the JSON http client) because the route answers
 * with a self-contained HTML page. Docs are seeded directly via the admin
 * firestore helper; the emulator's serve route reads fresh (TTL 0 under
 * FIRESTORE_EMULATOR_HOST).
 *
 * Run: npx omega test backend:routes/verts/serve
 */

const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');
async function seedAds(firestore) {
  // Intra-run isolation: wipe docs left by earlier suites (cache/crud/redirect
  // seed verts too) so the no-fill assertion is deterministic
  const existing = await firestore.collection('verts').get();

  for (const doc of existing.docs) {
    await doc.ref.delete();
  }

  // Idempotent seed — every vert blacklists nofill.example so the no-fill
  // path has a deterministic parent
  await firestore.set('verts/serve-open', {
    id: 'serve-open',
    enabled: true,
    title: 'Open Vert',
    description: 'A vert with no targeting.',
    button: 'Learn more',
    link: 'https://open-shop.example/products',
    image: '',
    footer: 'Sponsored by Open Shop',
    weight: 1,
    targeting: { sites: [], categories: [], keywords: [] },
    whitelist: [],
    blacklist: ['nofill.example'],
  });
  await firestore.set('verts/serve-target', {
    id: 'serve-target',
    enabled: true,
    title: 'Music Tools Vert',
    link: 'https://music-shop.example/tools',
    weight: 1,
    targeting: { sites: [], categories: ['music'], keywords: ['audio'] },
    whitelist: [],
    blacklist: ['nofill.example'],
  });
  await firestore.set('verts/serve-self', {
    id: 'serve-self',
    enabled: true,
    title: 'Self Vert',
    link: 'https://self-test.example/promo',
    weight: 1,
    whitelist: [],
    blacklist: ['nofill.example'],
  });
  await firestore.set('verts/serve-xss', {
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

module.exports = defineCases({
  description: 'Verts serve route (HTML unit)',
  type: 'suite',
  tests: [
    {
      name: 'serves-self-contained-html-unit',
      timeout: 30000,
      async run({ assert, firestore, config }) {
        await seedAds(firestore);

        const response = await fetch(`${config.apiUrl}/omega/verts/serve?parent=site.example&brand=site-brand&vertId=serve-open`);
        const body = await response.text();

        assert.equal(response.status, 200, 'Serve should return 200');
        assert.match(response.headers.get('content-type') || '', /text\/html/, 'Response should be HTML');
        assert.ok(body.includes('Open Vert'), 'Unit should render the vert title');
        assert.ok(body.includes('Learn more'), 'Unit should render the button');
        assert.ok(body.includes('Sponsored by Open Shop'), 'Unit should render the footer');
        assert.ok(body.includes('omega-vert:set-dimensions'), 'Unit should report dimensions via postMessage');
        assert.ok(body.includes('omega-vert:click'), 'Unit should forward clicks via postMessage');
        assert.ok(body.includes('/omega/verts/redirect?id=serve-open'), 'Click link should point at the redirect route');
        assert.ok(body.includes('brand=site-brand'), 'The redirect URL should carry the host brand id (the click utm_source)');
        assert.ok(body.includes('https://site.example'), 'postMessage should target the parent origin (origin-checked)');
        assert.ok(!body.includes('setInterval') && !body.includes('setTimeout'), 'Unit must have NO self-refresh timers (host owns lifecycle)');
        assert.ok(!body.includes('<script src') && !body.includes('<link'), 'Unit must be self-contained (no external scripts/styles)');
      },
    },

    {
      name: 'postmessage-target-preserves-dev-port',
      timeout: 30000,
      async run({ assert, config }) {
        // A dev site's parent host carries a port (localhost:4100). The unit's
        // postMessage target origin must keep it — a portless 'http://localhost'
        // origin makes the browser silently DROP every dimension report, so
        // house verts would always collapse as no-fill in local dev (found by
        // the verts step 6 company-mode proof).
        const response = await fetch(`${config.apiUrl}/omega/verts/serve?parent=localhost:4100&vertId=serve-open`);
        const body = await response.text();

        assert.equal(response.status, 200, 'Serve should return 200');
        assert.ok(body.includes('"http://localhost:4100"'), 'postMessage target origin should preserve the dev port');
        assert.ok(!body.includes('"http://localhost"'), 'portless localhost origin must not appear as the target');
      },
    },

    {
      name: 'tag-matching-serves-top-scorer',
      timeout: 30000,
      async run({ assert, config }) {
        // serve-target is the only vert scoring > 0 for these tags — deterministic
        for (let i = 0; i < 5; i++) {
          const response = await fetch(`${config.apiUrl}/omega/verts/serve?parent=site.example&tags=music,audio`);
          const body = await response.text();

          assert.equal(response.status, 200, 'Serve should return 200');
          assert.ok(body.includes('id=serve-target'), 'Top-scoring targeted vert should always win');
        }
      },
    },

    {
      name: 'never-serves-an-vert-on-its-own-host',
      timeout: 30000,
      async run({ assert, config }) {
        // Pin the self-linked vert while requesting from its own link host —
        // the pin is ineligible so another vert (or none) must serve
        const response = await fetch(`${config.apiUrl}/omega/verts/serve?parent=self-test.example&vertId=serve-self`);
        const body = response.status === 200 ? await response.text() : '';

        assert.ok(!body.includes('id=serve-self'), 'A vert must never serve on its own link host');
      },
    },

    {
      name: 'no-eligible-verts-returns-204',
      timeout: 30000,
      async run({ assert, config }) {
        // Every seeded vert blacklists nofill.example
        const response = await fetch(`${config.apiUrl}/omega/verts/serve?parent=nofill.example`);

        assert.equal(response.status, 204, 'No fill should return 204');
      },
    },

    {
      name: 'vert-content-is-escaped',
      timeout: 30000,
      async run({ assert, config }) {
        const response = await fetch(`${config.apiUrl}/omega/verts/serve?parent=site.example&vertId=serve-xss`);
        const body = await response.text();

        assert.equal(response.status, 200, 'Serve should return 200');
        assert.ok(!body.includes('<script>alert'), 'Vert title must not inject raw script tags');
        assert.ok(!body.includes('<img src=x'), 'Vert description must not inject raw elements');
        assert.ok(body.includes('&lt;script&gt;'), 'Vert title should render escaped');
        assert.ok(body.includes('&lt;img src=x'), 'Vert description should render escaped');
      },
    },

    {
      name: 'theme-and-size-params-are-accepted',
      timeout: 30000,
      async run({ assert, config }) {
        const response = await fetch(`${config.apiUrl}/omega/verts/serve?parent=site.example&vertId=serve-open&width=300&height=250&theme=dark`);
        const body = await response.text();

        assert.equal(response.status, 200, 'Serve should return 200');
        assert.ok(body.includes('data-theme="dark"'), 'Theme pin should render on the page');
        assert.ok(body.includes('max-width: 300px'), 'Width hint should apply');
        // Content-sized contract: the card carries NO baked height (the HOST
        // clamps to the preset); height feeds only the compact/stacked branches
        assert.equal(body.includes('max-height'), false, 'The card is content-sized, never height-capped in the document');
      },
    },
  ],
});
