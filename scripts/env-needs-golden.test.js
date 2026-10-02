/**
 * Golden master: what every "which env keys is this brand missing" filter
 * answers today, per brand config and per env, as key names only.
 * The fixture (env-needs-golden.json) is WRITTEN by a run with UPDATE_GOLDEN=1;
 * a plain run only compares, so a changed answer fails instead of rewriting it,
 * unless DISAGREEMENTS names that change with the reason it is allowed.
 * Configs are copied (omega*.json5 only) or built into scratch brand trees and
 * every env is built here: no real .env is read. A scratch OMEGA_HOME keeps any
 * company layer from resolving, so no answer depends on the machine.
 * Run: node --test scripts/env-needs-golden.test.js
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'env-needs-golden.json');
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'env-needs-golden-'));

// Set before any framework module loads: a scratch registry, and one fixed
// environment so no overlay or ambient answer depends on the shell.
const SAVED_PROCESS_ENV = { ...process.env };
process.env.OMEGA_HOME = path.join(SCRATCH, 'omega-home');
process.env.OMEGA_ENVIRONMENT = 'production';

const {
  loadConfig, targetEntries, TARGETS, ENV_SCHEMA, generatedEnvKeys, serializeEnv, FORMATS, formatKeys, missingEnvKeys,
} = require('@omega.js/config');
const { missingRequiredSecrets } = require('@omega.js/devkit/target-secrets');

const pkg = (...parts) => require(path.join(ROOT, 'packages', ...parts));
const backendEnv = pkg('backend', 'src', 'omega', 'libraries', 'env.js');
const { checkService, readTokenStore } = pkg('manager', 'src', 'lib', 'preflight.js');
const { REQUIRES, SERVICE_ORDER } = pkg('manager', 'src', 'config.js');
const { loadBrand } = pkg('manager', 'src', 'lib', 'brand.js');
const { shipTargets } = pkg('manager', 'src', 'services', 'publishing', 'lib', 'ship-list.js');
const publishingKeys = pkg('manager', 'src', 'services', 'publishing', 'ensure', 'keys.js');
const { assertShipKeys } = pkg('desktop', 'src', 'utils', 'ship-keys.js');
const { bakeDefinitions } = pkg('desktop', 'src', 'gulp', 'tasks', 'bundle.js');
const { readBakedEnv } = pkg('extension', 'src', 'gulp', 'tasks', 'bundle.js');
const { storeLanes } = pkg('extension', 'src', 'gulp', 'tasks', 'publish.js');

const IN_REPO_BRANDS = ['naked-brand', 'sandbox-brand', 'playground-omega', 'newsflash-brand'];
const CONFIG_FILE = /^omega(\.[a-z]+)?\.json5$/;

const NAMED = ENV_SCHEMA.filter((entry) => entry.name);
const SCHEMA_NAMES = new Set(NAMED.map((entry) => entry.name));
// Every name a schema key can be read under, cleared before each env applies
const OWNED_NAMES = [...new Set(NAMED.flatMap((entry) => [entry.name, entry.deliverAs].filter(Boolean)))];

const ENVS = {
  empty: {},
  generated: Object.fromEntries(Object.keys(generatedEnvKeys()).map((key) => [key, 'x'])),
  full: Object.fromEntries(NAMED.map((entry) => [entry.name, 'x'])),
};

// ─── Synthetic configs: the rules the in-repo brands leave unexercised ──────

const REAL_PROJECT = { provider: 'firebase', config: { projectId: 'golden-live' } };
const DEMO_PROJECT = { provider: 'firebase', config: { projectId: 'demo-golden' } };
const WEB_BACKEND = { web: { type: 'web' }, backend: { type: 'backend' } };

/**
 * One synthetic brand config.
 * @param {string} id - The brand id.
 * @param {object} cloud - The cloud block.
 * @param {object} targets - The targets map.
 * @param {object} [extra] - Shared sections beside them.
 * @returns {object} A brand omega.json5 as a plain object.
 */
