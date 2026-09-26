// Main-process tests for lib/auth-flow.js — the openAuthFlow() sign-in round trip.
// The dev loopback listener is REAL (http server on 127.0.0.1, real GETs simulate the
// browser's redirect back); only the pieces that would leave the machine are stubbed
// (shell.openExternal, auth.handleToken, windows.get's show/focus surface).

const http = require('http');
const defineCases = require('@omega.js/devkit/test/define-cases');

// Minimal GET helper — resolves { status, body }.
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stub the externals for one test body. Returns { opened, tokens, shown, restore }.
//
// The baked `dev` block is staged too: the sign-in chain starts at
// getWebsiteUrl(), which since
// [#834](https://github.com/Omega-JS-Stack/omega/issues/834) answers from the
// resolved dev map the bundle task bakes (whose floor is @omega.js/config's
// classic numbers) and throws when an artifact carries none. The harness instance
// loads src/defaults' config, which has no build behind it, so a real dev
// artifact's block is stated here.
function stubExternals(ctx) {
  const electron = require('electron');
  const { CLASSIC_PORTS } = require('@omega.js/config');
  const opened = [];
  const tokens = [];
  const shown = [];
  const origOpen = electron.shell.openExternal;
  const origHandle = ctx.omega.auth.handleToken;
  const origShow = ctx.omega.windows.show;
  const origDev = ctx.omega.config.dev;
  electron.shell.openExternal = async (url) => { opened.push(url); };
  ctx.omega.auth.handleToken = (t) => { tokens.push(t); };
  ctx.omega.windows.show = (name) => { shown.push(name); };
  ctx.omega.config.dev = { ports: { ...CLASSIC_PORTS } };
  return {
    opened,
    tokens,
    shown,
    restore() {
      electron.shell.openExternal = origOpen;
      ctx.omega.auth.handleToken = origHandle;
      ctx.omega.windows.show = origShow;
      if (origDev !== undefined) ctx.omega.config.dev = origDev; else delete ctx.omega.config.dev;
      ctx.omega.authFlow.cancel();
    },
  };
}

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'auth-flow (main)',
  tests: [
    {
      name: 'initialize ran during boot',
      run: (ctx) => {
        ctx.expect(ctx.omega.authFlow._initialized).toBe(true);
      },
    },
    {
      name: 'dev open(): binds a loopback listener and opens the chain ending at it',
      run: async (ctx) => {
        const stubs = stubExternals(ctx);
        try {
          const { url, port } = await ctx.omega.openAuthFlow();
          ctx.expect(typeof port).toBe('number');
          ctx.expect(stubs.opened[0]).toBe(url);

          // Decompose: /signin → /token → http://127.0.0.1:<port>/auth/token?state=<nonce>
          const signin = new URL(url);
          ctx.expect(signin.pathname).toBe('/signin');
          const tokenUrl = new URL(signin.searchParams.get('authReturnUrl'));
          ctx.expect(tokenUrl.pathname).toBe('/token');
          const returnUrl = new URL(tokenUrl.searchParams.get('authReturnUrl'));
          ctx.expect(returnUrl.hostname).toBe('127.0.0.1');
          ctx.expect(Number(returnUrl.port)).toBe(port);
          ctx.expect(returnUrl.pathname).toBe('/auth/token');
          ctx.expect(returnUrl.searchParams.get('state')).toBe(ctx.omega.authFlow._pending.nonce);
        } finally {
          stubs.restore();
        }
      },
    },
    {
      name: 'valid browser return: 200 page, token → handleToken, listener torn down, app surfaced',
      run: async (ctx) => {
        const stubs = stubExternals(ctx);
        try {
          const { port } = await ctx.omega.openAuthFlow();
          const nonce = ctx.omega.authFlow._pending.nonce;

          const res = await get(`http://127.0.0.1:${port}/auth/token?authToken=TOK-1&state=${nonce}`);
          ctx.expect(res.status).toBe(200);
          ctx.expect(res.body).toMatch(/Signed in/);
          ctx.expect(stubs.tokens).toEqual(['TOK-1']);
          ctx.expect(stubs.shown).toEqual(['main']);

          // One-shot: the listener is gone.
          ctx.expect(ctx.omega.authFlow._pending).toBeNull();
          let refused = false;
          await get(`http://127.0.0.1:${port}/auth/token?authToken=x&state=${nonce}`).catch(() => { refused = true; });
          ctx.expect(refused).toBe(true);
        } finally {
          stubs.restore();
        }
      },
    },
    {
      name: 'bad state or missing token: 400, no handleToken, listener SURVIVES for the real return',
      run: async (ctx) => {
        const stubs = stubExternals(ctx);
        try {
          const { port } = await ctx.omega.openAuthFlow();
          const nonce = ctx.omega.authFlow._pending.nonce;

          const bad1 = await get(`http://127.0.0.1:${port}/auth/token?authToken=EVIL&state=wrong`);
          ctx.expect(bad1.status).toBe(400);
          const bad2 = await get(`http://127.0.0.1:${port}/auth/token?state=${nonce}`);
          ctx.expect(bad2.status).toBe(400);
          const lost = await get(`http://127.0.0.1:${port}/favicon.ico`);
          ctx.expect(lost.status).toBe(404);
          ctx.expect(stubs.tokens).toEqual([]);

          // The legitimate return still lands.
          const ok = await get(`http://127.0.0.1:${port}/auth/token?authToken=TOK-2&state=${nonce}`);
          ctx.expect(ok.status).toBe(200);
          ctx.expect(stubs.tokens).toEqual(['TOK-2']);
        } finally {
          stubs.restore();
        }
      },
    },
    {
      name: 'a new open() supersedes the previous listener (single-flight)',
      run: async (ctx) => {
        const stubs = stubExternals(ctx);
        try {
          const first = await ctx.omega.openAuthFlow();
          const second = await ctx.omega.openAuthFlow();

          // The first port no longer answers (unless the OS re-issued the same port to the
          // second listener, in which case the nonce changed anyway).
          if (first.port !== second.port) {
            let refused = false;
            await get(`http://127.0.0.1:${first.port}/auth/token`).catch(() => { refused = true; });
            ctx.expect(refused).toBe(true);
          }
          ctx.expect(ctx.omega.authFlow._pending.port).toBe(second.port);
        } finally {
          stubs.restore();
        }
      },
    },
    {
      name: 'timeout tears the listener down; cancel() is idempotent',
      run: async (ctx) => {
        const stubs = stubExternals(ctx);
        try {
          const { port } = await ctx.omega.openAuthFlow({ timeoutMs: 50 });
          ctx.expect(ctx.omega.authFlow._pending.port).toBe(port);
          await sleep(150);
          ctx.expect(ctx.omega.authFlow._pending).toBeNull();
          ctx.omega.authFlow.cancel();
          ctx.omega.authFlow.cancel();
        } finally {
          stubs.restore();
        }
      },
    },
    {
      name: 'production open(): plain external open of getAuthUrl(), no listener',
      run: async (ctx) => {
        const stubs = stubExternals(ctx);
        const omega = ctx.omega;
        const origIsProd = omega.isProduction;
        omega.config.brand = omega.config.brand || {};
        const origUrl = omega.config.brand.url;
        omega.isProduction = () => true;
        omega.config.brand.url = 'https://example.com';
        try {
          const { url, port } = await omega.openAuthFlow();
          ctx.expect(port).toBeUndefined();
          ctx.expect(ctx.omega.authFlow._pending).toBeNull();
          ctx.expect(stubs.opened[0]).toBe(url);
          // Prod URL must ride the custom scheme, not a loopback return.
          const signin = new URL(url);
          const tokenUrl = new URL(signin.searchParams.get('authReturnUrl'));
          const finalHop = tokenUrl.searchParams.get('authReturnUrl');
          ctx.expect(finalHop).toBe(`${omega.config.brand.id}://auth/token`);
        } finally {
          omega.isProduction = origIsProd;
          if (origUrl !== undefined) omega.config.brand.url = origUrl; else delete omega.config.brand.url;
          stubs.restore();
        }
      },
    },
  ],
});
