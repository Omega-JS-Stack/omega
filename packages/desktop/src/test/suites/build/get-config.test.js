// Build-layer tests for Manager.getConfig() — omega.json5 resolution + derived defaults.
// Stages a temp consumer dir with a config/omega.json5, sets process.cwd()
// at it, and asserts the resolution + derivation rules.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const defineCases = require('@omega.js/devkit/test/define-cases');

function stageConsumer(jsonText, overlays) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-getconfig-'));
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), jsonText);
  for (const [environment, contents] of Object.entries(overlays || {})) {
    fs.writeFileSync(path.join(tmp, 'config', `omega.${environment}.json5`), contents);
  }
  return tmp;
}

// Run `fn` with the build-mode flag and this machine's ambient environment
// stated the way a real run states them; the originals come back after.
function withEnv(vars, fn) {
  const saved = Object.keys(vars).map((key) => [key, process.env[key]]);
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function loadConfigInDir(dir) {
  const oldCwd = process.cwd();
  // Bust the build module cache since it's a singleton.
  for (const k of Object.keys(require.cache)) {
    if (k.includes('/build.js')) delete require.cache[k];
  }
  try {
    process.chdir(dir);
    const Manager = require(path.join(__dirname, '..', '..', '..', 'build.js'));
    return Manager.getConfig();
  } finally {
    process.chdir(oldCwd);
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'Manager.getConfig — omega.json5 resolution + derived defaults',
  tests: [
    {
      name: 'derives appId from the BRAND: reverse-domain of brand.url, else app.<brand.id> (friction #18)',
      run: (ctx) => {
        const withUrl = stageConsumer(`{ brand: { id: 'somiibo', name: 'Somiibo', url: 'https://www.somiibo.com' }, targets: { desktop: { type: 'desktop' } } }`);
        try {
          ctx.expect(loadConfigInDir(withUrl).app.appId).toBe('com.somiibo');
        } finally {
          fs.rmSync(withUrl, { recursive: true, force: true });
        }

        const noUrl = stageConsumer(`{ brand: { id: 'somiibo', name: 'Somiibo' }, targets: { desktop: { type: 'desktop' } } }`);
        try {
          ctx.expect(loadConfigInDir(noUrl).app.appId).toBe('app.somiibo');
        } finally {
          fs.rmSync(noUrl, { recursive: true, force: true });
        }
      },
    },
    {
      // #909: the certificates service registers
      // `<certificates.providers.apple.bundleIdPrefix>.<brand.id>` (dashes as
      // dots), so a brand whose config carries a prefix (its own, or the
      // company layer's) signs under that same id. The URL host is what a
      // brand with no prefix still derives from, and a GitHub repo URL is
      // exactly why that fallback cannot be the rule.
      name: 'derives appId from certificates.providers.apple.bundleIdPrefix when the config carries one (#909)',
      run: (ctx) => {
        const withPrefix = stageConsumer(`{
          brand: { id: 'my-app', name: 'My App', url: 'https://github.com/acme/my-app' },
          certificates: { providers: { apple: { bundleIdPrefix: 'com.itwcreativeworks' } } },
          targets: { desktop: { type: 'desktop' } },
        }`);
        try {
          ctx.expect(loadConfigInDir(withPrefix).app.appId).toBe('com.itwcreativeworks.my.app');
        } finally {
          fs.rmSync(withPrefix, { recursive: true, force: true });
        }

        const noPrefix = stageConsumer(`{
          brand: { id: 'my-app', name: 'My App', url: 'https://github.com/acme/my-app' },
          targets: { desktop: { type: 'desktop' } },
        }`);
        try {
          ctx.expect(loadConfigInDir(noPrefix).app.appId).toBe('com.github');
        } finally {
          fs.rmSync(noPrefix, { recursive: true, force: true });
        }
      },
    },
    {
      // ONE derivation, @omega.js/config's (#909). A hyphenated or uppercase
      // host is exactly where reversing the string by hand and the helper part
      // ways, and a bundle id carrying a hyphen is not a bundle id.
      name: 'the url fallback is @omega.js/config\'s own derivation, hyphens and case included (#909)',
      run: (ctx) => {
        const { deriveBundleIdPrefix } = require('@omega.js/config');
        const url = 'https://My-App.Example.com';
        const dir = stageConsumer(`{ brand: { id: 'my-app', name: 'My App', url: '${url}' }, targets: { desktop: { type: 'desktop' } } }`);

        try {
          ctx.expect(loadConfigInDir(dir).app.appId).toBe(deriveBundleIdPrefix(url));
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'derives productName from brand.name when not set',
      run: (ctx) => {
        const tmp = stageConsumer(`{ brand: { id: 'somiibo', name: 'Somiibo' }, targets: { desktop: { type: 'desktop' } } }`);
        try {
          const cfg = loadConfigInDir(tmp);
          ctx.expect(cfg.app.productName).toBe('Somiibo');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'preserves explicit appId / productName from targets.desktop.app',
      run: (ctx) => {
        const tmp = stageConsumer(`{
          brand: { id: 'somiibo', name: 'Somiibo' },
          targets: { desktop: {
            type: 'desktop',
            app: { appId: 'com.custom.id', productName: 'Custom Name' },
          } },
        }`);
        try {
          const cfg = loadConfigInDir(tmp);
          ctx.expect(cfg.app.appId).toBe('com.custom.id');
          ctx.expect(cfg.app.productName).toBe('Custom Name');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'targets.desktop keys land at the top level (platforms, startup, ...)',
      run: (ctx) => {
        const tmp = stageConsumer(`{
          brand: { id: 'somiibo', name: 'Somiibo' },
          targets: { desktop: {
            type: 'desktop',
            startup:   { mode: 'hidden' },
            platforms: { windows: { signing: { strategy: 'cloud' } } },
          } },
        }`);
        try {
          const cfg = loadConfigInDir(tmp);
          ctx.expect(cfg.startup.mode).toBe('hidden');
          ctx.expect(cfg.platforms.windows.signing.strategy).toBe('cloud');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'shared keys inside targets.desktop override the shared value (per-surface)',
      run: (ctx) => {
        const tmp = stageConsumer(`{
          brand:  { id: 'somiibo', name: 'Somiibo' },
          monitoring: { providers: { sentry: { dsn: 'https://shared.example.com' } } },
          targets: { desktop: {
            type: 'desktop',
            monitoring: { providers: { sentry: { dsn: 'https://desktop-only.example.com' } } },
          } },
        }`);
        try {
          const cfg = loadConfigInDir(tmp);
          ctx.expect(cfg.monitoring.providers.sentry.dsn).toBe('https://desktop-only.example.com');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      // #856: the environment overlay a BUILD composes is the one the lane
      // names, not the one the machine answers. OMEGA_BUILD_MODE is the lane's
      // own word for a production bake, and a dev boot (no flag) is development
      // ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)). The
      // resolved config carries the word it composed under, as `environment`,
      // the build fact every OMEGA surface spells the same way (#896).
      name: 'a PRODUCTION build composes the production overlay, a dev boot the ambient one (#856)',
      run: (ctx) => {
        const tmp = stageConsumer(
          `{ brand: { id: 'somiibo', name: 'Somiibo' }, targets: { desktop: { type: 'desktop' } } }`,
          {
            production: `{ targets: { desktop: { app: { productName: 'Somiibo Production' } } } }`,
            development: `{ targets: { desktop: { app: { productName: 'Somiibo Dev' } } } }`,
          },
        );
        try {
          // A fresh lane each time: OMEGA_ENVIRONMENT is the ONE input (#817)
          // and src/build.js sets it at load from the build-mode flag, so each
          // sub-case starts from a process that has not been told anything.
          const freshLane = { OMEGA_ENVIRONMENT: undefined, OMEGA_TEST_MODE: undefined, ENVIRONMENT: undefined, FUNCTIONS_EMULATOR: undefined, TERM_PROGRAM: undefined };

          const built = withEnv({ ...freshLane, OMEGA_BUILD_MODE: 'true' }, () => loadConfigInDir(tmp));
          ctx.expect(built.app.productName).toBe('Somiibo Production');
          ctx.expect(built.environment).toBe('production');

          // A dev boot names nothing, and resolves development rather than the
          // machine-sniffed answer its old copy gave (#817): the same run used
          // to compose the PRODUCTION overlay in a terminal that did not look
          // like one.
          const dev = withEnv({ ...freshLane, OMEGA_BUILD_MODE: undefined }, () => loadConfigInDir(tmp));
          ctx.expect(dev.app.productName).toBe('Somiibo Dev');
          ctx.expect(dev.environment).toBe('development');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'returns seeded {brand:{}, app:{}} when config file missing',
      run: (ctx) => {
        // getConfig() always seeds brand + app blocks so downstream callers can
        // deref config.brand.X / config.app.X without optional-chaining at every site.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-getconfig-empty-'));
        try {
          // A fresh lane, so the seeded shape is stated against a known input.
          const cfg = withEnv({ OMEGA_ENVIRONMENT: undefined, OMEGA_BUILD_MODE: undefined }, () => loadConfigInDir(tmp));
          // `environment` rides on every resolved config as the build fact (#817/#896).
          ctx.expect(cfg).toEqual({ environment: 'development', brand: {}, app: {} });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});
