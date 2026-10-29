/**
 * brandState(cwd): the one read of what a folder is (empty, unrelated files, a
 * template copy, a half-done brand, a finished brand, a legacy brand), what it
 * lacks, and the one next command. Every brand here is born through the real
 * onboarding with flags and no terminal; a read never changes a file.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');

// Before the source loads: no real npm install, dev stack or GitHub call
const { folder, git, quietly, pluginInstalled } = require('./lib/onboard-seams.js');
require('@omega.js/devkit/test/temp-home');

const { ENV_SCHEMA, loadConfig } = require('@omega.js/config');
const { runOnboard } = require('../src/onboard.js');
const { brandState: readBrandState, STATES } = require('../src/lib/brand-state.js');
const { toolProbe } = require('./lib/tool-probe.js');
const { stageTemplate } = require('./lib/brand-template.js');
const { snapshot } = require('./lib/tree-snapshot.js');
const { install } = require('./lib/brand-install.js');

pluginInstalled();

/** brandState with every machine tool present unless `options` hands in its own probe. */
const brandState = (cwd, options = {}) => readBrandState(cwd, { execFn: toolProbe(), ...options });

const FLAGS = { id: 'acme', name: 'Acme', url: 'https://acme.test', manage: false, dev: false, execFn: toolProbe() };

// Keys only the backend reads, so a brand with no backend never lacks one
const BACKEND_ONLY_KEYS = [
  'OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE', 'UNSUBSCRIBE_HMAC_KEY',
  'RECAPTCHA_SECRET_KEY', 'HCAPTCHA_SECRET', 'META_ACCESS_TOKEN', 'TIKTOK_ACCESS_TOKEN',
  'SENDGRID_API_KEY', 'BEEHIIV_API_KEY', 'STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_SECRET',
  'CHARGEBEE_API_KEY', 'COINBASE_COMMERCE_API_KEY', 'GOOGLE_ANALYTICS_SECRET_BACKEND',
  'ANTHROPIC_API_KEY', 'NEVERBOUNCE_API_KEY', 'ZEROBOUNCE_API_KEY',
];

// Keys only an operator of that product holds, so a new brand never owes one
const OPERATOR_ONLY_KEYS = ['SLAPFORM_SERVICE_ACCOUNT', 'CHATSY_SERVICE_ACCOUNT', 'REPLYIFY_SERVICE_ACCOUNT', 'SERVER_SERVICE_ACCOUNT'];

// The keys OMEGA mints for a backend: generated, never asked
const MINTED_KEYS = ['OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE', 'UNSUBSCRIBE_HMAC_KEY'];

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A brand onboarded with flags and no terminal, its dependencies not installed. */
async function onboarded(expect, targets = 'web,backend') {
  const root = folder('acme');
  const { report } = await quietly(() => runOnboard(root, { ...FLAGS, targets }));
  expect(report.valid, 'the fixture brand onboarded clean').toBe(true);
  return root;
}

/** A finished brand: onboarded, then installed. */
async function completeBrand(expect, targets) {
  return install(await onboarded(expect, targets));
}

/** Give the brand config a retired key, every other line as onboarding wrote it. */
function withRetiredKey(root) {
  const file = path.join(root, 'config', 'omega.json5');
  const config = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, config.replace(/^\{$/m, '{\n  slapform: { endpoint: "https://slapform.test/f/abc" },'));
  return root;
}

/** A finished brand as a fresh clone leaves it: only tracked files, then installed. */
async function clonedBrand(expect) {
  const source = await onboarded(expect);
  const root = path.join(path.dirname(source), 'acme-clone');
  git(path.dirname(source), 'clone', '-q', source, root);
  return install(root);
}

/** Turn a gating service on: Sentry chosen as the monitoring provider. */
function withSentry(root) {
  const file = path.join(root, 'config', 'omega.json5');
  const config = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, config.replace(/^\{$/m, '{\n  monitoring: { providers: { sentry: { org: "acme" } } },'));
  return root;
}

/**
 * Read the brand with an empty .env and no schema key in process.env, so
 * nothing from the machine or an earlier test fills a gap.
 */
async function stateWithEmptyEnv(root) {
  fs.writeFileSync(path.join(root, '.env'), '');
  const saved = {};
  for (const { name } of ENV_SCHEMA) {
    if (!name || !(name in process.env)) continue;
    saved[name] = process.env[name];
    delete process.env[name];
  }
  try {
    return await brandState(root);
  } finally {
    for (const { name } of ENV_SCHEMA) if (name) delete process.env[name];
    Object.assign(process.env, saved);
  }
}

