/**
 * Root `npm run test:verts`: the verts COMPANY-MODE proof (docs/web/ads-system.md,
 * sequencing 6), offline on local emulators. The OMEGA Playground backend boots
 * (`mgr emulator --no-seed`) and seeds a small `verts` inventory; raw fetches prove
 * the HTML unit, contextual scoring, no-fill, the redirect and whitelist scoping.
 * Then the consumer side is REAL code: The Daily Build's composed config feeds a
 * real @omega.js/client, whose resolveSource() + VertUnit.buildServeUrl() build
 * the URL that is fetched against the playground emulator, the production
 * derivation (company.url to api.<host>) asserted as URL math alongside.
 * Knobs: OMEGA_SKIP_E2E=1 skips (matches the sandbox e2e lane).
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const { composeTargetConfig } = require('@omega.js/config');

const { startPlaygroundEmulator, stopPlaygroundEmulator, playgroundProjectId, PLAYGROUND_BACKEND } = require('./_emulator');

const ROOT = path.join(__dirname, '..', '..');
const NEWSFLASH_WEBSITE = path.join(ROOT, 'brands', 'newsflash-brand', 'targets', 'web');
const CLIENT_SRC = path.join(ROOT, 'packages', 'client', 'src');
const LOG_DIR = path.join(ROOT, '.temp', 'verts-e2e');

// The consumer's dev host: The Daily Build's pinned side-by-side port
const CONSUMER_HOST = 'localhost:4100';

// Seeded inventory: varied tags + weights, one whitelist-scoped vert. Verts that
// should be reachable everywhere blacklist nofill.example so the no-fill
// assertion has a deterministic parent (backend serve-suite convention).
const VERTS = [
  {
    id: 'playground-kit',
    enabled: true,
    title: 'The OMEGA Playground Kit',
    description: 'Everything the demo stack is built on, in one box.',
    button: 'Browse the kit',
    link: 'https://kit.playground.example/kit',
    image: '',
    footer: 'Sponsored by OMEGA Playground',
    weight: 5,
    targeting: { sites: [], categories: ['writing'], keywords: ['notes'] },
    whitelist: [],
    blacklist: ['nofill.example'],
  },
  {
    id: 'devnews-digest',
    enabled: true,
    title: 'The Build Radar Digest',
    description: 'Release radar and ship logs, weekly.',
    button: 'Subscribe',
    link: 'https://digest.buildtools.example/subscribe',
    image: '',
    footer: 'Sponsored by Build Tools Co',
    weight: 1,
    targeting: { sites: [], categories: ['dev-news'], keywords: ['ci'] },
    whitelist: [],
    blacklist: ['nofill.example'],
  },
  {
    id: 'dailybuild-exclusive',
    enabled: true,
    title: 'Daily Build Reader Offer',
    description: 'An offer only The Daily Build readers see.',
    button: 'Claim it',
    link: 'https://exclusive.pressroom.example/offer',
    image: '',
    footer: 'Sponsored by the Pressroom',
    weight: 1,
    targeting: { sites: [], categories: [], keywords: [] },
    whitelist: ['dailybuild.omegajs.dev'],
    blacklist: [],
  },
];

const base = (ctx) => `http://127.0.0.1:${ctx.state.ports.hosting}`;

module.exports = defineCases({
  type: 'suite',
  description: 'verts company-mode e2e (OMEGA Playground serves, The Daily Build consumes)',
  timeout: 300000,

  setup(ctx) {
    if (process.env.OMEGA_SKIP_E2E === '1') ctx.skip('OMEGA_SKIP_E2E=1');
  },

  async cleanup(ctx) {
    await stopPlaygroundEmulator(ctx.state.emulator);
  },

  tests: [
    {
      name: 'playground emulator boots (functions, firestore, hosting)',
      run: async (ctx) => {
        // --no-seed: personas are irrelevant to the verts proof, and skipping the seed keeps the lane fast.
        const { child, ports } = await startPlaygroundEmulator({ logDir: LOG_DIR, args: ['--no-seed'] });
        ctx.state.emulator = child;
        ctx.state.ports = ports;
        console.log(`    hosting :${ports.hosting}, firestore :${ports.firestore}`);
      },
    },

    {
      name: 'verts inventory seeds into the emulator Firestore',
      run: async (ctx) => {
        // firebase-admin from the backend app's own resolution, pointed at the
        // emulator (host env): no credentials, nothing cloud.
        process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${ctx.state.ports.firestore}`;
        const backendRequire = createRequire(path.join(PLAYGROUND_BACKEND, 'package.json'));
        const projectId = playgroundProjectId();

        const admin = backendRequire('firebase-admin');
        if (admin.apps.length === 0) {
          admin.initializeApp({ projectId });
        }
        const db = admin.firestore();

        // Idempotent: wipe whatever a previous run left, then seed
        const existing = await db.collection('verts').get();
        for (const doc of existing.docs) {
          await doc.ref.delete();
        }
        for (const vert of VERTS) {
          await db.doc(`verts/${vert.id}`).set(vert);
        }

        console.log(`    ${VERTS.length} verts (project ${projectId})`);
      },
    },

    {
      name: 'eligible vert serves as the self-contained HTML unit',
      run: async (ctx) => {
        const { expect } = ctx;
        const response = await fetch(`${base(ctx)}/omega/verts/serve?parent=${CONSUMER_HOST}&tags=writing,notes`);
        const body = await response.text();

        expect(response.status, `serve should 200 (got ${response.status})`).toBe(200);
        expect(response.headers.get('content-type') || '', 'response should be HTML').toMatch(/text\/html/);
        expect(body.includes('The OMEGA Playground Kit'), 'tag-matched vert title should render').toBeTruthy();
        expect(body.includes('omega-vert:set-dimensions'), 'unit should report dimensions via postMessage').toBeTruthy();
        expect(body.includes('omega-vert:click'), 'unit should forward clicks via postMessage').toBeTruthy();
        expect(body.includes('/omega/verts/redirect?id=playground-kit'), 'click link should ride the redirect route').toBeTruthy();
        expect(body.includes('"http://localhost:4100"'), 'postMessage target origin should preserve the dev port').toBeTruthy();
        expect(!body.includes('<script src') && !body.includes('<link'), 'unit must be self-contained').toBeTruthy();
        expect(!body.includes('setInterval') && !body.includes('setTimeout'), 'unit must have no self-refresh timers').toBeTruthy();
      },
    },

    {
      name: 'contextual scoring beats raw weight (5 of 5 rounds)',
      run: async (ctx) => {
        // devnews-digest (weight 1) scores 2 on these tags; playground-kit
        // (weight 5) scores 0: the top scorer must win every time
        for (let i = 0; i < 5; i++) {
          const response = await fetch(`${base(ctx)}/omega/verts/serve?parent=${CONSUMER_HOST}&tags=dev-news,ci`);
          const body = await response.text();
          ctx.expect(response.status, `serve should 200 (got ${response.status})`).toBe(200);
          ctx.expect(body.includes('id=devnews-digest'), `round ${i + 1}: tag-matched vert should beat the heavier untargeted vert`).toBeTruthy();
        }
      },
    },

    {
      name: 'no eligible inventory → 204 no-fill',
      run: async (ctx) => {
        // nofill.example: verts 1-2 blacklist it; the whitelisted vert fails closed
        const response = await fetch(`${base(ctx)}/omega/verts/serve?parent=nofill.example`);
        ctx.expect(response.status, `no-fill should 204 (got ${response.status})`).toBe(204);
      },
    },

    {
      name: 'redirect 302s only to the stored link (+ UTM), fail-closed',
      run: async (ctx) => {
        const { expect } = ctx;
        const response = await fetch(
          `${base(ctx)}/omega/verts/redirect?id=devnews-digest&parent=dailybuild.omegajs.dev&brand=daily-build&url=https://evil.example/hijack`,
          { redirect: 'manual' },
        );
        expect(response.status, `redirect should 302 (got ${response.status})`).toBe(302);

        const location = new URL(response.headers.get('location'));
        expect(location.origin + location.pathname, 'redirect must land on the STORED link (never a caller-supplied url)').toBe('https://digest.buildtools.example/subscribe');
        expect(location.searchParams.get('utm_source'), 'utm_source should be the host brand id').toBe('daily-build');
        expect(location.searchParams.get('utm_medium'), 'utm_medium should be omega-vert').toBe('omega-vert');
        expect(location.searchParams.get('utm_campaign'), 'utm_campaign should be the vert id').toBe('devnews-digest');

        const unknown = await fetch(`${base(ctx)}/omega/verts/redirect?id=no-such-vert`, { redirect: 'manual' });
        expect(unknown.status, `unknown id should 404 (got ${unknown.status})`).toBe(404);
      },
    },

    {
      name: 'whitelisted vert serves ONLY on its listed sub-brand host',
      run: async (ctx) => {
        const { expect } = ctx;
        const listed = await fetch(`${base(ctx)}/omega/verts/serve?parent=dailybuild.omegajs.dev&vertId=dailybuild-exclusive`);
        const listedBody = await listed.text();
        expect(listed.status, `listed host should 200 (got ${listed.status})`).toBe(200);
        expect(listedBody.includes('id=dailybuild-exclusive'), 'listed host should receive the whitelisted vert').toBeTruthy();

        // Another sub-brand pinning the same vert: the pin is ineligible, so
        // another vert serves or nothing does, but NEVER the whitelisted one
        const other = await fetch(`${base(ctx)}/omega/verts/serve?parent=site.example&vertId=dailybuild-exclusive`);
        const otherBody = other.status === 200 ? await other.text() : '';
        expect(!otherBody.includes('id=dailybuild-exclusive'), 'a non-listed host must never receive the whitelisted vert').toBeTruthy();

        // And with everything else ineligible the whitelist fails CLOSED
        const closed = await fetch(`${base(ctx)}/omega/verts/serve?parent=nofill.example&vertId=dailybuild-exclusive`);
        expect(closed.status, `whitelist must fail closed for unknown hosts (got ${closed.status})`).toBe(204);
      },
    },

    {
      name: 'The Daily Build composes company-mode verts config (real @omega.js/config)',
      run: (ctx) => {
        const { expect } = ctx;
        const composed = composeTargetConfig(NEWSFLASH_WEBSITE, 'web').config;
        ctx.state.composed = composed;
        expect(composed.advertising?.providers?.inhouse?.source, 'inhouse source should be company').toBe('company');
        expect(composed.advertising?.fallback, 'fallback should be inhouse').toBe('inhouse');
        expect(composed.company?.url, 'company.url should point at the parent').toBe('https://playground.omegajs.dev');
        expect(composed.advertising?.tags, 'brand tags should compose').toEqual(['dev-news', 'ci']);
      },
    },

    {
      name: 'real @omega.js/client resolves the company source to the parent stack',
      run: async (ctx) => {
        const { expect } = ctx;
        const { ports, composed } = ctx.state;
        // Browser globals exactly as the client test suite provides them, then
        // the consumer's own dev identity: The Daily Build's pinned site port
        // and the resolved parent port map (the devkit harness channel).
        require(path.join(ROOT, 'packages', 'client', 'test', 'setup.js'));
        global.window.location = {
          href: `http://${CONSUMER_HOST}/`,
          search: '',
          origin: `http://${CONSUMER_HOST}`,
          host: CONSUMER_HOST,
        };
        global.window.__OMEGA_DEV_PORTS__ = { hosting: ports.hosting };

        const { Omega } = await import(pathToFileURL(path.join(CLIENT_SRC, 'index.js')).href);
        const omega = new Omega();
        ctx.state.omega = omega;

        await omega.initialize({
          runtime: 'web',
          environment: 'development',
          brand: composed.brand,
          advertising: composed.advertising,
          company: composed.company,
          firebase: { app: { enabled: false } },
          sentry: { enabled: false },
        });

        const source = omega.verts.resolveSource();
        expect(source, `company source should resolve to the parent emulator (got ${source})`).toBe(`http://127.0.0.1:${ports.hosting}`);

        // The production derivation of the SAME company.url: the api URL a
        // deployed sub-brand would hit
        const production = omega.getApiUrl('production', composed.company.url);
        expect(production, `production derivation should prepend api. (got ${production})`).toBe('https://api.playground.omegajs.dev');

        console.log(`    ${source}`);
      },
    },

    {
      name: 'consumer-built serve request lands on the parent inventory (the REAL hop)',
      run: async (ctx) => {
        const { expect } = ctx;
        const { ports, omega } = ctx.state;
        const { VertUnit } = await import(pathToFileURL(path.join(CLIENT_SRC, 'modules', 'verts.js')).href);

        const source = omega.verts.resolveSource();
        const unit = new VertUnit(omega, {}, {
          source,
          tags: omega.config.advertising.tags,
        });
        const serveUrl = unit.buildServeUrl();

        // The URL the consumer module built, requested for real
        expect(serveUrl.startsWith(`http://127.0.0.1:${ports.hosting}/omega/verts/serve?`), `consumer URL should target the parent serve route (got ${serveUrl})`).toBeTruthy();
        expect(serveUrl.includes(`parent=${encodeURIComponent(CONSUMER_HOST)}`), 'consumer URL should carry its own host as parent').toBeTruthy();
        expect(serveUrl.includes('tags=dev-news%2Cci'), 'consumer URL should carry the brand tags').toBeTruthy();

        const response = await fetch(serveUrl);
        const body = await response.text();
        expect(response.status, `parent should fill the consumer request (got ${response.status})`).toBe(200);
        expect(body.includes('The Build Radar Digest'), "the consumer's tags should select the parent's tag-matched vert").toBeTruthy();
        expect(body.includes('id=devnews-digest'), 'served unit should be parent inventory').toBeTruthy();
        expect(body.includes('"http://localhost:4100"'), "postMessage target origin should be the CONSUMER's dev origin (port preserved)").toBeTruthy();

        console.log(`    ${serveUrl.split('?')[0]} → 200`);
      },
    },
  ],
});
