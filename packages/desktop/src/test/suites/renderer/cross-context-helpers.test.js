// Renderer-layer tests for the cross-context helpers on the renderer `omega`
// instance: `isDevelopment / isProduction / isTesting / getEnvironment` and
// `getApiUrl / getFunctionsUrl` (the @omega.js/client base class's own), plus
// desktop's `getVersion / getWebsiteUrl` (utils/mode-helpers + utils/url-helpers),
// end-to-end inside a real renderer process, not just in main.
//
// The renderer-preload (test/harness/renderer-preload.js) builds the real renderer
// instance and exposes its helpers via contextBridge as `window.__omegaTestInstance`.
// Test bodies are stringified + reconstructed via `new Function('ctx', body)` so
// they only have access to `ctx` and `window`, no closures over module scope.

const defineCases = require('@omega.js/devkit/test/define-cases');

module.exports = defineCases({
  type: 'suite',
  layer: 'renderer',
  description: 'cross-context helpers (renderer)',
  tests: [
    {
      name: '__omegaTestInstance is exposed by the test preload, over a built instance',
      run: (ctx) => {
        ctx.expect(typeof window.__omegaTestInstance).toBe('object');
        ctx.expect(window.__omegaTestInstance).toBeTruthy();
        if (!window.__omegaTestInstance.built()) {
          throw new Error(`the renderer instance did not build: ${window.__omegaTestInstance.error()}`);
        }
      },
    },
    {
      name: 'isTesting() returns true (this lane named OMEGA_ENVIRONMENT=testing)',
      run: (ctx) => {
        ctx.expect(window.__omegaTestInstance.isTesting()).toBe(true);
      },
    },
    {
      name: 'isDevelopment() answers the one input, with no renderer-specific sniff',
      run: (ctx) => {
        // Nothing here reads app.isPackaged or NODE_ENV any more (#817): the
        // preload has a process, so the lane's OMEGA_ENVIRONMENT answers, and a
        // real renderer bundle answers from the baked config.environment.
        const v = window.__omegaTestInstance.isDevelopment();
        ctx.expect(typeof v).toBe('boolean');
        ctx.expect(v).toBe(false);
      },
    },
    {
      name: 'environments are mutually exclusive — exactly one of dev/testing/prod is true',
      run: (ctx) => {
        const dev  = window.__omegaTestInstance.isDevelopment();
        const test = window.__omegaTestInstance.isTesting();
        const prod = window.__omegaTestInstance.isProduction();
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
        const v = window.__omegaTestInstance.getVersion();
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
        window.__omegaTestInstance.setConfig('environment', 'production');
        ctx.expect(window.__omegaTestInstance.getEnvironment()).toBe('testing');
        window.__omegaTestInstance.setConfig('environment', 'development');
        ctx.expect(window.__omegaTestInstance.getEnvironment()).toBe('testing');
        // Reset.
        window.__omegaTestInstance.setConfig('environment', 'production');
      },
    },
    {
      name: 'getFunctionsUrl: dev → localhost:5001/<projectId>/us-central1',
      run: (ctx) => {
        ctx.expect(window.__omegaTestInstance.getFunctionsUrl('development'))
          .toBe('http://localhost:5001/demo-app/us-central1');
      },
    },
    {
      name: 'getFunctionsUrl: prod → us-central1-<projectId>.cloudfunctions.net',
      run: (ctx) => {
        ctx.expect(window.__omegaTestInstance.getFunctionsUrl('production'))
          .toBe('https://us-central1-demo-app.cloudfunctions.net');
      },
    },
    {
      // The client's own getApiUrl, the one `omega.request()` calls: a baked
      // `hosting` port with no `https` one is the emulator on 127.0.0.1
      name: 'getApiUrl: dev → http://127.0.0.1:5002 (the client base class answers)',
      run: (ctx) => {
        ctx.expect(window.__omegaTestInstance.getApiUrl('development')).toBe('http://127.0.0.1:5002');
      },
    },
    {
      // wave-5 F9 (as amended cp268): API base rides brand.url, never
      // authDomain — that value is an auth-only concern.
      name: 'getApiUrl: prod → api.<brand.url host>',
      run: (ctx) => {
        ctx.expect(window.__omegaTestInstance.getApiUrl('production'))
          .toBe('https://api.example.com');
      },
    },
    {
      name: 'getWebsiteUrl: dev → https://localhost:4000, from the baked classic map',
      run: (ctx) => {
        ctx.expect(window.__omegaTestInstance.getWebsiteUrl('development')).toBe('https://localhost:4000');
      },
    },
    {
      name: 'getWebsiteUrl: prod → config.brand.url',
      run: (ctx) => {
        ctx.expect(window.__omegaTestInstance.getWebsiteUrl('production')).toBe('https://example.com');
      },
    },
    {
      name: 'getWebsiteUrl: no-arg resolves local under testing; explicit arg overrides',
      run: (ctx) => {
        // This lane is testing, so the no-arg form resolves LOCAL regardless of
        // what the artifact was baked as: that's the safety guarantee.
        window.__omegaTestInstance.setConfig('environment', 'production');
        ctx.expect(window.__omegaTestInstance.getWebsiteUrl()).toBe('https://localhost:4000');
        // An explicit env arg bypasses the current environment and pins the mapping.
        ctx.expect(window.__omegaTestInstance.getWebsiteUrl('production')).toBe('https://example.com');
        ctx.expect(window.__omegaTestInstance.getWebsiteUrl('development')).toBe('https://localhost:4000');
      },
    },
  ],
});