/** The keys of the env rows whose `optional` is exactly `optional`. */
const envKeys = (report, optional) => report.missing.env.filter((entry) => entry.optional === optional).map((entry) => entry.key);

/** A missing-list entry holds a gap: a non-empty list, or a truthy flag. */
const listed = (value) => (Array.isArray(value) ? value.length > 0 : Boolean(value));

/** The target `inTarget` names, whether it holds the name or a record of it. */
const targetName = (inTarget) => (typeof inTarget === 'string' ? inTarget : inTarget.name);

module.exports = defineCases({
  type: 'group',
  description: 'brand-state',
  tests: [
    // ─── The names ───────────────────────────────────────────────────────────────

    {
      name: '#1031 names: STATES are the six states',
      run: (ctx) => {
        ctx.expect([...STATES].sort()).toEqual(['brand', 'empty', 'half-done', 'legacy', 'template', 'unrelated']);
      },
    },

    // ─── One test per state ──────────────────────────────────────────────────────

    {
      name: '#1031 case 1: an empty folder is empty',
      run: async (ctx) => {
        const report = await brandState(folder('empty'));

        ctx.expect(report.state).toBe('empty');
      },
    },

    {
      name: '#1031 case 1: a folder holding only .DS_Store is empty',
      run: async (ctx) => {
        const root = folder('empty');
        fs.writeFileSync(path.join(root, '.DS_Store'), Buffer.from([0, 0, 0, 1]));

        const report = await brandState(root);

        ctx.expect(report.state).toBe('empty');
      },
    },

    {
      name: '#1031 case 2: files with no brand config and no template mark are unrelated',
      run: async (ctx) => {
        const root = folder('my-app');
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'my-app', private: true }));
        fs.writeFileSync(path.join(root, 'index.js'), 'console.log("hello");\n');

        const report = await brandState(root);

        ctx.expect(report.state).toBe('unrelated');
      },
    },

    {
      name: '#1031 case 3: a package.json carrying the template mark, with no brand config, is a template whose next command is npm start',
      run: async (ctx) => {
        const report = await brandState(stageTemplate(folder('acme-omega')));

        ctx.expect(report.state).toBe('template');
        ctx.expect(report.next).toBe('npm start');
      },
    },

    {
      name: '#1031 case 4: a brand config with a scaffold file missing is half-done, and the file is listed',
      run: async (ctx) => {
        const root = await completeBrand(ctx.expect);
        fs.rmSync(path.join(root, '.gitignore'));

        const report = await brandState(root);

        ctx.expect(report.state).toBe('half-done');
        ctx.expect(report.missing.files).toEqual(['.gitignore']);
      },
    },

    {
      name: '#1031 case 4: a declared target with no folder is half-done, and the target is listed',
      run: async (ctx) => {
        const root = await completeBrand(ctx.expect);
        fs.rmSync(path.join(root, 'targets', 'backend'), { recursive: true });

        const report = await brandState(root);

        ctx.expect(report.state).toBe('half-done');
        ctx.expect(report.missing.targets).toEqual(['backend']);
      },
    },

    {
      name: '#1031 case 4: a brand whose dependencies are not installed is half-done, and the install is listed',
      run: async (ctx) => {
        const report = await brandState(await onboarded(ctx.expect));

        ctx.expect(report.state).toBe('half-done');
        ctx.expect(listed(report.missing.install), `install is listed: ${JSON.stringify(report.missing)}`).toBeTruthy();
      },
    },

    {
      name: '#1031 case 4: a config that does not load is half-done, and the config is listed',
      run: async (ctx) => {
        const root = await completeBrand(ctx.expect);
        fs.writeFileSync(path.join(root, 'config', 'omega.json5'), '{ brand: { id: "acme",\n');

        const report = await brandState(root);

        ctx.expect(report.state).toBe('half-done');
        ctx.expect(listed(report.missing.config), `config is listed: ${JSON.stringify(report.missing)}`).toBeTruthy();
      },
    },

    {
      name: '#1031 case 5: a complete brand is a brand, and nothing is listed as missing',
      run: async (ctx) => {
        const root = await completeBrand(ctx.expect);

        const report = await brandState(root);

        ctx.expect(report.state).toBe('brand');
        ctx.expect(report.brandRoot).toBe(root);
        ctx.expect(!report.inTarget, 'the brand root is no target').toBeTruthy();
        for (const kind of ['files', 'targets', 'config', 'install']) {
          ctx.expect(listed(report.missing[kind]), `${kind}: ${JSON.stringify(report.missing[kind])}`).toBe(false);
        }
      },
    },

    {
      name: '#1031 case 5: a finished brand freshly cloned, its gitignored files absent, is a brand with nothing missing',
      run: async (ctx) => {
        const root = await clonedBrand(ctx.expect);
        ctx.expect(fs.existsSync(path.join(root, '.env')), 'the clone carries no .env').toBe(false);

        const report = await brandState(root);

        ctx.expect(report.state).toBe('brand');
        for (const kind of ['files', 'targets', 'config', 'install']) {
          ctx.expect(listed(report.missing[kind]), `${kind}: ${JSON.stringify(report.missing[kind])}`).toBe(false);
        }
      },
    },

    {
      name: '#1031 case 6: a brand config with a retired key is legacy, and the next command is npx omega migrate',
      run: async (ctx) => {
        const root = withRetiredKey(await completeBrand(ctx.expect));

        const report = await brandState(root);

        ctx.expect(report.state).toBe('legacy');
        ctx.expect(report.next).toBe('npx omega migrate');
      },
    },

    {
      name: '#1056: a seo sidecar item carrying the retired org is legacy, its file read as the seo section',
      run: async (ctx) => {
        const root = await completeBrand(ctx.expect);
        fs.writeFileSync(path.join(root, 'config', 'seo.json5'), "{ github: { content: [{ name: 'tool', org: 'Acme-Org' }] } }\n");

        // The load itself refuses the item now, before any service runs
        ctx.expect(loadConfig(root).errors.includes('config.seo.github.content[0].org is not a key the schema declares. Remove it, or if it is a legacy key run `npx omega migrate` at the brand root (report) and `--execute` to convert (docs/shared/config.md → Validation)'), 'the brand load names the item by its position').toBeTruthy();

        const report = await brandState(root);

        ctx.expect(report.state).toBe('legacy');
        ctx.expect(report.next).toBe('npx omega migrate');
      },
    },

    {
      name: '#1031 case 7: inside a target, the report is the brand root\'s and inTarget names the target',
      run: async (ctx) => {
        const root = await completeBrand(ctx.expect);
        const targetDir = path.join(root, 'targets', 'web');
        const deep = path.join(targetDir, 'src', 'pages');
        fs.mkdirSync(deep, { recursive: true });

        for (const cwd of [targetDir, deep]) {
          const report = await brandState(cwd);
          ctx.expect(report.state, cwd).toBe('brand');
          ctx.expect(report.brandRoot, cwd).toBe(root);
          ctx.expect(targetName(report.inTarget), cwd).toBe('web');
        }
      },
    },

    {
      name: '#1031 case 9: a read in any state leaves every file and folder as it was, adding not even an empty folder',
      run: async (ctx) => {
        const brand = await completeBrand(ctx.expect);
        const deep = path.join(brand, 'targets', 'web', 'src');
        fs.mkdirSync(deep, { recursive: true });
        const unrelated = folder('my-app');
        fs.writeFileSync(path.join(unrelated, 'index.js'), 'console.log("hello");\n');
        const missingFile = await completeBrand(ctx.expect);
        fs.rmSync(path.join(missingFile, 'README.md'));
        const missingTarget = await completeBrand(ctx.expect);
        fs.rmSync(path.join(missingTarget, 'targets', 'web'), { recursive: true });
        const broken = await completeBrand(ctx.expect);
        fs.writeFileSync(path.join(broken, 'config', 'omega.json5'), '{ brand: {\n');

        const cases = [
          ['empty', folder('empty'), null],
          ['unrelated', unrelated, null],
          ['template', stageTemplate(folder('acme-omega')), null],
          ['half-done, a file missing', missingFile, null],
          ['half-done, a target missing', missingTarget, null],
          ['half-done, not installed', await onboarded(ctx.expect), null],
          ['half-done, a config that does not load', broken, null],
          ['brand', brand, null],
          ['brand, freshly cloned', await clonedBrand(ctx.expect), null],
          ['brand, read from inside a target', brand, deep],
          ['legacy', withRetiredKey(await completeBrand(ctx.expect)), null],
        ];
        for (const [label, root, cwd] of cases) {
          const before = snapshot(root);
          await brandState(cwd || root);
          ctx.expect(snapshot(root), `${label}: nothing written, moved or removed`).toEqual(before);
        }
      },
    },

    // ─── The missing keys ────────────────────────────────────────────────────────

    {
      name: '#1029 case 11: a brand with reCAPTCHA on and an empty env lists RECAPTCHA_SECRET_KEY; a brand with no backend lists no backend-only key',
      run: async (ctx) => {
        delete process.env.RECAPTCHA_SECRET_KEY;

        const withBackend = await brandState(await completeBrand(ctx.expect, 'web,backend'));
        ctx.expect(JSON.stringify(withBackend.missing).includes('"RECAPTCHA_SECRET_KEY"'), `the missing keys name it: ${JSON.stringify(withBackend.missing)}`).toBeTruthy();

        const webOnly = JSON.stringify((await brandState(await completeBrand(ctx.expect, 'web'))).missing);
        ctx.expect(BACKEND_ONLY_KEYS.filter((key) => webOnly.includes(`"${key}"`)), webOnly).toEqual([]);
        ctx.expect(webOnly).not.toMatch(/"CONNECTIONS_/);
      },
    },

    // ─── Optional keys ───────────────────────────────────────────────────────────

    {
      name: '#1031 status: a fresh website-alone brand with an empty env is ready for npm start, its operator-only keys optional',
      run: async (ctx) => {
        const report = await stateWithEmptyEnv(await completeBrand(ctx.expect, 'web'));

        ctx.expect(report.state).toBe('brand');
        ctx.expect(report.next).toBe('npm start');
        ctx.expect(OPERATOR_ONLY_KEYS.filter((key) => !envKeys(report, true).includes(key)), `each operator-only key is optional: ${JSON.stringify(report.missing.env)}`).toEqual([]);
      },
    },

    {
      name: '#1031 status: a brand with a backend and an empty env is ready for npm start, the minted keys never asked',
      run: async (ctx) => {
        const report = await stateWithEmptyEnv(await completeBrand(ctx.expect, 'web,backend'));

        ctx.expect(report.state).toBe('brand');
        ctx.expect(report.next).toBe('npm start');
        const listedKeys = report.missing.env.map((entry) => entry.key);
        ctx.expect(MINTED_KEYS.filter((key) => listedKeys.includes(key)), JSON.stringify(report.missing.env)).toEqual([]);
      },
    },

    {
      name: '#1031 status: a key with its own provider switch is optional, the answer manage gives',
      run: async (ctx) => {
        const report = await stateWithEmptyEnv(await completeBrand(ctx.expect, 'web,backend'));

        // Each provider token sits behind its own `analytics.providers.<x>` switch, so
        // manage never gates on it and status lists it as optional, like preflight does
        ctx.expect(['META_ACCESS_TOKEN', 'TIKTOK_ACCESS_TOKEN'].filter((key) => !envKeys(report, true).includes(key)), JSON.stringify(report.missing.env)).toEqual([]);
      },
    },

    {
      name: '#1031 status: a brand that turns a gating service on and lacks its key is still ready for npm start, the key listed as not optional',
      run: async (ctx) => {
        const report = await stateWithEmptyEnv(withSentry(await completeBrand(ctx.expect, 'web')));

        ctx.expect(report.state).toBe('brand');
        ctx.expect(report.next).toBe('npm start');
        ctx.expect(envKeys(report, false).includes('SENTRY_AUTH_TOKEN'), `SENTRY_AUTH_TOKEN is listed with optional: false: ${JSON.stringify(report.missing.env)}`).toBeTruthy();
      },
    },

    // ─── Machine tools ───────────────────────────────────────────────────────────

    {
      name: '#1032 case 9: a brand whose backend misses the Firebase CLI lists it in missing.tools',
      run: async (ctx) => {
        const root = await completeBrand(ctx.expect, 'web,backend');

        const report = await brandState(root, { execFn: toolProbe('firebase') });

        const names = (report.missing.tools || []).map((tool) => (typeof tool === 'string' ? tool : tool.name));
        ctx.expect(names, JSON.stringify(report.missing)).toEqual(['firebase']);
      },
    },
  ],
});
