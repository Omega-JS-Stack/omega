// Renderer-layer tests for the cross-context helpers (mode-helpers + url-helpers).
// Verifies that `manager.isDevelopment / isProduction / isTesting / getVersion`
// AND `manager.getEnvironment / getApiUrl / getFunctionsUrl / getWebsiteUrl` work
// end-to-end inside a real renderer process, not just in main.
//
// The renderer-preload (test/harness/renderer-preload.js) instantiates a renderer
// Manager and exposes its helpers via contextBridge as `window.__emTestManager`.
// Test bodies are stringified + reconstructed via `new Function('ctx', body)` so
// they only have access to `ctx` and `window` — no closures over module scope.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  layer: 'renderer',
  description: 'cross-context helpers (renderer)',
  tests: [
    {
      name: '__emTestManager is exposed by the test preload',
      run: (ctx) => {
        ctx.expect(typeof window.__emTestManager).toBe('object');
        ctx.expect(window.__emTestManager).toBeTruthy();
      },
    },
    {
      name: 'isTesting() returns true (this lane named OMEGA_ENVIRONMENT=testing)',
      run: (ctx) => {
        ctx.expect(window.__emTestManager.isTesting()).toBe(true);
      },
    },
    {
      name: 'isDevelopment() answers the one input, with no renderer-specific sniff',
      run: (ctx) => {
        // Nothing here reads app.isPackaged or NODE_ENV any more (#817): the
        // preload has a process, so the lane's OMEGA_ENVIRONMENT answers, and a
        // real renderer bundle answers from the baked config.environment.
        const v = window.__emTestManager.isDevelopment();
        ctx.expect(typeof v).toBe('boolean');
        ctx.expect(v).toBe(false);
      },
    },
    {
      name: 'environments are mutually exclusive — exactly one of dev/testing/prod is true',
      run: (ctx) => {
        const dev  = window.__emTestManager.isDevelopment();
        const test = window.__emTestManager.isTesting();
        const prod = window.__emTestManager.isProduction();
        // This lane named testing; dev and prod are both false.
        ctx.expect(test).toBe(true);
        ctx.expect(dev).toBe(false);
        ctx.expect(prod).toBe(false);
        ctx.expect([dev, test, prod].filter(Boolean).length).toBe(1);
      },
    },
    {
      name: 'getVersion() returns a string or null without throwing',
      run: (ctx) => {
        const v = window.__emTestManager.getVersion();
        // In renderer, `electron.app` is unavailable and process.cwd()/package.json
        // resolves to whatever the test harness was launched from — could be either
        // a string or null. Assert just the shape.
        ctx.expect(v === null || typeof v === 'string').toBe(true);
      },
    },
    {
      name: 'getEnvironment(): the lane variable wins over the baked config.environment',
      run: (ctx) => {
        // The test runner names OMEGA_ENVIRONMENT=testing, and this preload has a
        // process to read it from, so it wins over whatever the artifact was
        // baked as (#817). A real renderer bundle has no process and takes the
        // baked word, which is the other half of the same one-input rule.
        window.__emTestManager.setConfig('environment', 'production');
        ctx.expect(window.__emTestManager.getEnvironment()).toBe('testing');
        window.__emTestManager.setConfig('environment', 'development');
        ctx.expect(window.__emTestManager.getEnvironment()).toBe('testing');
        // Reset.
        window.__emTestManager.setConfig('environment', 'production');
      },
    },
    {
      name: 'getFunctionsUrl: dev → localhost:5001/<projectId>/us-central1',
      run: (ctx) => {
        ctx.expect(window.__emTestManager.getFunctionsUrl('development'))
          .toBe('http://localhost:5001/demo-app/us-central1');
      },
    },
    {
      name: 'getFunctionsUrl: prod → us-central1-<projectId>.cloudfunctions.net',
      run: (ctx) => {
        ctx.expect(window.__emTestManager.getFunctionsUrl('production'))
          .toBe('https://us-central1-demo-app.cloudfunctions.net');
      },
    },
    {
      name: 'getApiUrl: dev → http://localhost:5002',
      run: (ctx) => {
        ctx.expect(window.__emTestManager.getApiUrl('development')).toBe('http://localhost:5002');
      },
    },
    {
      // wave-5 F9 (as amended cp268): API base rides brand.url, never
      // authDomain — that value is an auth-only concern.
      name: 'getApiUrl: prod → api.<brand.url host>',
      run: (ctx) => {
        ctx.expect(window.__emTestManager.getApiUrl('production'))
          .toBe('https://api.example.com');
      },
    },
    {
      name: 'getWebsiteUrl: dev → https://localhost:4000, from the baked classic map',
      run: (ctx) => {
        ctx.expect(window.__emTestManager.getWebsiteUrl('development')).toBe('https://localhost:4000');
      },
    },
    {
      name: 'getWebsiteUrl: prod → config.brand.url',
      run: (ctx) => {
        ctx.expect(window.__emTestManager.getWebsiteUrl('production')).toBe('https://example.com');
      },
    },
    {
      name: 'getWebsiteUrl: no-arg resolves local under testing; explicit arg overrides',
      run: (ctx) => {
        // This lane is testing, so the no-arg form resolves LOCAL regardless of
        // what the artifact was baked as: that's the safety guarantee.
        window.__emTestManager.setConfig('environment', 'production');
        ctx.expect(window.__emTestManager.getWebsiteUrl()).toBe('https://localhost:4000');
        // An explicit env arg bypasses the current environment and pins the mapping.
        ctx.expect(window.__emTestManager.getWebsiteUrl('production')).toBe('https://example.com');
        ctx.expect(window.__emTestManager.getWebsiteUrl('development')).toBe('https://localhost:4000');
      },
    },
  ],
});
