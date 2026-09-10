// Tests for src/utils/url-helpers.js — getFunctionsUrl / getApiUrl / getWebsiteUrl —
// plus the getEnvironment() resolution they depend on (getEnvironment itself is the
// SSOT defined in src/utils/mode-helpers.js; these tests exercise it through the
// Manager because the URL helpers route through `this.config` and `this.getEnvironment()`).
// The manager (already bootstrapped by the test harness) is the natural object under test.

const defineCases = require('@omega.js/devkit/test/define-cases');

// Every case that pins a CLASSIC local answer silences the whole baked `dev`
// block: the `dev.ports` map (#745) and the `dev.origin` the website publishes
// (#747). The harness manager loads src/defaults' config, which carries no `dev`
// block, so today this is a no-op guard; it exists so a harness that one day
// seeds a real build blob cannot turn these classic pins red.
function withoutBakedPorts(manager, fn) {
  const original = manager.config.dev;
  delete manager.config.dev;
  try { return fn(); } finally {
    if (original !== undefined) manager.config.dev = original;
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'url-helpers (cross-context)',
  tests: [
    {
      name: 'getEnvironment: testing (OMEGA_TEST_MODE) wins; else config.em.environment',
      run: (ctx) => {
        const m = ctx.manager;
        const orig = m.config?.em?.environment;
        const origTest = process.env.OMEGA_TEST_MODE;
        m.config.em = m.config.em || {};
        try {
          // Testing takes precedence over the config override.
          process.env.OMEGA_TEST_MODE = 'true';
          m.config.em.environment = 'production';
          ctx.expect(m.getEnvironment()).toBe('testing');
          // With testing cleared, the config override is honored.
          delete process.env.OMEGA_TEST_MODE;
          m.config.em.environment = 'development';
          ctx.expect(m.getEnvironment()).toBe('development');
          m.config.em.environment = 'production';
          ctx.expect(m.getEnvironment()).toBe('production');
        } finally {
          m.config.em.environment = orig;
          if (origTest === undefined) delete process.env.OMEGA_TEST_MODE; else process.env.OMEGA_TEST_MODE = origTest;
        }
      },
    },
    {
      // In the MAIN process, app.isPackaged is the authoritative signal and beats the
      // OMEGA_BUILD_MODE fallback. The test harness is unpackaged, so once testing + config are
      // cleared, getEnvironment() resolves to 'development' from app.isPackaged === false —
      // regardless of OMEGA_BUILD_MODE. (The OMEGA_BUILD_MODE fallback only applies where `app` is
      // unavailable: renderer / preload / plain Node — covered by the build-layer manager test.)
      name: 'getEnvironment: app.isPackaged (unpackaged → development) wins over OMEGA_BUILD_MODE in main',
      run: (ctx) => {
        const m = ctx.manager;
        const origEnv  = m.config?.em?.environment;
        const origBuild = process.env.OMEGA_BUILD_MODE;
        const origTest = process.env.OMEGA_TEST_MODE;
        if (m.config.em) delete m.config.em.environment;
        delete process.env.OMEGA_TEST_MODE; // isolate from testing precedence
        try {
          // Unpackaged harness → 'development' even with OMEGA_BUILD_MODE set (app.isPackaged wins).
          process.env.OMEGA_BUILD_MODE = 'true';
          ctx.expect(m.getEnvironment()).toBe('development');
          delete process.env.OMEGA_BUILD_MODE;
          ctx.expect(m.getEnvironment()).toBe('development');
        } finally {
          if (origEnv !== undefined) m.config.em.environment = origEnv;
          if (origBuild !== undefined) process.env.OMEGA_BUILD_MODE = origBuild;
          else delete process.env.OMEGA_BUILD_MODE;
          if (origTest !== undefined) process.env.OMEGA_TEST_MODE = origTest;
        }
      },
    },
    {
      name: 'getFunctionsUrl: dev returns localhost:5001/<projectId>/us-central1',
      run: (ctx) => {
        const m = ctx.manager;
        m.config.cloud = m.config.cloud || {};
        m.config.cloud.config = m.config.cloud.config || {};
        const orig = m.config.cloud.config.projectId;
        m.config.cloud.config.projectId = 'demo-app';
        try {
          withoutBakedPorts(m, () => {
            ctx.expect(m.getFunctionsUrl('development')).toBe('http://localhost:5001/demo-app/us-central1');
          });
        } finally { m.config.cloud.config.projectId = orig; }
      },
    },
    {
      name: 'getFunctionsUrl: prod returns us-central1-<projectId>.cloudfunctions.net',
      run: (ctx) => {
        const m = ctx.manager;
        m.config.cloud = m.config.cloud || {};
        m.config.cloud.config = m.config.cloud.config || {};
        const orig = m.config.cloud.config.projectId;
        m.config.cloud.config.projectId = 'demo-app';
        try {
          ctx.expect(m.getFunctionsUrl('production')).toBe('https://us-central1-demo-app.cloudfunctions.net');
        } finally { m.config.cloud.config.projectId = orig; }
      },
    },
    {
      name: 'getFunctionsUrl: throws when projectId missing',
      run: (ctx) => {
        const m = ctx.manager;
        const orig = m.config.cloud?.config?.projectId;
        if (m.config.cloud?.config) delete m.config.cloud.config.projectId;
        try {
          let threw;
          try { m.getFunctionsUrl('production'); } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/cloud\.config\.projectId/);
        } finally {
          if (orig !== undefined) m.config.cloud.config.projectId = orig;
        }
      },
    },
    {
      name: 'getApiUrl: dev returns http://localhost:5002 (no published ports)',
      run: (ctx) => {
        const origHttps = process.env.OMEGA_HTTPS_PORT;
        const origHosting = process.env.OMEGA_HOSTING_PORT;
        delete process.env.OMEGA_HTTPS_PORT;
        delete process.env.OMEGA_HOSTING_PORT;
        try {
          withoutBakedPorts(ctx.manager, () => {
            ctx.expect(ctx.manager.getApiUrl('development')).toBe('http://localhost:5002');
          });
        } finally {
          if (origHttps !== undefined) process.env.OMEGA_HTTPS_PORT = origHttps;
          if (origHosting !== undefined) process.env.OMEGA_HOSTING_PORT = origHosting;
        }
      },
    },
    {
      name: 'getApiUrl: testing also returns http://localhost:5002 (local, not prod)',
      run: (ctx) => {
        // Testing resolves to the local URL just like development — tests must hit the
        // local emulator, never the production API.
        const origHttps = process.env.OMEGA_HTTPS_PORT;
        const origHosting = process.env.OMEGA_HOSTING_PORT;
        delete process.env.OMEGA_HTTPS_PORT;
        delete process.env.OMEGA_HOSTING_PORT;
        try {
          withoutBakedPorts(ctx.manager, () => {
            ctx.expect(ctx.manager.getApiUrl('testing')).toBe('http://localhost:5002');
          });
        } finally {
          if (origHttps !== undefined) process.env.OMEGA_HTTPS_PORT = origHttps;
          if (origHosting !== undefined) process.env.OMEGA_HOSTING_PORT = origHosting;
        }
      },
    },
    {
      // N7 env channel — mirrors @omega.js/backend's getApiUrl: a published
      // OMEGA_HTTPS_PORT (mgr serve's mkcert proxy) wins with https; else a
      // published OMEGA_HOSTING_PORT is plain http to the hosting emulator.
      name: 'getApiUrl: dev follows OMEGA_HTTPS_PORT (https) then OMEGA_HOSTING_PORT (http)',
      run: (ctx) => {
        const m = ctx.manager;
        const origHttps = process.env.OMEGA_HTTPS_PORT;
        const origHosting = process.env.OMEGA_HOSTING_PORT;
        try {
          process.env.OMEGA_HOSTING_PORT = '5099';
          delete process.env.OMEGA_HTTPS_PORT;
          ctx.expect(m.getApiUrl('development')).toBe('http://localhost:5099');
          process.env.OMEGA_HTTPS_PORT = '5443';
          ctx.expect(m.getApiUrl('development')).toBe('https://localhost:5443');
        } finally {
          if (origHttps !== undefined) process.env.OMEGA_HTTPS_PORT = origHttps; else delete process.env.OMEGA_HTTPS_PORT;
          if (origHosting !== undefined) process.env.OMEGA_HOSTING_PORT = origHosting; else delete process.env.OMEGA_HOSTING_PORT;
        }
      },
    },
    {
      // #745: the baked `dev.ports` map (written by the bundle task from the
      // sibling backend's ports file) is the second channel, behind the env
      // and ahead of the classics, on the REAL main-process Manager shape.
      name: 'getApiUrl: dev follows the baked dev.ports map when no env is published',
      run: (ctx) => {
        const m = ctx.manager;
        const origDev = m.config.dev;
        const origHttps = process.env.OMEGA_HTTPS_PORT;
        const origHosting = process.env.OMEGA_HOSTING_PORT;
        try {
          delete process.env.OMEGA_HTTPS_PORT;
          delete process.env.OMEGA_HOSTING_PORT;
          m.config.dev = { ports: { hosting: 5012 } };
          ctx.expect(m.getApiUrl('development')).toBe('http://localhost:5012');
          m.config.dev = { ports: { hosting: 5012, https: 5003 } };
          ctx.expect(m.getApiUrl('development')).toBe('https://localhost:5003');
          process.env.OMEGA_HOSTING_PORT = '5099';
          delete m.config.dev.ports.https;
          ctx.expect(m.getApiUrl('development')).toBe('http://localhost:5099');
        } finally {
          if (origDev !== undefined) m.config.dev = origDev; else delete m.config.dev;
          if (origHttps !== undefined) process.env.OMEGA_HTTPS_PORT = origHttps; else delete process.env.OMEGA_HTTPS_PORT;
          if (origHosting !== undefined) process.env.OMEGA_HOSTING_PORT = origHosting; else delete process.env.OMEGA_HOSTING_PORT;
        }
      },
    },
    {
      // wave-5 F9 (as amended cp268): authDomain is an auth-only concern —
      // the API base must come from brand.url, never authDomain.
      name: 'getApiUrl: prod returns api.<brand.url host>, never api.<authDomain>',
      run: (ctx) => {
        const m = ctx.manager;
        m.config.brand = m.config.brand || {};
        const origUrl = m.config.brand.url;
        m.config.brand.url = 'https://demo-app.example.com';
        m.config.cloud = m.config.cloud || {};
        m.config.cloud.config = m.config.cloud.config || {};
        const origAuth = m.config.cloud.config.authDomain;
        m.config.cloud.config.authDomain = 'demo-app.firebaseapp.com';
        try {
          ctx.expect(m.getApiUrl('production')).toBe('https://api.demo-app.example.com');
        } finally {
          m.config.brand.url = origUrl;
          m.config.cloud.config.authDomain = origAuth;
        }
      },
    },
    {
      name: 'getApiUrl: throws when brand.url missing in prod',
      run: (ctx) => {
        const m = ctx.manager;
        m.config.brand = m.config.brand || {};
        const orig = m.config.brand.url;
        delete m.config.brand.url;
        try {
          let threw;
          try { m.getApiUrl('production'); } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/brand\.url/);
        } finally {
          if (orig !== undefined) m.config.brand.url = orig;
        }
      },
    },
    {
      name: 'getWebsiteUrl: dev returns the classic dev origin https://localhost:4000',
      run: (ctx) => {
        const orig = process.env.OMEGA_WEBSITE_PORT;
        delete process.env.OMEGA_WEBSITE_PORT;
        try {
          withoutBakedPorts(ctx.manager, () => {
            ctx.expect(ctx.manager.getWebsiteUrl('development')).toBe('https://localhost:4000');
          });
        } finally {
          if (orig !== undefined) process.env.OMEGA_WEBSITE_PORT = orig;
        }
      },
    },
    {
      name: 'getWebsiteUrl: dev follows OMEGA_WEBSITE_PORT (N7 env channel)',
      run: (ctx) => {
        const orig = process.env.OMEGA_WEBSITE_PORT;
        try {
          process.env.OMEGA_WEBSITE_PORT = '4001';
          ctx.expect(ctx.manager.getWebsiteUrl('development')).toBe('https://localhost:4001');
        } finally {
          if (orig !== undefined) process.env.OMEGA_WEBSITE_PORT = orig; else delete process.env.OMEGA_WEBSITE_PORT;
        }
      },
    },
    {
      // #747: the baked `dev.origin` (the live website's published origin,
      // scheme included) is the complete fact and outranks the env port, on
      // the REAL main-process Manager shape; getAuthUrl rides it by construction.
      name: 'getWebsiteUrl: dev follows the baked dev.origin over OMEGA_WEBSITE_PORT',
      run: (ctx) => {
        const m = ctx.manager;
        const origDev = m.config.dev;
        const origPort = process.env.OMEGA_WEBSITE_PORT;
        try {
          process.env.OMEGA_WEBSITE_PORT = '4001';
          m.config.dev = { origin: 'https://localhost:4123' };
          ctx.expect(m.getWebsiteUrl('development')).toBe('https://localhost:4123');
          ctx.expect(new URL(m.getAuthUrl('development')).origin).toBe('https://localhost:4123');
        } finally {
          if (origDev !== undefined) m.config.dev = origDev; else delete m.config.dev;
          if (origPort !== undefined) process.env.OMEGA_WEBSITE_PORT = origPort; else delete process.env.OMEGA_WEBSITE_PORT;
        }
      },
    },
    {
      name: 'getWebsiteUrl: prod returns config.brand.url',
      run: (ctx) => {
        const m = ctx.manager;
        m.config.brand = m.config.brand || {};
        const orig = m.config.brand.url;
        m.config.brand.url = 'https://example.com';
        try {
          ctx.expect(m.getWebsiteUrl('production')).toBe('https://example.com');
        } finally { m.config.brand.url = orig; }
      },
    },
    {
      name: 'getWebsiteUrl: throws in prod when brand.url is missing',
      run: (ctx) => {
        const m = ctx.manager;
        const orig = m.config.brand?.url;
        if (m.config.brand) delete m.config.brand.url;
        try {
          let threw;
          try { m.getWebsiteUrl('production'); } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/brand\.url/);
        } finally {
          if (orig !== undefined) m.config.brand.url = orig;
        }
      },
    },
    {
      // Assert by DECOMPOSING the URL with the same parsing the website performs
      // (searchParams round-trip), not by string-matching encodings.
      name: 'getAuthUrl: chains /signin → /token → <brand.id>://auth/token (dev)',
      run: (ctx) => {
        const m = ctx.manager;
        m.config.brand = m.config.brand || {};
        const origId = m.config.brand.id;
        m.config.brand.id = 'demo';
        try {
          withoutBakedPorts(m, () => {
            const url = new URL(m.getAuthUrl('development'));
            ctx.expect(url.origin).toBe('https://localhost:4000');
            ctx.expect(url.pathname).toBe('/signin');
            const tokenUrl = new URL(url.searchParams.get('authReturnUrl'));
            ctx.expect(tokenUrl.origin).toBe('https://localhost:4000');
            ctx.expect(tokenUrl.pathname).toBe('/token');
            ctx.expect(tokenUrl.searchParams.get('authReturnUrl')).toBe('demo://auth/token');
          });
        } finally {
          if (origId !== undefined) m.config.brand.id = origId; else delete m.config.brand.id;
        }
      },
    },
    {
      name: 'getAuthUrl: prod rides brand.url',
      run: (ctx) => {
        const m = ctx.manager;
        m.config.brand = m.config.brand || {};
        const origId = m.config.brand.id;
        const origUrl = m.config.brand.url;
        m.config.brand.id = 'demo';
        m.config.brand.url = 'https://example.com';
        try {
          const url = new URL(m.getAuthUrl('production'));
          ctx.expect(url.origin).toBe('https://example.com');
          ctx.expect(url.pathname).toBe('/signin');
          const tokenUrl = new URL(url.searchParams.get('authReturnUrl'));
          ctx.expect(tokenUrl.origin).toBe('https://example.com');
          ctx.expect(tokenUrl.searchParams.get('authReturnUrl')).toBe('demo://auth/token');
        } finally {
          if (origId !== undefined) m.config.brand.id = origId; else delete m.config.brand.id;
          if (origUrl !== undefined) m.config.brand.url = origUrl; else delete m.config.brand.url;
        }
      },
    },
    {
      // The dev loopback return channel (lib/auth-flow.js) swaps the final hop.
      name: 'getAuthUrl: optional returnUrl overrides the final hop',
      run: (ctx) => {
        const m = ctx.manager;
        m.config.brand = m.config.brand || {};
        const origId = m.config.brand.id;
        m.config.brand.id = 'demo';
        try {
          const loopback = 'http://127.0.0.1:49152/auth/token?state=abc';
          const url = new URL(m.getAuthUrl('development', loopback));
          const tokenUrl = new URL(url.searchParams.get('authReturnUrl'));
          ctx.expect(tokenUrl.pathname).toBe('/token');
          ctx.expect(tokenUrl.searchParams.get('authReturnUrl')).toBe(loopback);
        } finally {
          if (origId !== undefined) m.config.brand.id = origId; else delete m.config.brand.id;
        }
      },
    },
    {
      name: 'getAuthUrl: throws when brand.id missing',
      run: (ctx) => {
        const m = ctx.manager;
        const orig = m.config.brand?.id;
        if (m.config.brand) delete m.config.brand.id;
        try {
          let threw;
          try { m.getAuthUrl('development'); } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/brand\.id/);
        } finally {
          if (orig !== undefined) m.config.brand.id = orig;
        }
      },
    },
    {
      name: 'getWebsiteUrl: respects current environment (config override) when no arg passed',
      run: (ctx) => {
        const m = ctx.manager;
        const origEnv = m.config.em?.environment;
        const origTest = process.env.OMEGA_TEST_MODE;
        m.config.em = m.config.em || {};
        m.config.brand = m.config.brand || {};
        const origUrl = m.config.brand.url;
        m.config.brand.url = 'https://example.com';
        // Clear OMEGA_TEST_MODE so the config override is exercised — otherwise testing wins
        // (correctly) and every URL resolves local regardless of config.
        delete process.env.OMEGA_TEST_MODE;
        try {
          m.config.em.environment = 'development';
          withoutBakedPorts(m, () => {
            ctx.expect(m.getWebsiteUrl()).toBe('https://localhost:4000');
          });
          m.config.em.environment = 'production';
          ctx.expect(m.getWebsiteUrl()).toBe('https://example.com');
        } finally {
          if (origEnv !== undefined) m.config.em.environment = origEnv;
          else delete m.config.em.environment;
          if (origTest !== undefined) process.env.OMEGA_TEST_MODE = origTest;
          m.config.brand.url = origUrl;
        }
      },
    },
  ],
});