function brandConfig(id, cloud, targets, extra) {
  return { brand: { id, name: `Golden ${id}` }, cloud, ...extra, targets };
}

/**
 * An extension target that ships to one store: the other two are dropped.
 * @param {string} store - 'chrome' | 'firefox' | 'edge'.
 * @returns {object} The targets map.
 */
function oneStore(store) {
  const platforms = Object.fromEntries(['chrome', 'firefox', 'edge'].filter((name) => name !== store).map((name) => [name, false]));
  return { extension: { type: 'extension', platforms } };
}

const SYNTHETIC = {
  'no-backend': brandConfig('golden-no-backend', REAL_PROJECT, { web: { type: 'web' } }),
  'demo-project': brandConfig('golden-demo', DEMO_PROJECT, WEB_BACKEND),
  'real-project': brandConfig('golden-real', REAL_PROJECT, WEB_BACKEND),
  // The switch the manager reads and its Disable writes
  'recaptcha-off': brandConfig('golden-recaptcha-off', REAL_PROJECT, WEB_BACKEND, {
    captcha: { providers: { recaptcha: { enabled: false } } },
  }),
  'recaptcha-site-key': brandConfig('golden-recaptcha-key', REAL_PROJECT, WEB_BACKEND, {
    captcha: { providers: { recaptcha: { siteKey: 'golden-public-site-key' } } },
  }),
  'sentry-no-dsn': brandConfig('golden-sentry-no-dsn', REAL_PROJECT, WEB_BACKEND, {
    monitoring: { providers: { sentry: { org: 'golden' } } },
  }),
  'sentry-dsn': brandConfig('golden-sentry-dsn', REAL_PROJECT, WEB_BACKEND, {
    monitoring: { providers: { sentry: { org: 'golden', dsn: 'https://public@o0.ingest.sentry.io/0' } } },
  }),
  'desktop-azure': brandConfig('golden-desktop-azure', REAL_PROJECT, {
    desktop: { type: 'desktop', platforms: { windows: { signing: { strategy: 'cloud', cloud: { provider: 'azure' } } } } },
  }),
  'desktop-snap': brandConfig('golden-desktop-snap', REAL_PROJECT, {
    desktop: { type: 'desktop', platforms: { linux: { formats: { snap: { channels: ['stable'] } } } } },
  }),
  'extension-chrome': brandConfig('golden-ext-chrome', REAL_PROJECT, oneStore('chrome')),
  'extension-firefox': brandConfig('golden-ext-firefox', REAL_PROJECT, oneStore('firefox')),
  'extension-edge': brandConfig('golden-ext-edge', REAL_PROJECT, oneStore('edge')),
};

// ─── Scratch brand trees ────────────────────────────────────────────────────

/**
 * Copy one in-repo brand's config files (never its .env) into a scratch tree.
 * @param {string} name - The brand folder under brands/.
 * @returns {string} The scratch brand root.
 */
function copyBrand(name) {
  const source = path.join(ROOT, 'brands', name);
  const dest = path.join(SCRATCH, 'brands', `brand-${name}`);

  const copyConfigs = (fromDir, toDir) => {
    fs.mkdirSync(toDir, { recursive: true });
    if (!fs.existsSync(fromDir)) return;
    for (const file of fs.readdirSync(fromDir).filter((entry) => CONFIG_FILE.test(entry))) {
      fs.copyFileSync(path.join(fromDir, file), path.join(toDir, file));
    }
  };

  copyConfigs(path.join(source, 'config'), path.join(dest, 'config'));
  for (const target of fs.readdirSync(path.join(source, 'targets'), { withFileTypes: true })) {
    if (!target.isDirectory()) continue;
    copyConfigs(path.join(source, 'targets', target.name, 'config'), path.join(dest, 'targets', target.name, 'config'));
  }

  return dest;
}

