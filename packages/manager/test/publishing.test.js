// Tests for the publishing service ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)):
// the manage walk's owner of every SHIP credential, which is the store API
// keys, the snap login, the Windows signing set, and the per-listing ids.
//
// Nothing here is a list this service types. The ask list is DERIVED from the
// brand's own declaration (`targets.<name>.platforms.<platform>.formats`)
// through @omega.js/config's format table, so a brand that drops a store is
// never asked for its keys and a brand that adds one is asked without anybody
// editing the manager. The human half of every ask (label, mint page, hint)
// comes from the env schema, which is its one home.
//
// The three outcomes: an interactive run pastes, a run that CANNOT ask fails
// loudly naming the key and the walk (a shipped store with no credential is a
// publish that dies in CI), and a listing id only a human can create is warned
// with the manual step instead.

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');

const { setPromptStreams } = require('@omega.js/devkit/prompt');
const { setBrowserOpener } = require('@omega.js/devkit/flows');

const { missingEnvKeys } = require('@omega.js/config');
const { REQUIRES, SERVICE_ORDER, OPERATIONS, serviceInputs, serviceInputSpec } = require('../src/config.js');
const { run } = require('../src/services/publishing/index.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const { openTtyPrompt } = require('./lib/interactive.js');

const DOWN = '\x1B[B';

const SHIP_KEYS = [
  'WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD',
  'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TRUSTED_SIGNING_ENDPOINT',
  'SSLCOM_USERNAME', 'SSLCOM_PASSWORD', 'SSLCOM_CREDENTIAL_ID',
  'DIGICERT_API_KEY', 'DIGICERT_KEYPAIR_ALIAS',
  'SNAPCRAFT_STORE_CREDENTIALS',
  'CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN',
  'FIREFOX_API_KEY', 'FIREFOX_API_SECRET',
  'EDGE_CLIENT_ID', 'EDGE_API_KEY',
];

function cleanup() {
  for (const name of SHIP_KEYS) delete process.env[name];
}

/** Stub the real browser launch: pressEnterToOpen's seam and the config flow's. */
function stubBrowser() {
  const promptModule = require('@omega.js/devkit/prompt');
  const real = promptModule.openInBrowser;
  const opened = [];

  promptModule.openInBrowser = (url) => { opened.push(url); return true; };
  setBrowserOpener(async (url) => { opened.push(url); return true; });

  return {
    opened,
    restore: () => {
      promptModule.openInBrowser = real;
      setBrowserOpener(null);
      setPromptStreams(null);
    },
  };
}

function context(brandRoot, brandConfig, options = {}) {
  return {
    brandId: 'b',
    brandRoot,
    brandConfig,
    operations: OPERATIONS.publishing,
    options,
  };
}

/** A brand whose only target is an extension shipping just the Edge store. */
function edgeOnlyBrand() {
  const source = `{\n  brand: { id: 'b' },\n  // keep me\n  targets: {\n    extension: { type: 'extension', platforms: { chrome: false, firefox: false } },\n  },\n}\n`;
  const brandConfig = {
    brand: { id: 'b' },
    targets: { extension: { type: 'extension', platforms: { chrome: false, firefox: false } } },
  };

  return { brandRoot: makeBrandRoot(source), brandConfig };
}

module.exports = defineCases({
  type: 'group',
  description: 'publishing',
  tests: [
    // ─── the registry ────────────────────────────────────────────────────────────

    {
      name: 'publishing: the registry declares every ship credential the format table names',
      run: (ctx) => {
        const declaration = REQUIRES.publishing;
        const inputs = serviceInputs('publishing');

        ctx.expect(declaration.label).toBe('Publishing');
        ctx.expect(declaration.disablePath).toBe('publishing.enabled');
        ctx.expect(inputs.map((entry) => entry.name).sort()).toEqual([...SHIP_KEYS].sort());

        for (const entry of inputs) {
          ctx.expect(entry.prompted, `${entry.name} is collected mid-run on a TTY`).toBe(true);
          ctx.expect(entry.gates, `${entry.name} is optional: preflight never gates a walk on a ship credential`).toBe(false);
        }

        // The human half comes from the schema, never from the registry (#867)
        const spec = serviceInputSpec('publishing');
        const chrome = spec.inputs.find((input) => input.name === 'CHROME_CLIENT_ID');
        ctx.expect(chrome.label).toBe('Chrome Web Store OAuth client ID');
        ctx.expect(chrome.url).toMatch(/^https:\/\//);
        ctx.expect(chrome.hint).toBeTruthy();

        // It runs after certificates, which keeps the Apple material
        ctx.expect(SERVICE_ORDER[SERVICE_ORDER.indexOf('certificates') + 1]).toBe('publishing');
        ctx.expect(OPERATIONS.publishing.map((operation) => operation.name)).toEqual(['keys', 'listings']);
      },
    },

    {
      name: 'publishing: the ask list follows the brand DECLARATION, not a typed list',
      run: (ctx) => {
        // What manage asks the publishing service for, from the one function
        const asked = (config) => missingEnvKeys(config, {}, { verb: 'manage' })
          .filter((row) => row.service === 'publishing')
          .map((row) => row.key)
          .sort();
        const sorted = (keys) => [...keys].sort();

        // No desktop and no extension target: nothing to ship, nothing to ask
        ctx.expect(asked({ targets: { web: { type: 'web' } } })).toEqual([]);

        // An undeclared extension ships all three stores, so it owes all seven keys
        ctx.expect(asked({ targets: { extension: { type: 'extension' } } })).toEqual(sorted([
          'CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN',
          'FIREFOX_API_KEY', 'FIREFOX_API_SECRET',
          'EDGE_CLIENT_ID', 'EDGE_API_KEY',
        ]));

        // Dropping a store drops its keys with it
        ctx.expect(asked({ targets: { extension: { type: 'extension', platforms: { chrome: { formats: { store: false } }, edge: false } } } })).toEqual(sorted(['FIREFOX_API_KEY', 'FIREFOX_API_SECRET']));

        // A desktop brand ships the snap and the self-hosted-signed installer by
        // default, so it owes their keys whether it declares them or not
        const defaults = sorted(['WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD', 'SNAPCRAFT_STORE_CREDENTIALS']);
        ctx.expect(asked({ targets: { desktop: { type: 'desktop' } } })).toEqual(defaults);
        ctx.expect(asked({ targets: { desktop: { type: 'desktop', platforms: { linux: { formats: { snap: {} } }, windows: { signing: { strategy: 'self-hosted' } } } } } })).toEqual(defaults);

        // Turning a format off drops its keys, and the Windows set follows the strategy in force
        ctx.expect(asked({ targets: { desktop: { type: 'desktop', platforms: { linux: false, windows: false } } } })).toEqual([]);
        ctx.expect(asked({ targets: { desktop: { type: 'desktop', platforms: { linux: { formats: { snap: false } } } } } })).toEqual(sorted(['WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD']));
        ctx.expect(asked({ targets: { desktop: { type: 'desktop', platforms: { windows: { signing: { strategy: 'cloud', cloud: { provider: 'azure' } } } } } } })).toEqual(sorted(['SNAPCRAFT_STORE_CREDENTIALS', 'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TRUSTED_SIGNING_ENDPOINT']));

        // Two targets in one brand: the union
        ctx.expect(asked({ targets: { extension: { type: 'extension', platforms: { chrome: false, firefox: false } }, desktop: { type: 'desktop', platforms: { linux: { formats: { snap: true } } } } } })).toEqual(sorted(['SNAPCRAFT_STORE_CREDENTIALS', 'WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD', 'EDGE_CLIENT_ID', 'EDGE_API_KEY']));
      },
    },

    // ─── the gates ───────────────────────────────────────────────────────────────

    {
      name: 'publishing: a brand with no desktop or extension target skips before any ask',
      run: async (ctx) => {
        cleanup();
        const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n  targets: { web: { type: "web" } },\n}\n');

        try {
          const result = await run(context(brandRoot, { brand: { id: 'b' }, targets: { web: { type: 'web' } } }));
          ctx.expect(result.status).toBe('skipped');
          ctx.expect(result.reason).toMatch(/no desktop or extension target/);
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'publishing: publishing.enabled = false skips the whole service',
      run: async (ctx) => {
        cleanup();
        const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');
        const brandConfig = { publishing: { enabled: false }, targets: { extension: { type: 'extension' } } };

        try {
          const result = await run(context(brandRoot, brandConfig));
          ctx.expect(result.status).toBe('skipped');
          ctx.expect(result.reason).toMatch(/publishing\.enabled/);
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    // ─── asking ──────────────────────────────────────────────────────────────────

    {
      name: 'publishing: PROVIDE opens the mint page and lands the key in the brand .env',
      run: async (ctx) => {
        cleanup();
        // A desktop brand that ships the snap and no Windows installer owes exactly
        // one credential, and the Snap Store has no listing id to collect
        const source = `{\n  brand: { id: 'b' },\n  // keep me\n  targets: {\n    desktop: { type: 'desktop', platforms: { linux: { formats: { snap: {} } }, windows: false } },\n  },\n}\n`;
        const brandRoot = makeBrandRoot(source);
        const brandConfig = {
          brand: { id: 'b' },
          targets: { desktop: { type: 'desktop', platforms: { linux: { formats: { snap: {} } }, windows: false } } },
        };
        fs.writeFileSync(path.join(brandRoot, '.env'), 'EXISTING_KEY="keep-me"\n');

        const tty = openTtyPrompt();
        const browser = stubBrowser();
        try {
          const running = run(context(brandRoot, brandConfig));
          await tty.answer('Set up now?', '\r');                                     // Provide
          await tty.answer('Press Enter to open the Snap Store credentials page', '\r');
          await tty.answer('Paste SNAPCRAFT_STORE_CREDENTIALS', 'snap-blob\r');
          const result = await running;

          ctx.expect(result.status).toBe('success');
          ctx.expect(process.env.SNAPCRAFT_STORE_CREDENTIALS).toBe('snap-blob');
          ctx.expect(browser.opened).toEqual(['https://snapcraft.io/account']);

          const env = fs.readFileSync(path.join(brandRoot, '.env'), 'utf8');
          ctx.expect(env).toMatch(/EXISTING_KEY="keep-me"/);
          ctx.expect(env).toMatch(/SNAPCRAFT_STORE_CREDENTIALS="snap-blob"/);
          ctx.expect(readConfigSource(brandRoot), 'a key is never config').toBe(source);
        } finally {
          tty.close();
          browser.restore();
          cleanup();
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'publishing: the listing id is asked for and lands in CONFIG, never the .env',
      run: async (ctx) => {
        cleanup();
        const { brandRoot, brandConfig } = edgeOnlyBrand();
        process.env.EDGE_CLIENT_ID = 'edge-client';
        process.env.EDGE_API_KEY = 'edge-key';

        const tty = openTtyPrompt();
        const browser = stubBrowser();
        try {
          const running = run(context(brandRoot, brandConfig));
          await tty.answer('Set up now?', '\r');                                     // Provide
          await tty.answer('Microsoft Edge Add-ons listing id', 'edge-product-guid\r');
          const result = await running;

          ctx.expect(result.status).toBe('success');
          ctx.expect(browser.opened).toEqual(['https://partner.microsoft.com/dashboard/microsoftedge/']);

          // The id is CONFIG (#893), and the brand's own file is EDITED
          const source = readConfigSource(brandRoot);
          ctx.expect(source).toMatch(/id: "edge-product-guid"/);
          ctx.expect(source).toMatch(/\/\/ keep me/);
          ctx.expect(fs.existsSync(path.join(brandRoot, '.env'))).toBe(false);
        } finally {
          tty.close();
          browser.restore();
          cleanup();
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'publishing: "not yet" on a listing id writes nothing and warns with the manual step',
      run: async (ctx) => {
        cleanup();
        const { brandRoot, brandConfig } = edgeOnlyBrand();
        process.env.EDGE_CLIENT_ID = 'edge-client';
        process.env.EDGE_API_KEY = 'edge-key';

        const tty = openTtyPrompt();
        const browser = stubBrowser();
        try {
          const running = run(context(brandRoot, brandConfig));
          await tty.answer('Set up now?', `${DOWN}\r`);                              // Skip for now: not yet
          const result = await running;

          ctx.expect(result.status).toBe('warned');
          ctx.expect(result.warned[0].reason).toMatch(/targets\.extension\.listings\.edge\.id/);
          ctx.expect(readConfigSource(brandRoot)).not.toMatch(/listings/);
        } finally {
          tty.close();
          browser.restore();
          cleanup();
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'publishing: everything present is asked for nothing and writes nothing',
      run: async (ctx) => {
        cleanup();
        const source = `{\n  brand: { id: 'b' },\n  targets: {\n    extension: { type: 'extension', platforms: { chrome: false, firefox: false }, listings: { edge: { id: 'already' } } },\n  },\n}\n`;
        const brandRoot = makeBrandRoot(source);
        const brandConfig = {
          brand: { id: 'b' },
          targets: { extension: { type: 'extension', platforms: { chrome: false, firefox: false }, listings: { edge: { id: 'already' } } } },
        };
        process.env.EDGE_CLIENT_ID = 'edge-client';
        process.env.EDGE_API_KEY = 'edge-key';

        const tty = openTtyPrompt();
        try {
          const result = await run(context(brandRoot, brandConfig));

          ctx.expect(result.status).toBe('success');
          ctx.expect(fs.existsSync(path.join(brandRoot, '.env')), 'nothing was written').toBe(false);
          ctx.expect(readConfigSource(brandRoot), 'the brand file is byte-identical').toBe(source);
        } finally {
          tty.close();
          setPromptStreams(null);
          cleanup();
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    // ─── the runs that cannot ask ────────────────────────────────────────────────

    {
      name: 'publishing: a headless run FAILS on a missing developer key, naming the key and the walk',
      run: async (ctx) => {
        cleanup();
        const { brandRoot, brandConfig } = edgeOnlyBrand();

        try {
          const result = await run(context(brandRoot, brandConfig, { dryRun: true }));

          ctx.expect(result.status).toBe('error');
          ctx.expect(result.error).toMatch(/EDGE_CLIENT_ID \(required by platforms\.edge\.formats\.store\)/);
          ctx.expect(result.error).toMatch(/EDGE_API_KEY/);
          ctx.expect(result.error).toMatch(/omega manage --service publishing/);
          // Nothing was asked and nothing was written
          ctx.expect(fs.existsSync(path.join(brandRoot, '.env'))).toBe(false);
        } finally {
          cleanup();
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'publishing: a headless run with the keys present WARNS on the missing listing id',
      run: async (ctx) => {
        cleanup();
        const { brandRoot, brandConfig } = edgeOnlyBrand();
        process.env.EDGE_CLIENT_ID = 'edge-client';
        process.env.EDGE_API_KEY = 'edge-key';

        const lines = [];
        const realLog = console.log;
        console.log = (...args) => lines.push(args.join(' '));
        try {
          const result = await run(context(brandRoot, brandConfig, { dryRun: true }));

          ctx.expect(result.status).toBe('warned');
          ctx.expect(result.warned[0].reason).toMatch(/targets\.extension\.listings\.edge\.id/);

          const printed = lines.join('\n');
          ctx.expect(printed).toMatch(/Microsoft Edge Add-ons has no listing id yet/);
          ctx.expect(printed).toMatch(/partner\.microsoft\.com/);
          ctx.expect(printed).toMatch(/targets\.extension\.listings\.edge\.id/);
        } finally {
          console.log = realLog;
          cleanup();
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'publishing: a headless run FAILS on a desktop target\'s default formats, naming the snap\'s path',
      run: async (ctx) => {
        cleanup();
        const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');
        const brandConfig = { brand: { id: 'b' }, targets: { desktop: { type: 'desktop' } } };

        try {
          const result = await run(context(brandRoot, brandConfig, { dryRun: true }));

          ctx.expect(result.status).toBe('error');
          ctx.expect(result.error).toMatch(/SNAPCRAFT_STORE_CREDENTIALS \(required by platforms\.linux\.formats\.snap\b/);
          ctx.expect(result.error).toMatch(/on by default/);
          ctx.expect(result.error).toMatch(/WIN_EV_TOKEN_PATH/);
          ctx.expect(result.error).toMatch(/WIN_CSC_KEY_PASSWORD/);
          ctx.expect(fs.existsSync(path.join(brandRoot, '.env'))).toBe(false);
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'publishing: a desktop brand that turns off the snap and Windows has nothing to collect',
      run: async (ctx) => {
        cleanup();
        const brandRoot = makeBrandRoot('{\n  brand: { id: "b" },\n}\n');
        const brandConfig = { brand: { id: 'b' }, targets: { desktop: { type: 'desktop', platforms: { linux: false, windows: false } } } };

        try {
          const result = await run(context(brandRoot, brandConfig, { dryRun: true }));

          ctx.expect(result.status).toBe('success');
          ctx.expect(fs.existsSync(path.join(brandRoot, '.env'))).toBe(false);
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
  ],
});
