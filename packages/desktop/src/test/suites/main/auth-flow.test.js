// Main-process tests for lib/auth-flow.js — the openAuthFlow() sign-in round trip.
// The dev loopback listener is REAL (http server on 127.0.0.1, real GETs simulate the
// browser's redirect back); only the pieces that would leave the machine are stubbed
// (shell.openExternal, omega.handleAuthToken, windows.get's show/focus surface).

const http = require('http');

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
function stubExternals(ctx) {
  const electron = require('electron');
  const opened = [];
  const tokens = [];
  const shown = [];
  const origOpen = electron.shell.openExternal;
  const origHandle = ctx.manager.omega.handleAuthToken;
  const origShow = ctx.manager.windows.show;
  electron.shell.openExternal = async (url) => { opened.push(url); };
  ctx.manager.omega.handleAuthToken = (t) => { tokens.push(t); };
  ctx.manager.windows.show = (name) => { shown.push(name); };
  return {
    opened,
    tokens,
    shown,
    restore() {
      electron.shell.openExternal = origOpen;
      ctx.manager.omega.handleAuthToken = origHandle;
      ctx.manager.windows.show = origShow;
      ctx.manager.authFlow.cancel();
    },
  };
}

module.exports = {
  type: 'suite',
  layer: 'main',
  description: 'auth-flow (main)',
  tests: [
    {
      name: 'initialize ran during boot',
      run: (ctx) => {
        ctx.expect(ctx.manager.authFlow._initialized).toBe(true);
      },
    },
    {
      name: 'dev open(): binds a loopback listener and opens the chain ending at it',
      run: async (ctx) => {
        const stubs = stubExternals(ctx);
        try {
          const { url, port } = await ctx.manager.openAuthFlow();
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
          ctx.expect(returnUrl.searchParams.get('state')).toBe(ctx.manager.authFlow._pending.nonce);
        } finally {
          stubs.restore();
        }
      },
    },
    {
      name: 'valid browser return: 200 page, token → handleAuthToken, listener torn down, app surfaced',
      run: async (ctx) => {
        const stubs = stubExternals(ctx);
        try {
          const { port } = await ctx.manager.openAuthFlow();
          const nonce = ctx.manager.authFlow._pending.nonce;

          const res = await get(`http://127.0.0.1:${port}/auth/token?authToken=TOK-1&state=${nonce}`);
          ctx.expect(res.status).toBe(200);
          ctx.expect(res.body).toMatch(/Signed in/);
          ctx.expect(stubs.tokens).toEqual(['TOK-1']);
          ctx.expect(stubs.shown).toEqual(['main']);

          // One-shot: the listener is gone.
          ctx.expect(ctx.manager.authFlow._pending).toBeNull();
          let refused = false;
          await get(`http://127.0.0.1:${port}/auth/token?authToken=x&state=${nonce}`).catch(() => { refused = true; });
          ctx.expect(refused).toBe(true);
        } finally {
          stubs.restore();
        }
      },
    },
    {
      name: 'bad state or missing token: 400, no handleAuthToken, listener SURVIVES for the real return',
      run: async (ctx) => {
        const stubs = stubExternals(ctx);
        try {
          const { port } = await ctx.manager.openAuthFlow();
          const nonce = ctx.manager.authFlow._pending.nonce;

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
          const first = await ctx.manager.openAuthFlow();
          const second = await ctx.manager.openAuthFlow();

          // The first port no longer answers (unless the OS re-issued the same port to the
          // second listener, in which case the nonce changed anyway).
          if (first.port !== second.port) {
            let refused = false;
            await get(`http://127.0.0.1:${first.port}/auth/token`).catch(() => { refused = true; });
            ctx.expect(refused).toBe(true);
          }
          ctx.expect(ctx.manager.authFlow._pending.port).toBe(second.port);
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
          const { port } = await ctx.manager.openAuthFlow({ timeoutMs: 50 });
          ctx.expect(ctx.manager.authFlow._pending.port).toBe(port);
          await sleep(150);
          ctx.expect(ctx.manager.authFlow._pending).toBeNull();
          ctx.manager.authFlow.cancel();
          ctx.manager.authFlow.cancel();
        } finally {
          stubs.restore();
        }
      },
    },
    {
      name: 'production open(): plain external open of getAuthUrl(), no listener',
      run: async (ctx) => {
        const stubs = stubExternals(ctx);
        const m = ctx.manager;
        const origIsProd = m.isProduction;
        m.config.brand = m.config.brand || {};
        const origUrl = m.config.brand.url;
        m.isProduction = () => true;
        m.config.brand.url = 'https://example.com';
        try {
          const { url, port } = await m.openAuthFlow();
          ctx.expect(port).toBeUndefined();
          ctx.expect(ctx.manager.authFlow._pending).toBeNull();
          ctx.expect(stubs.opened[0]).toBe(url);
          // Prod URL must ride the custom scheme, not a loopback return.
          const signin = new URL(url);
          const tokenUrl = new URL(signin.searchParams.get('authReturnUrl'));
          const finalHop = tokenUrl.searchParams.get('authReturnUrl');
          ctx.expect(finalHop).toBe(`${m.config.brand.id}://auth/token`);
        } finally {
          m.isProduction = origIsProd;
          if (origUrl !== undefined) m.config.brand.url = origUrl; else delete m.config.brand.url;
          stubs.restore();
        }
      },
    },
  ],
};