/**
 * Write one synthetic config into a scratch brand tree, one dir per target.
 * @param {string} name - The synthetic config's name.
 * @param {object} config - The brand config.
 * @returns {string} The scratch brand root.
 */
function writeBrand(name, config) {
  const dest = path.join(SCRATCH, 'brands', `synthetic-${name}`);
  fs.mkdirSync(path.join(dest, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'config', 'omega.json5'), `${JSON.stringify(config, null, 2)}\n`);
  for (const target of Object.keys(config.targets)) {
    fs.mkdirSync(path.join(dest, 'targets', target), { recursive: true });
  }

  return dest;
}

/**
 * Make one env the whole truth: the process env every runtime reader sees and
 * the brand .env every file composer reads, both holding exactly `values`.
 * @param {string} brandRoot - The scratch brand root.
 * @param {object} values - Key to value.
 */
function useEnv(brandRoot, values) {
  for (const key of OWNED_NAMES) delete process.env[key];
  Object.assign(process.env, values);

  const file = path.join(brandRoot, '.env');
  if (Object.keys(values).length > 0) {
    fs.writeFileSync(file, serializeEnv(values));
  } else {
    fs.rmSync(file, { force: true });
  }
}

// ─── Reading an answer ──────────────────────────────────────────────────────

const sortedUnique = (keys) => [...new Set(keys)].sort();

/**
 * The schema key names an error message names.
 * @param {Error} error - What a caller threw.
 * @returns {string[]} Sorted key names.
 * @throws {Error} The same error, when it names no key: that is a fault, not an answer.
 */
function keysIn(error) {
  const keys = sortedUnique((error.message.match(/\b[A-Z][A-Z0-9_]*[A-Z0-9]\b/g) || []).filter((token) => SCHEMA_NAMES.has(token)));
  if (keys.length === 0) throw error;

  return keys;
}

/**
 * A throwing caller's answer: [] when it passes, the named keys when it refuses.
 * @param {Function} call - The caller.
 * @returns {string[]} Sorted key names.
 */
function refusedKeys(call) {
  try {
    call();
    return [];
  } catch (error) {
    return keysIn(error);
  }
}

/**
 * Run a caller with its printed lines dropped: a pass line is no answer.
 * @param {Function} call - The caller.
 * @returns {*} What it returned.
 */
function quietly(call) {
  const saved = { log: console.log, info: console.info };
  console.log = () => {};
  console.info = () => {};
  try {
    return call();
  } finally {
    Object.assign(console, saved);
  }
}

/**
 * The publishing service's keys step: the ship keys it refuses on.
 * @param {object} config - The manager's brand config.
 * @returns {string[]} Sorted key names.
 */
function publishingKeysAnswer(config) {
  const result = quietly(() => publishingKeys({ brandConfig: config, shipping: shipTargets(config) }));
  return sortedUnique(result.status === 'error' ? result.output.keys.missing : []);
}

/**
 * A target's resolved config, loaded the way that target's own lane loads it.
 * The backend boot layers its template config under the brand's.
 * @param {string} brandRoot - The scratch brand root.
 * @param {{ name: string, type: string }} target - The target entry.
 * @returns {object} The resolved config.
 */
function targetView(brandRoot, { name, type }) {
  const options = { environment: 'production' };
  if (type === 'backend') {
    options.defaults = loadConfig(path.join(ROOT, 'packages', 'backend', 'templates'), 'backend').config;
    delete options.defaults.targets;
  }

  return loadConfig(path.join(brandRoot, 'targets', name), type, options).config;
}

/**
 * The manager preflight's answer: per service, the env keys it finds missing.
 * @param {string} brandRoot - The scratch brand root.
 * @param {object} config - The manager's brand config.
 * @returns {Object<string, string[]>} Only the services that miss a key.
 */
