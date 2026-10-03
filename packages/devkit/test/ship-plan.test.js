/**
 * ship-plan tests:
 * the one derivation every publish lane and the manage walk read. What a
 * brand's declaration ships, the keys it still owes (missingEnvKeys for
 * `publish`), and the ONE wording a missing ship credential or a missing
 * listing id is reported in.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');

const { missingEnvKeys } = require('@omega.js/config');
const { shipPlan, shipKeyRefusal, listingManualStep } = require('../src/ship-plan.js');

const DESKTOP = { targets: { desktop: { type: 'desktop' } } };

module.exports = defineCases({
  type: 'group',
  description: 'ship-plan',
  tests: [
    {
      name: 'ship-plan: an undeclared extension ships every format, each carrying its own requirements',
      run: (ctx) => {
        const plan = shipPlan({}, 'extension');

        ctx.expect(plan.map((entry) => `${entry.platform}/${entry.format}`)).toEqual(['chrome/zip', 'chrome/store', 'firefox/zip', 'firefox/store', 'edge/zip', 'edge/store']);

        const chromeStore = plan.find((entry) => entry.platform === 'chrome' && entry.format === 'store');
        ctx.expect(chromeStore.kind).toBe('store');
        ctx.expect(chromeStore.requires).toEqual(['CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN']);
        ctx.expect(chromeStore.listing).toEqual(['listings.chrome.id']);
        ctx.expect(chromeStore.path).toBe('platforms.chrome.formats.store');
        ctx.expect(chromeStore.label).toBe('Chrome Web Store');
        ctx.expect(chromeStore.console).toMatch(/^https:\/\//);

        // The firefox listing is never asked for: AMO takes the manifest's gecko id,
        // and the publish that creates the listing writes it back
        ctx.expect(plan.find((entry) => entry.platform === 'firefox' && entry.format === 'store').listing).toEqual([]);
      },
    },

    {
      name: 'ship-plan: a dropped format leaves the plan, and a declared one keeps its options',
      run: (ctx) => {
        const plan = shipPlan({ platforms: { edge: false, chrome: { formats: { store: false } }, firefox: { formats: { store: { channel: 'unlisted' } } } } }, 'extension');

        ctx.expect(plan.map((entry) => `${entry.platform}/${entry.format}`)).toEqual(['chrome/zip', 'firefox/zip', 'firefox/store']);
        ctx.expect(plan.find((entry) => entry.format === 'store').options).toEqual({ channel: 'unlisted' });
      },
    },

    {
      name: 'ship-plan: the desktop snap owes its store credential by default, declared or not',
      run: (ctx) => {
        // The snap is on by default, so a desktop target that never mentions it owes its login
        const bare = shipPlan(DESKTOP, 'desktop').find((entry) => entry.format === 'snap');
        ctx.expect(bare.requires).toEqual(['SNAPCRAFT_STORE_CREDENTIALS']);
        ctx.expect(bare.path).toBe('platforms.linux.formats.snap');

        const declared = shipPlan({ ...DESKTOP, platforms: { linux: { formats: { snap: { channels: ['edge'] } } } } }, 'desktop')
          .find((entry) => entry.format === 'snap');
        ctx.expect(declared.requires).toEqual(['SNAPCRAFT_STORE_CREDENTIALS']);
        ctx.expect(declared.kind).toBe('store');

        // Turned off, the snap leaves the plan with its login
        for (const platforms of [{ linux: { formats: { snap: false } } }, { linux: false }]) {
          ctx.expect(shipPlan({ ...DESKTOP, platforms }, 'desktop').some((entry) => entry.format === 'snap'), JSON.stringify(platforms)).toBe(false);
        }

        // A brand with no desktop target owes no desktop key
        ctx.expect(shipPlan({}, 'desktop').find((entry) => entry.format === 'snap').requires).toEqual([]);
      },
    },

    {
      name: 'ship-plan: the windows signing set narrows to the strategy in force, the default included',
      run: (ctx) => {
        const selfHosted = shipPlan({ ...DESKTOP, platforms: { windows: { signing: { strategy: 'self-hosted' } } } }, 'desktop')
          .find((entry) => entry.format === 'nsis');
        ctx.expect(selfHosted.requires).toEqual(['WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD']);

        const cloud = shipPlan({ ...DESKTOP, platforms: { windows: { signing: { strategy: 'cloud', cloud: { provider: 'azure' } } } } }, 'desktop')
          .find((entry) => entry.format === 'nsis');
        ctx.expect(cloud.requires).toEqual(['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TRUSTED_SIGNING_ENDPOINT']);

        // No strategy written = self-hosted, the default, and its pair is owed
        ctx.expect(shipPlan(DESKTOP, 'desktop').find((entry) => entry.format === 'nsis').requires).toEqual(['WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD']);

        // Windows turned off leaves the plan with its signing set
        ctx.expect(shipPlan({ ...DESKTOP, platforms: { windows: false } }, 'desktop').some((entry) => entry.format === 'nsis')).toBe(false);
      },
    },

    {
      name: 'ship-plan: the publish rows name every empty key the plan requires, with its declaration and store',
      run: (ctx) => {
        const env = { CHROME_CLIENT_ID: 'id', CHROME_CLIENT_SECRET: 'secret', CHROME_REFRESH_TOKEN: 'token', FIREFOX_API_KEY: 'key', FIREFOX_API_SECRET: 'secret' };
        const missing = missingEnvKeys({}, env, { target: 'extension', verb: 'publish' });

        ctx.expect(missing.map(({ key, path, label }) => ({ key, path, label }))).toEqual([
          { key: 'EDGE_CLIENT_ID', path: 'platforms.edge.formats.store', label: 'Microsoft Edge Add-ons' },
          { key: 'EDGE_API_KEY', path: 'platforms.edge.formats.store', label: 'Microsoft Edge Add-ons' },
        ]);

        // An empty string is absent, the same rule the .env cascade applies
        const blank = missingEnvKeys({}, { CHROME_CLIENT_ID: '' }, { target: 'extension', verb: 'publish' });
        ctx.expect(blank.some((entry) => entry.key === 'CHROME_CLIENT_ID')).toBe(true);
      },
    },

    {
      name: 'ship-plan: the refusal names each key, its declaration, its store, and the ONE walk that collects it',
      run: (ctx) => {
        const missing = missingEnvKeys({ platforms: { chrome: false, firefox: false } }, {}, { target: 'extension', verb: 'publish' });
        const message = shipKeyRefusal(missing);

        ctx.expect(message).toMatch(/^2 ship credential/);
        ctx.expect(message).toMatch(/EDGE_CLIENT_ID \(required by platforms\.edge\.formats\.store\): Microsoft Edge Add-ons cannot publish without it/);
        ctx.expect(message).toMatch(/EDGE_API_KEY \(required by platforms\.edge\.formats\.store\): Microsoft Edge Add-ons cannot publish without it/);
        ctx.expect(message).toMatch(/omega manage --service publishing/);
      },
    },

    {
      name: 'ship-plan: a desktop target with an empty env is refused on the default formats, naming the snap\'s path',
      run: (ctx) => {
        const message = shipKeyRefusal(missingEnvKeys(DESKTOP, {}, { target: 'desktop', verb: 'publish' }));

        ctx.expect(message).toMatch(/SNAPCRAFT_STORE_CREDENTIALS \(required by platforms\.linux\.formats\.snap\b/);
        // The refusal says the format is on by default, so a brand that never wrote it knows why
        ctx.expect(message).toMatch(/on by default/);
        ctx.expect(message).toMatch(/WIN_EV_TOKEN_PATH/);
        ctx.expect(message).toMatch(/WIN_CSC_KEY_PASSWORD/);
        ctx.expect(message).toMatch(/omega manage --service publishing/);
      },
    },

    {
      name: 'ship-plan: the manual step says create, upload, paste the config path, re-run',
      run: (ctx) => {
        const line = listingManualStep({
          label: 'Chrome Web Store',
          console: 'https://chrome.google.com/webstore/devconsole',
          path: 'targets.extension.listings.chrome.id',
          asset: 'extension-chrome.zip',
        });

        ctx.expect(line).toMatch(/Chrome Web Store/);
        ctx.expect(line).toMatch(/https:\/\/chrome\.google\.com\/webstore\/devconsole/);
        ctx.expect(line).toMatch(/extension-chrome\.zip/);
        ctx.expect(line).toMatch(/targets\.extension\.listings\.chrome\.id/);
        ctx.expect(line).toMatch(/re-run/);

        // The walk has no asset to point at, so it prints the same line without one
        ctx.expect(listingManualStep({ label: 'Chrome Web Store', console: 'https://x.test', path: 'targets.extension.listings.chrome.id' })).not.toMatch(/upload/);
      },
    },
  ],
});
