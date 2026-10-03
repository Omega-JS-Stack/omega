// Unit tests for src/license.js — the deploy-time license verdict (#320).
//
// The endpoint is a CONSTANT (the omega brand's own api host), so there is no
// base-URL seam to aim a local server at: `transport` is the injected fetch and
// every case here runs fully offline.

const defineCases = require('@omega.js/devkit/test/define-cases');

const { resolveLicenseVerdict, resolveLicenseStamp, licenseStamp, KEYLESS_STAMP, LICENSE_ENDPOINT } = require('../src/license.js');

// A brand that is NOT a demo-* project — the only shape that reaches the server.
const LIVE_CONFIG = { brand: { id: 'acme' }, cloud: { config: { projectId: 'acme-prod' } } };
const DEMO_CONFIG = { brand: { id: 'naked-brand' }, cloud: { config: { projectId: 'demo-naked-brand' } } };

// A transport that records its calls and answers with what the test hands it.
function stubTransport(answer) {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    if (typeof answer === 'function') return answer(url, options);
    return answer;
  };
  transport.calls = calls;
  return transport;
}

// The `{ user }` body GET /user responds with, wrapped as a fetch Response.
function userResponse(user, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ user }),
  };
}

const PAID_USER = { subscription: { product: { id: 'pro' }, status: 'active' } };
const BASIC_USER = { subscription: { product: { id: 'basic' }, status: 'active' } };
const CANCELLED_USER = { subscription: { product: { id: 'pro' }, status: 'cancelled' } };