function preflightAnswer(brandRoot, config) {
  const tokenStore = readTokenStore(brandRoot);
  const answer = {};

  for (const service of SERVICE_ORDER) {
    if (!REQUIRES[service]) continue;
    const finding = checkService(service, REQUIRES[service], config, tokenStore);
    if (finding && finding.missingEnv.length > 0) {
      answer[service] = sortedUnique(finding.missingEnv.map((entry) => entry.name));
    }
  }

  return answer;
}

/**
 * Every caller's answer for one env, keyed `<caller>` or `<caller>@<target>`.
 * @param {string} brandRoot - The scratch brand root.
 * @param {object} config - The manager's brand config.
 * @param {Array<object>} targets - The brand's framework targets, each with its `view`.
 * @returns {Object<string, *>} Caller to answer.
 */
function answersFor(brandRoot, config, targets) {
  const answers = {
    'manager.runPreflight': preflightAnswer(brandRoot, config),
    'manager.publishing.keys': publishingKeysAnswer(config),
  };

  for (const target of targets) {
    const { name, type, view } = target;
    const at = (caller) => `${caller}@${name}`;
    const targetDir = path.join(brandRoot, 'targets', name);

    answers[at('devkit.missingRequiredSecrets')] = sortedUnique(missingRequiredSecrets({ targetDir, target: type }).map((entry) => entry.key));

    if (type === 'backend') {
      answers[at('backend.assertRequired')] = refusedKeys(() => backendEnv.assertRequired('backend'));
      answers[at('backend.assertRules')] = refusedKeys(() => backendEnv.assertRules(view, 'backend'));
    }
    if (type === 'desktop') {
      answers[at('desktop.assertBakeRules')] = refusedKeys(() => bakeDefinitions(process.env, { config: view, mode: { build: true } }));
      answers[at('desktop.assertShipKeys')] = quietly(() => refusedKeys(() => assertShipKeys({ config: view, env: process.env })));
    }
    if (type === 'extension') {
      answers[at('extension.assertBakeRules')] = refusedKeys(() => readBakedEnv(process.env, { config: view, build: true }));
      answers[at('extension.storeLanes')] = refusedKeys(() => storeLanes({ config: view, env: process.env, target: name }));
    }
    if (type === 'desktop' || type === 'extension') {
      // The ship-key question's one home now: the `ship` rows for publish
      const ship = missingEnvKeys(view, process.env, { target: type, verb: 'publish' }).filter((row) => row.need === 'ship');
      answers[at('devkit.missingShipKeys')] = sortedUnique(ship.map((row) => row.key));
    }
  }

  return answers;
}

/**
 * The env-free answer of the format table: every format's keys, narrowed to a target view.
 * @param {object} view - The target's resolved config.
 * @param {string} type - 'desktop' | 'extension'.
 * @returns {Object<string, string[]>} `<platform>.<format>` to sorted key names.
 */
function formatKeysAnswer(view, type) {
  const answer = {};
  for (const [platform, formats] of Object.entries(FORMATS[type])) {
    for (const format of Object.keys(formats)) {
      answer[`${platform}.${format}`] = sortedUnique(formatKeys(type, platform, format, view).requires);
    }
  }

  return answer;
}

/**
 * Record one brand tree: one entry per caller, each holding its answer per env.
 * @param {string} brandRoot - The scratch brand root.
 * @returns {object} The record.
 */
function record(brandRoot) {
  const brand = loadBrand(brandRoot);
  assert.equal(brand.configError, null, `the config at ${brandRoot} must load`);
  assert.deepEqual(brand.configErrors, [], `the config at ${brandRoot} loads clean`);

  const targets = targetEntries(brand.config)
    .filter((entry) => TARGETS.includes(entry.type))
    .map((entry) => ({ name: entry.name, type: entry.type, view: targetView(brandRoot, entry) }));

  const result = {};
  for (const target of targets.filter(({ type }) => type === 'desktop' || type === 'extension')) {
    result[`config.formatKeys@${target.name}`] = formatKeysAnswer(target.view, target.type);
  }

  for (const [envName, values] of Object.entries(ENVS)) {
    useEnv(brandRoot, values);
    for (const [caller, answer] of Object.entries(answersFor(brandRoot, brand.config, targets))) {
      result[caller] = { ...result[caller], [envName]: answer };
    }
  }

  return result;
}

