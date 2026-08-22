// Build-layer tests for Manager.getConfig() — omega.json5 resolution + derived defaults.
// Stages a temp consumer dir with a config/omega.json5, sets process.cwd()
// at it, and asserts the resolution + derivation rules.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');

function stageConsumer(jsonText) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-getconfig-'));
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), jsonText);
  return tmp;
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

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'Manager.getConfig — omega.json5 resolution + derived defaults',
  tests: [
    {
      name: 'derives appId from the BRAND: reverse-domain of brand.url, else app.<brand.id> (friction #18)',
      run: (ctx) => {
        const withUrl = stageConsumer(`{ brand: { id: 'somiibo', name: 'Somiibo', url: 'https://www.somiibo.com' }, targets: { desktop: {} } }`);
        try {
          ctx.expect(loadConfigInDir(withUrl).app.appId).toBe('com.somiibo');
        } finally {
          fs.rmSync(withUrl, { recursive: true, force: true });
        }

        const noUrl = stageConsumer(`{ brand: { id: 'somiibo', name: 'Somiibo' }, targets: { desktop: {} } }`);
        try {
          ctx.expect(loadConfigInDir(noUrl).app.appId).toBe('app.somiibo');
        } finally {
          fs.rmSync(noUrl, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'derives productName from brand.name when not set',
      run: (ctx) => {
        const tmp = stageConsumer(`{ brand: { id: 'somiibo', name: 'Somiibo' }, targets: { desktop: {} } }`);
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
            startup:   { mode: 'hidden' },
            platforms: { win: { signing: { strategy: 'cloud' } } },
          } },
        }`);
        try {
          const cfg = loadConfigInDir(tmp);
          ctx.expect(cfg.startup.mode).toBe('hidden');
          ctx.expect(cfg.platforms.win.signing.strategy).toBe('cloud');
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
      name: 'returns seeded {brand:{}, app:{}} when config file missing',
      run: (ctx) => {
        // getConfig() always seeds brand + app blocks so downstream callers can
        // deref config.brand.X / config.app.X without optional-chaining at every site.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-getconfig-empty-'));
        try {
          const cfg = loadConfigInDir(tmp);
          ctx.expect(cfg).toEqual({ brand: {}, app: {} });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
};
