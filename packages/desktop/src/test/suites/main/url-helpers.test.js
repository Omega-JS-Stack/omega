// Tests for src/utils/url-helpers.js — getFunctionsUrl / getApiUrl / getWebsiteUrl —
// plus the getEnvironment() resolution they depend on (getEnvironment itself is the
// SSOT defined in src/utils/mode-helpers.js; these tests exercise it through the
// omega instance because the URL helpers route through `this.config` and `this.getEnvironment()`).
// The instance (already bootstrapped by the test harness) is the natural object under test.

const defineCases = require('@omega.js/devkit/test/define-cases');
const { CLASSIC_PORTS, CLASSIC_DEV_ORIGIN } = require('@omega.js/config');

// Every case that pins a CLASSIC local answer states the baked `dev` block a
// real dev artifact carries: since
// [#834](https://github.com/Omega-JS-Stack/omega/issues/834) the bundle task
// bakes the classic map as the FLOOR of the resolved one, so the classics reach
// these helpers the way they reach a shipped dev build, from @omega.js/config,
// and no copy of the numbers lives in this file or in url-helpers.js.
function withClassicBakedPorts(omega, fn) {
  const original = omega.config.dev;
  omega.config.dev = { ports: { ...CLASSIC_PORTS } };
  try { return fn(); } finally {
    if (original !== undefined) omega.config.dev = original; else delete omega.config.dev;
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'url-helpers (cross-context)',
  tests: [
    {
      // The environment reads ONE input
      // ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)): the
      // `OMEGA_ENVIRONMENT` variable the lane set, and the baked
      // `config.environment` when the process has none (a packaged app, which
      // has no parent lane to inherit from). The legacy `config.em.environment`
      // override is gone with the copy that read it, and so are the
      // app.isPackaged / OMEGA_BUILD_MODE / NODE_ENV sniffs.
      name: 'getEnvironment: the process input, then the baked config.environment',
      run: (ctx) => {
        const omega = ctx.omega;
        const origConfigEnv = omega.config.environment;
        const origVar = process.env.OMEGA_ENVIRONMENT;
        try {
          // The lane's variable is the answer wherever it exists.
          omega.config.environment = 'production';
          for (const name of ['development', 'testing', 'production']) {
            process.env.OMEGA_ENVIRONMENT = name;
            ctx.expect(omega.getEnvironment()).toBe(name);
          }

          // With no variable, the artifact's own baked word answers.
          delete process.env.OMEGA_ENVIRONMENT;
          for (const name of ['development', 'testing', 'production']) {
            omega.config.environment = name;
            ctx.expect(omega.getEnvironment()).toBe(name);
          }

          // Neither is a loud error, never a default.
          delete omega.config.environment;
          let threw;
          try { omega.getEnvironment(); } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/OMEGA_ENVIRONMENT/);
        } finally {
          if (origConfigEnv !== undefined) omega.config.environment = origConfigEnv; else delete omega.config.environment;
          if (origVar !== undefined) process.env.OMEGA_ENVIRONMENT = origVar; else delete process.env.OMEGA_ENVIRONMENT;
        }
      },
    },
    {
      // The three checks DERIVE from getEnvironment(), on the REAL main-process
      // omega instance, so they can never disagree with it.
      name: 'the three is*() checks derive from it, and exactly one is true',
      run: (ctx) => {
        const omega = ctx.omega;
        const origVar = process.env.OMEGA_ENVIRONMENT;
        try {
          for (const name of ['development', 'testing', 'production']) {
            process.env.OMEGA_ENVIRONMENT = name;
            ctx.expect(omega.isDevelopment()).toBe(name === 'development');
            ctx.expect(omega.isTesting()).toBe(name === 'testing');
            ctx.expect(omega.isProduction()).toBe(name === 'production');
            ctx.expect([omega.isDevelopment(), omega.isTesting(), omega.isProduction()].filter(Boolean).length).toBe(1);
          }
        } finally {
          if (origVar !== undefined) process.env.OMEGA_ENVIRONMENT = origVar; else delete process.env.OMEGA_ENVIRONMENT;
        }
      },
    },
    {
      name: 'getFunctionsUrl: dev returns localhost:5001/<projectId>/us-central1',
      run: (ctx) => {
        const omega = ctx.omega;
        omega.config.cloud = omega.config.cloud || {};
        omega.config.cloud.config = omega.config.cloud.config || {};
        const orig = omega.config.cloud.config.projectId;
        omega.config.cloud.config.projectId = 'demo-app';
        try {
          withClassicBakedPorts(omega, () => {
            ctx.expect(omega.getFunctionsUrl('development')).toBe('http://localhost:5001/demo-app/us-central1');
          });
        } finally { omega.config.cloud.config.projectId = orig; }
      },
    },
    {
      name: 'getFunctionsUrl: prod returns us-central1-<projectId>.cloudfunctions.net',
      run: (ctx) => {
        const omega = ctx.omega;
        omega.config.cloud = omega.config.cloud || {};
        omega.config.cloud.config = omega.config.cloud.config || {};
        const orig = omega.config.cloud.config.projectId;
        omega.config.cloud.config.projectId = 'demo-app';
        try {
          ctx.expect(omega.getFunctionsUrl('production')).toBe('https://us-central1-demo-app.cloudfunctions.net');
        } finally { omega.config.cloud.config.projectId = orig; }
      },
    },
    {
      name: 'getFunctionsUrl: throws when projectId missing',
      run: (ctx) => {
        const omega = ctx.omega;
        const orig = omega.config.cloud?.config?.projectId;
        if (omega.config.cloud?.config) delete omega.config.cloud.config.projectId;
        try {
          let threw;
          try { omega.getFunctionsUrl('production'); } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/cloud\.config\.projectId/);
        } finally {
          if (orig !== undefined) omega.config.cloud.config.projectId = orig;
        }
      },
    },
    {
      name: 'getApiUrl: dev returns http://localhost:5002 from the baked classic map',
      run: (ctx) => {
        const origHttps = process.env.OMEGA_HTTPS_PORT;
        const origHosting = process.env.OMEGA_HOSTING_PORT;
        delete process.env.OMEGA_HTTPS_PORT;
        delete process.env.OMEGA_HOSTING_PORT;
        try {
          withClassicBakedPorts(ctx.omega, () => {
            ctx.expect(ctx.omega.getApiUrl('development')).toBe('http://localhost:5002');
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
          withClassicBakedPorts(ctx.omega, () => {
            ctx.expect(ctx.omega.getApiUrl('testing')).toBe('http://localhost:5002');
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
        const omega = ctx.omega;
        const origHttps = process.env.OMEGA_HTTPS_PORT;
        const origHosting = process.env.OMEGA_HOSTING_PORT;
        try {
          process.env.OMEGA_HOSTING_PORT = '5099';
          delete process.env.OMEGA_HTTPS_PORT;
          ctx.expect(omega.getApiUrl('development')).toBe('http://localhost:5099');
          process.env.OMEGA_HTTPS_PORT = '5443';
          ctx.expect(omega.getApiUrl('development')).toBe('https://localhost:5443');
        } finally {
          if (origHttps !== undefined) process.env.OMEGA_HTTPS_PORT = origHttps; else delete process.env.OMEGA_HTTPS_PORT;
          if (origHosting !== undefined) process.env.OMEGA_HOSTING_PORT = origHosting; else delete process.env.OMEGA_HOSTING_PORT;
        }
      },
    },
    {
      // #745: the baked `dev.ports` map (written by the bundle task from the
      // sibling backend's ports file) is the second channel, behind the env
      // and ahead of the classics, on the REAL main-process omega shape.
      name: 'getApiUrl: dev follows the baked dev.ports map when no env is published',
      run: (ctx) => {
        const omega = ctx.omega;
        const origDev = omega.config.dev;
        const origHttps = process.env.OMEGA_HTTPS_PORT;
        const origHosting = process.env.OMEGA_HOSTING_PORT;
        try {
          delete process.env.OMEGA_HTTPS_PORT;
          delete process.env.OMEGA_HOSTING_PORT;
          omega.config.dev = { ports: { hosting: 5012 } };
          ctx.expect(omega.getApiUrl('development')).toBe('http://localhost:5012');
          omega.config.dev = { ports: { hosting: 5012, https: 5003 } };
          ctx.expect(omega.getApiUrl('development')).toBe('https://localhost:5003');
          process.env.OMEGA_HOSTING_PORT = '5099';
          delete omega.config.dev.ports.https;
          ctx.expect(omega.getApiUrl('development')).toBe('http://localhost:5099');
        } finally {
          if (origDev !== undefined) omega.config.dev = origDev; else delete omega.config.dev;
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
        const omega = ctx.omega;
        omega.config.brand = omega.config.brand || {};
        const origUrl = omega.config.brand.url;
        omega.config.brand.url = 'https://demo-app.example.com';
        omega.config.cloud = omega.config.cloud || {};
        omega.config.cloud.config = omega.config.cloud.config || {};
        const origAuth = omega.config.cloud.config.authDomain;
        omega.config.cloud.config.authDomain = 'demo-app.firebaseapp.com';
        try {
          ctx.expect(omega.getApiUrl('production')).toBe('https://api.demo-app.example.com');
        } finally {
          omega.config.brand.url = origUrl;
          omega.config.cloud.config.authDomain = origAuth;
        }
      },
    },
    {
      name: 'getApiUrl: throws when brand.url missing in prod',
      run: (ctx) => {
        const omega = ctx.omega;
        omega.config.brand = omega.config.brand || {};
        const orig = omega.config.brand.url;
        delete omega.config.brand.url;
        try {
          let threw;
          try { omega.getApiUrl('production'); } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/brand\.url/);
        } finally {
          if (orig !== undefined) omega.config.brand.url = orig;
        }
      },
    },
    {
      name: 'getWebsiteUrl: dev returns https://localhost:4000 from the baked classic map',
      run: (ctx) => {
        const orig = process.env.OMEGA_WEBSITE_PORT;
        delete process.env.OMEGA_WEBSITE_PORT;
        try {
          withClassicBakedPorts(ctx.omega, () => {
            ctx.expect(ctx.omega.getWebsiteUrl('development')).toBe('https://localhost:4000');
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
          ctx.expect(ctx.omega.getWebsiteUrl('development')).toBe('https://localhost:4001');
        } finally {
          if (orig !== undefined) process.env.OMEGA_WEBSITE_PORT = orig; else delete process.env.OMEGA_WEBSITE_PORT;
        }
      },
    },
    {
      // #747: the baked `dev.origin` (the live website's published origin,
      // scheme included) is the complete fact and outranks the env port, on
      // the REAL main-process omega shape; getAuthUrl rides it by construction.
      name: 'getWebsiteUrl: dev follows the baked dev.origin over OMEGA_WEBSITE_PORT',
      run: (ctx) => {
        const omega = ctx.omega;
        const origDev = omega.config.dev;
        const origPort = process.env.OMEGA_WEBSITE_PORT;
        try {
          process.env.OMEGA_WEBSITE_PORT = '4001';
          omega.config.dev = { origin: 'https://localhost:4123' };
          ctx.expect(omega.getWebsiteUrl('development')).toBe('https://localhost:4123');
          ctx.expect(new URL(omega.getAuthUrl('development')).origin).toBe('https://localhost:4123');
        } finally {
          if (origDev !== undefined) omega.config.dev = origDev; else delete omega.config.dev;
          if (origPort !== undefined) process.env.OMEGA_WEBSITE_PORT = origPort; else delete process.env.OMEGA_WEBSITE_PORT;
        }
      },
    },
    {
      name: 'getWebsiteUrl: prod returns config.brand.url',
      run: (ctx) => {
        const omega = ctx.omega;
        omega.config.brand = omega.config.brand || {};
        const orig = omega.config.brand.url;
        omega.config.brand.url = 'https://example.com';
        try {
          ctx.expect(omega.getWebsiteUrl('production')).toBe('https://example.com');
        } finally { omega.config.brand.url = orig; }
      },
    },
    {
      name: 'getWebsiteUrl: throws in prod when brand.url is missing',
      run: (ctx) => {
        const omega = ctx.omega;
        const orig = omega.config.brand?.url;
        if (omega.config.brand) delete omega.config.brand.url;
        try {
          let threw;
          try { omega.getWebsiteUrl('production'); } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/brand\.url/);
        } finally {
          if (orig !== undefined) omega.config.brand.url = orig;
        }
      },
    },
    {
      // Assert by DECOMPOSING the URL with the same parsing the website performs
      // (searchParams round-trip), not by string-matching encodings.
      name: 'getAuthUrl: chains /signin → /token → <brand.id>://auth/token (dev)',
      run: (ctx) => {
        const omega = ctx.omega;
        omega.config.brand = omega.config.brand || {};
        const origId = omega.config.brand.id;
        omega.config.brand.id = 'demo';
        try {
          withClassicBakedPorts(omega, () => {
            const url = new URL(omega.getAuthUrl('development'));
            ctx.expect(url.origin).toBe('https://localhost:4000');
            ctx.expect(url.pathname).toBe('/signin');
            const tokenUrl = new URL(url.searchParams.get('authReturnUrl'));
            ctx.expect(tokenUrl.origin).toBe('https://localhost:4000');
            ctx.expect(tokenUrl.pathname).toBe('/token');
            ctx.expect(tokenUrl.searchParams.get('authReturnUrl')).toBe('demo://auth/token');
          });
        } finally {
          if (origId !== undefined) omega.config.brand.id = origId; else delete omega.config.brand.id;
        }
      },
    },
    {
      name: 'getAuthUrl: prod rides brand.url',
      run: (ctx) => {
        const omega = ctx.omega;
        omega.config.brand = omega.config.brand || {};
        const origId = omega.config.brand.id;
        const origUrl = omega.config.brand.url;
        omega.config.brand.id = 'demo';
        omega.config.brand.url = 'https://example.com';
        try {
          const url = new URL(omega.getAuthUrl('production'));
          ctx.expect(url.origin).toBe('https://example.com');
          ctx.expect(url.pathname).toBe('/signin');
          const tokenUrl = new URL(url.searchParams.get('authReturnUrl'));
          ctx.expect(tokenUrl.origin).toBe('https://example.com');
          ctx.expect(tokenUrl.searchParams.get('authReturnUrl')).toBe('demo://auth/token');
        } finally {
          if (origId !== undefined) omega.config.brand.id = origId; else delete omega.config.brand.id;
          if (origUrl !== undefined) omega.config.brand.url = origUrl; else delete omega.config.brand.url;
        }
      },
    },
    {
      // The dev loopback return channel (lib/auth-flow.js) swaps the final hop.
      name: 'getAuthUrl: optional returnUrl overrides the final hop',
      run: (ctx) => {
        const omega = ctx.omega;
        omega.config.brand = omega.config.brand || {};
        const origId = omega.config.brand.id;
        omega.config.brand.id = 'demo';
        try {
          const loopback = 'http://127.0.0.1:49152/auth/token?state=abc';
          withClassicBakedPorts(omega, () => {
            const url = new URL(omega.getAuthUrl('development', loopback));
            const tokenUrl = new URL(url.searchParams.get('authReturnUrl'));
            ctx.expect(tokenUrl.pathname).toBe('/token');
            ctx.expect(tokenUrl.searchParams.get('authReturnUrl')).toBe(loopback);
          });
        } finally {
          if (origId !== undefined) omega.config.brand.id = origId; else delete omega.config.brand.id;
        }
      },
    },
    {
      name: 'getAuthUrl: throws when brand.id missing',
      run: (ctx) => {
        const omega = ctx.omega;
        const orig = omega.config.brand?.id;
        if (omega.config.brand) delete omega.config.brand.id;
        try {
          withClassicBakedPorts(omega, () => {
            let threw;
            try { omega.getAuthUrl('development'); } catch (e) { threw = e; }
            ctx.expect(threw).toBeDefined();
            ctx.expect(threw.message).toMatch(/brand\.id/);
          });
        } finally {
          if (orig !== undefined) omega.config.brand.id = orig;
        }
      },
    },
    {
      // With no argument, the getters take the CURRENT environment, which is
      // the one input (#817): whatever the lane named for this process.
      name: 'getWebsiteUrl: respects the current environment when no arg passed',
      run: (ctx) => {
        const omega = ctx.omega;
        const origVar = process.env.OMEGA_ENVIRONMENT;
        omega.config.brand = omega.config.brand || {};
        const origUrl = omega.config.brand.url;
        omega.config.brand.url = 'https://example.com';
        try {
          process.env.OMEGA_ENVIRONMENT = 'development';
          withClassicBakedPorts(omega, () => {
            ctx.expect(omega.getWebsiteUrl()).toBe('https://localhost:4000');
          });
          process.env.OMEGA_ENVIRONMENT = 'production';
          ctx.expect(omega.getWebsiteUrl()).toBe('https://example.com');
        } finally {
          if (origVar !== undefined) process.env.OMEGA_ENVIRONMENT = origVar; else delete process.env.OMEGA_ENVIRONMENT;
          omega.config.brand.url = origUrl;
        }
      },
    },
  ],
});