// ─── The comparison ─────────────────────────────────────────────────────────

/**
 * A value with every object's keys sorted, so the written fixture diffs cleanly.
 * @param {*} value - Any JSON value.
 * @returns {*} The same value, keys sorted.
 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

/**
 * Every string leaf of a value.
 * @param {*} value - Any JSON value.
 * @returns {string[]} The leaves.
 */
function stringLeaves(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];

  return Object.values(value).flatMap(stringLeaves);
}

const BACKEND_ONLY = [
  'OMEGA_ADMIN_KEY', 'OMEGA_WEBHOOK_KEY', 'OMEGA_NAMESPACE', 'UNSUBSCRIBE_HMAC_KEY',
  'RECAPTCHA_SECRET_KEY', 'HCAPTCHA_SECRET', 'META_ACCESS_TOKEN', 'TIKTOK_ACCESS_TOKEN', 'SENDGRID_API_KEY', 'BEEHIIV_API_KEY',
  'STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_SECRET', 'CHARGEBEE_API_KEY', 'COINBASE_COMMERCE_API_KEY',
  'ANTHROPIC_API_KEY', 'NEVERBOUNCE_API_KEY', 'ZEROBOUNCE_API_KEY', 'GOOGLE_ANALYTICS_SECRET_BACKEND',
];
const NO_BACKEND_TARGET = [
  'brand:naked-brand', 'synthetic:no-backend', 'synthetic:desktop-azure', 'synthetic:desktop-snap',
  'synthetic:extension-chrome', 'synthetic:extension-firefox', 'synthetic:extension-edge',
];

// The answers the move changes, and nothing else may. Where the two old lists
// disagreed (reCAPTCHA, Sentry, Apple, ship keys) no caller's answer moved: each
// key states both facts now. `change` is the direction a key moves.
const DISAGREEMENTS = [
  {
    why: 'the deploy check compared the brand name of a GA secret with its delivery name and dropped the miss; it compares by delivery name now',
    callers: /^devkit\.missingRequiredSecrets@.+$/,
    keys: ['GOOGLE_ANALYTICS_SECRET_WEB', 'GOOGLE_ANALYTICS_SECRET_BACKEND', 'GOOGLE_ANALYTICS_SECRET_DESKTOP', 'GOOGLE_ANALYTICS_SECRET_EXTENSION', 'GOOGLE_ANALYTICS_SECRET'],
    change: 'added',
  },
  {
    why: 'Contract case 1: a brand with no backend target is never asked for a key only the backend reads',
    configs: NO_BACKEND_TARGET,
    callers: /^manager\.runPreflight$/,
    keys: BACKEND_ONLY,
    change: 'removed',
  },
];

/**
 * Every key in an answer, each with the path that leads to it.
 * @param {*} value - A recorded answer: keys, or an object of them.
 * @param {string} [at] - The path so far.
 * @returns {string[]} `<path> <KEY>` per key.
 */
function keyLeaves(value, at = '') {
  if (Array.isArray(value)) return value.map((key) => `${at} ${key}`);
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([name, child]) => keyLeaves(child, `${at}/${name}`));
}

/**
 * The changed answers of one config that no named disagreement explains.
 * @param {string} config - The config's name.
 * @param {object} was - Its recorded answers.
 * @param {object} now - Its answers on this tree.
 * @returns {string[]} One line per unexplained change.
 */