module.exports = defineCases({
  type: 'group',
  description: 'license',
  tests: [
    {
      name: 'the endpoint is the omega brand api host, hardcoded',
      run: (ctx) => {
        ctx.expect(LICENSE_ENDPOINT).toBe('https://api.omegajs.dev/omega/user');
      },
    },

    {
      name: 'no key: the keyless verdict, and nothing is asked of the network',
      run: async (ctx) => {
        const transport = stubTransport(userResponse(PAID_USER));

        const verdict = await resolveLicenseVerdict({ config: LIVE_CONFIG, env: {}, transport });

        ctx.expect(transport.calls, 'a keyless context never calls the license server').toEqual([]);
        ctx.expect(verdict.licensed).toBe(false);
        ctx.expect(verdict.payments).toBe('gated');
        ctx.expect(verdict.attribution).toBe('shown');
        ctx.expect(verdict.reason).toMatch(/OMEGA_LICENSE_KEY/);
      },
    },

    {
      name: 'an empty/whitespace key is no key',
      run: async (ctx) => {
        const transport = stubTransport(userResponse(PAID_USER));

        for (const value of ['', '   ']) {
          const verdict = await resolveLicenseVerdict({ config: LIVE_CONFIG, env: { OMEGA_LICENSE_KEY: value }, transport });
          ctx.expect(verdict.licensed).toBe(false);
        }

        ctx.expect(transport.calls, 'nothing to send means nothing is sent').toEqual([]);
      },
    },

    {
      name: 'a demo-* project is keyless-dev forever, key present or not (spec call 5)',
      run: async (ctx) => {
        const transport = stubTransport(userResponse(PAID_USER));

        const verdict = await resolveLicenseVerdict({
          config: DEMO_CONFIG,
          env: { OMEGA_LICENSE_KEY: 'live-key' },
          transport,
        });

        ctx.expect(transport.calls, 'the test brands never phone the license server').toEqual([]);
        ctx.expect(verdict.licensed).toBe(false);
        ctx.expect(verdict.payments).toBe('gated');
        ctx.expect(verdict.attribution).toBe('shown');
        ctx.expect(verdict.reason).toMatch(/demo-naked-brand/);
      },
    },

    {
      name: 'a paid plan is the LICENSED verdict — payments live, attribution removed',
      run: async (ctx) => {
        const transport = stubTransport(userResponse(PAID_USER));

        const verdict = await resolveLicenseVerdict({
          config: LIVE_CONFIG,
          env: { OMEGA_LICENSE_KEY: 'live-key' },
          transport,
        });

        ctx.expect(verdict.licensed).toBe(true);
        ctx.expect(verdict.payments).toBe('live');
        ctx.expect(verdict.attribution).toBe('removed');
        ctx.expect(verdict.reason).toMatch(/pro/);
      },
    },

    {
      name: 'the request carries the key and the brand id (the server counts brands per key)',
      run: async (ctx) => {
        const transport = stubTransport(userResponse(PAID_USER));

        await resolveLicenseVerdict({ config: LIVE_CONFIG, env: { OMEGA_LICENSE_KEY: 'live-key' }, transport });

        ctx.expect(transport.calls.length).toBe(1);
        const url = new URL(transport.calls[0].url);
        ctx.expect(`${url.origin}${url.pathname}`).toBe(LICENSE_ENDPOINT);
        ctx.expect(url.searchParams.get('apiKey')).toBe('live-key');
        ctx.expect(url.searchParams.get('brandId')).toBe('acme');
      },
    },

    {
      name: 'a real account with no live subscription is a keyless verdict, not a throw',
      run: async (ctx) => {
        // The `basic` sentinel IS "no subscription": a free omegajs.dev account, and
        // a cancelled one, which resolves to the same plan.
        for (const user of [BASIC_USER, CANCELLED_USER]) {
          const transport = stubTransport(userResponse(user));

          const verdict = await resolveLicenseVerdict({
            config: LIVE_CONFIG,
            env: { OMEGA_LICENSE_KEY: 'free-account-key' },
            transport,
          });

          ctx.expect(verdict.licensed).toBe(false);
          ctx.expect(verdict.payments).toBe('gated');
          ctx.expect(verdict.attribution).toBe('shown');
          ctx.expect(verdict.reason).toMatch(/no active omegajs\.dev subscription/);
        }
      },
    },

    {
      name: 'an unreachable server THROWS — a key present is never a quiet gate',
      run: async (ctx) => {
        const transport = stubTransport(() => { throw new Error('getaddrinfo ENOTFOUND api.omegajs.dev'); });

        await ctx.expect((() => resolveLicenseVerdict({ config: LIVE_CONFIG, env: { OMEGA_LICENSE_KEY: 'live-key' }, transport }))()).rejects.toThrow(/could not be reached.*ENOTFOUND/s);
      },
    },

    {
      name: 'a rejected key THROWS — a typo must never ship a gated artifact for a paying brand',
      run: async (ctx) => {
        const transport = stubTransport(userResponse(null, { status: 401 }));

        await ctx.expect((() => resolveLicenseVerdict({ config: LIVE_CONFIG, env: { OMEGA_LICENSE_KEY: 'typod-key' }, transport }))()).rejects.toThrow(/rejected.*401/s);
      },
    },

    {
      name: 'a key that resolves NOBODY throws too (a 200 with no user)',
      run: async (ctx) => {
        const transport = stubTransport(userResponse(undefined));

        await ctx.expect((() => resolveLicenseVerdict({ config: LIVE_CONFIG, env: { OMEGA_LICENSE_KEY: 'ghost-key' }, transport }))()).rejects.toThrow(/resolved no account/);
      },
    },

    {
      name: 'an unreadable answer throws — never a silent gate',
      run: async (ctx) => {
        const transport = stubTransport({
          ok: true,
          status: 200,
          json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
        });

        await ctx.expect((() => resolveLicenseVerdict({ config: LIVE_CONFIG, env: { OMEGA_LICENSE_KEY: 'live-key' }, transport }))()).rejects.toThrow(/could not be read/);
      },
    },

    // ─── The stamp: what every consumer records (#320, half 2) ───

    {
      name: 'the stamp is the verdict without the reason — one shape for every target',
      run: (ctx) => {
        const licensed = licenseStamp({ licensed: true, payments: 'live', attribution: 'removed', reason: 'licensed by the omegajs.dev "pro" subscription' });

        ctx.expect(licensed).toEqual({ status: 'licensed', payments: 'live', attribution: 'removed' });
        ctx.expect('reason' in licensed, 'the reason names the account plan — a shipped artifact is public').toBe(false);
        ctx.expect(licenseStamp({ licensed: false, payments: 'gated', attribution: 'shown', reason: 'no key' })).toEqual(KEYLESS_STAMP);
      },
    },

    {
      name: 'a build that runs no check stamps keyless, and asks the network nothing',
      run: async (ctx) => {
        const transport = stubTransport(userResponse(PAID_USER));

        const stamp = await resolveLicenseStamp({
          config: LIVE_CONFIG,
          production: false,
          env: { OMEGA_LICENSE_KEY: 'live-key' },
          transport,
        });

        ctx.expect(transport.calls, 'no check runs outside a production build (spec call 5)').toEqual([]);
        ctx.expect(stamp).toEqual({ status: 'keyless', payments: 'gated', attribution: 'shown' });
      },
    },

    {
      name: 'a production build stamps the resolved verdict',
      run: async (ctx) => {
        const transport = stubTransport(userResponse(PAID_USER));

        const stamp = await resolveLicenseStamp({
          config: LIVE_CONFIG,
          production: true,
          env: { OMEGA_LICENSE_KEY: 'live-key' },
          transport,
        });

        ctx.expect(transport.calls.length).toBe(1);
        ctx.expect(stamp).toEqual({ status: 'licensed', payments: 'live', attribution: 'removed' });
      },
    },

    {
      name: 'a production build with a dead key throws — the stamp lane gates the deploy too',
      run: async (ctx) => {
        const transport = stubTransport(userResponse(null, { status: 401 }));

        await ctx.expect((() => resolveLicenseStamp({ config: LIVE_CONFIG, production: true, env: { OMEGA_LICENSE_KEY: 'typod-key' }, transport }))()).rejects.toThrow(/rejected.*401/s);
      },
    },
  ],
});