function unexplainedChanges(config, was, now) {
  const before = new Set(keyLeaves(was));
  const after = new Set(keyLeaves(now));
  const changes = [
    ...[...after].filter((leaf) => !before.has(leaf)).map((leaf) => ['added', leaf]),
    ...[...before].filter((leaf) => !after.has(leaf)).map((leaf) => ['removed', leaf]),
  ];

  return changes.filter(([change, leaf]) => {
    const [where, key] = leaf.split(' ');
    const caller = where.split('/')[1];
    return !DISAGREEMENTS.some((named) => named.keys.includes(key)
      && named.callers.test(caller)
      && (!named.configs || named.configs.includes(config))
      && named.change === change);
  }).map(([change, leaf]) => `${config}: ${change} ${leaf}`);
}

const CONFIGS = {
  ...Object.fromEntries(IN_REPO_BRANDS.map((name) => [`brand:${name}`, () => copyBrand(name)])),
  ...Object.fromEntries(Object.entries(SYNTHETIC).map(([name, config]) => [`synthetic:${name}`, () => writeBrand(name, config)])),
};

const recorded = {};
const golden = UPDATE ? null : JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

after(() => {
  // A partial record is never written: a config that failed to record keeps the old fixture
  if (UPDATE && Object.keys(recorded).length === Object.keys(CONFIGS).length) {
    fs.writeFileSync(FIXTURE, `${JSON.stringify(sortKeys(recorded), null, 2)}\n`);
  }

  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED_PROCESS_ENV)) delete process.env[key];
  }
  Object.assign(process.env, SAVED_PROCESS_ENV);
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

test('the fixture records exactly the configs this file builds', { skip: UPDATE }, () => {
  assert.deepEqual(Object.keys(golden).sort(), Object.keys(CONFIGS).sort());
});

test('the fixture holds key names only, never a value', { skip: UPDATE }, () => {
  const strays = stringLeaves(golden).filter((leaf) => !SCHEMA_NAMES.has(leaf));
  assert.deepEqual(strays, []);
});

test('the comparison lets through a named change and stops any other', () => {
  const deploy = (keys) => ({ 'devkit.missingRequiredSecrets@backend': { empty: keys } });
  const ga = 'GOOGLE_ANALYTICS_SECRET_BACKEND';

  assert.deepEqual(unexplainedChanges('brand:playground-omega', deploy([]), deploy([ga])), [], 'the GA miss is now reported');
  assert.deepEqual(unexplainedChanges('brand:playground-omega', deploy([ga]), deploy([])), [
    `brand:playground-omega: removed /devkit.missingRequiredSecrets@backend/empty ${ga}`,
  ], 'dropping it again is no named change');
  assert.deepEqual(unexplainedChanges('synthetic:real-project', deploy(['OMEGA_ADMIN_KEY']), deploy([])), [
    'synthetic:real-project: removed /devkit.missingRequiredSecrets@backend/empty OMEGA_ADMIN_KEY',
  ]);

  // Case 1's removal holds only for a brand with no backend target
  const preflight = (keys) => ({ 'manager.runPreflight': { empty: { captcha: keys } } });
  assert.deepEqual(unexplainedChanges('synthetic:no-backend', preflight(['RECAPTCHA_SECRET_KEY']), preflight([])), []);
  assert.deepEqual(unexplainedChanges('synthetic:real-project', preflight(['SENDGRID_API_KEY']), preflight([])), [
    'synthetic:real-project: removed /manager.runPreflight/empty/captcha SENDGRID_API_KEY',
  ]);

});

test('every named disagreement names schema keys', () => {
  for (const named of DISAGREEMENTS) {
    assert.deepEqual(named.keys.filter((key) => !SCHEMA_NAMES.has(key)), [], named.why);
  }
});

for (const [name, build] of Object.entries(CONFIGS)) {
  test(`${name}: every caller answers as recorded, apart from the named disagreements`, () => {
    recorded[name] = record(build());

    if (!UPDATE) {
      const now = sortKeys(recorded[name]);
      assert.deepEqual(Object.keys(now), Object.keys(golden[name]), 'the same callers answer');
      assert.deepEqual(unexplainedChanges(name, golden[name], now), []);
    }
  });
}
