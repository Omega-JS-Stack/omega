// Tests for src/lib/preflight.js + the REQUIRES registry — the per-service
// requires: { env, scopes } gate run before any service: declaration
// when-gates (service and entry level), env presence (names only — values
// NEVER printed), scope checks against the token store's granted-scopes
// record, the run/skip/strict verdicts, the cp236-tone walkthrough content,
// and the runManage wiring (skip-and-continue vs --strict hard failure).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { setPromptStreams } = require('@omega.js/devkit/prompt');

const { REQUIRES, SERVICE_ORDER } = require('../src/config.js');
const { runPreflight, checkService, readTokenStore, assertFamilyVersions } = require('../src/lib/preflight.js');
const { runManage } = require('../src/manage.js');
const { googleTokenStorePath } = require('../src/lib/google-auth.js');

// Preflight checks must be deterministic regardless of the shell's exports
delete process.env.CLOUDFLARE_TOKEN;
delete process.env.NAMECHEAP_USERNAME;
delete process.env.NAMECHEAP_API_KEY;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.RECAPTCHA_SITE_KEY;
delete process.env.RECAPTCHA_SECRET_KEY;
delete process.env.SENDGRID_API_KEY;
delete process.env.BEEHIIV_API_KEY;
delete process.env.SENTRY_AUTH_TOKEN;
delete process.env.APPLE_API_ISSUER;
delete process.env.APPLE_API_KEY_ID;
delete process.env.APPLE_TEAM_ID;

const VAR_SET = 'OMEGA_TEST_PREFLIGHT_SET';
const VAR_MISSING = 'OMEGA_TEST_PREFLIGHT_MISSING';
const SECRET_VALUE = 'super-secret-preflight-value-never-printed';

const EMPTY_STORE = { exists: false, scopes: [], accountEmail: null, storePath: '/nope/.omega/auth/google-tokens.json' };

function withStreams(isTTY, fn) {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = isTTY;
  output.isTTY = isTTY;
  setPromptStreams({ input, output });
  try {
    return fn();
  } finally {
    setPromptStreams(null);
  }
}

/** Capture every console.log line emitted while fn runs. */
function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

/** captureLog for an async run (the manage walk + its printed summary). */
async function captureLogAsync(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

function stageTokenStore(tokens) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-preflight-'));
  if (tokens) {
    const storePath = googleTokenStorePath(root);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(tokens));
  }
  return root;
}

// ─── checkService: when-gates + env + scopes ────────────────────────────────

test('preflight: service when-gate false → no finding (disabled edge)', () => {
  const finding = checkService('edge', REQUIRES.edge, { edge: { providers: { cloudflare: { enabled: false } } } }, EMPTY_STORE);
  assert.equal(finding, null);
});

// #527 — the advertising gate is the client id alone: the `enabled` key it
// used to read beside it is deleted, so a config still carrying it must not
// silence the preflight ask for the account the service still manages.
test('preflight: the advertising when-gate is client presence, not a second switch (#527)', () => {
  const withClient = { advertising: { providers: { adsense: { client: 'ca-pub-1', enabled: false } } } };
  const finding = checkService('advertising', REQUIRES.advertising, withClient, EMPTY_STORE);
  assert.ok(finding, 'a configured client id asks for its credentials');
  assert.deepEqual(finding.missingEnv.map((entry) => entry.name), ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);

  const noClient = { advertising: { providers: { adsense: {} } } };
  assert.equal(checkService('advertising', REQUIRES.advertising, noClient, EMPTY_STORE), null, 'no client id, nothing to ask for');
});

test('preflight: missing env → finding naming the exact vars', () => {
  const finding = checkService('edge', REQUIRES.edge, {}, EMPTY_STORE);
  assert.ok(finding);
  assert.deepEqual(finding.missingEnv.map((entry) => entry.name), ['CLOUDFLARE_TOKEN']);
  assert.equal(finding.missingScopes.length, 0);
  assert.equal(finding.noConsent, false);
});

test('preflight: env present → no finding', () => {
  process.env.CLOUDFLARE_TOKEN = SECRET_VALUE;
  try {
    assert.equal(checkService('edge', REQUIRES.edge, {}, EMPTY_STORE), null);
  } finally {
    delete process.env.CLOUDFLARE_TOKEN;
  }
});

test('preflight: entry-level when — namecheap creds only for namecheap brands', () => {
  const squarespace = checkService('domain', REQUIRES.domain, { domain: { providers: { squarespace: {} } } }, EMPTY_STORE);
  assert.deepEqual(squarespace.missingEnv.map((entry) => entry.name), ['CLOUDFLARE_TOKEN']);

  const namecheap = checkService('domain', REQUIRES.domain, { domain: { providers: { namecheap: {} } } }, EMPTY_STORE);
  assert.deepEqual(namecheap.missingEnv.map((entry) => entry.name), ['CLOUDFLARE_TOKEN', 'NAMECHEAP_USERNAME', 'NAMECHEAP_API_KEY']);

  // No provider chosen → the service skips itself; preflight stays quiet
  assert.equal(checkService('domain', REQUIRES.domain, {}, EMPTY_STORE), null);
});

test('preflight: scopes — no token store → noConsent', () => {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = SECRET_VALUE;
  try {
    const finding = checkService('search', REQUIRES.search, {}, EMPTY_STORE);
    assert.ok(finding);
    assert.equal(finding.noConsent, true);
    assert.equal(finding.missingEnv.length, 0);
  } finally {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  }
});

test('preflight: scopes — store missing a required scope → missingScopes; sufficient → clean', () => {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = SECRET_VALUE;
  try {
    const partial = {
      exists: true,
      scopes: ['https://www.googleapis.com/auth/webmasters'],
      accountEmail: 'ops@example.test',
      storePath: '/x/google-tokens.json',
    };
    const finding = checkService('search', REQUIRES.search, {}, partial);
    assert.deepEqual(finding.missingScopes, ['https://www.googleapis.com/auth/siteverification']);

    const full = { ...partial, scopes: [...partial.scopes, 'https://www.googleapis.com/auth/siteverification'] };
    assert.equal(checkService('search', REQUIRES.search, {}, full), null);
  } finally {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  }
});

test('preflight: readTokenStore — real store round-trip + pre-tracking store grants nothing', () => {
  const root = stageTokenStore({ access_token: 'tok', scopes: ['a', 'b'], account_email: 'me@example.test' });
  const store = readTokenStore(root);
  assert.equal(store.exists, true);
  assert.deepEqual(store.scopes, ['a', 'b']);
  assert.equal(store.accountEmail, 'me@example.test');

  const legacyRoot = stageTokenStore({ access_token: 'tok' }); // no scopes array
  assert.deepEqual(readTokenStore(legacyRoot).scopes, []);

  assert.equal(readTokenStore(stageTokenStore(null)).exists, false);
});

// ─── runPreflight: verdicts ─────────────────────────────────────────────────

const PROMPTED_REQUIRES = {
  fake: {
    why: 'talks to the fake API',
    env: [{ name: VAR_MISSING, label: 'Fake API key', url: 'https://example.test/keys', prompted: true }],
    scopes: [],
  },
};

const UNPROMPTED_REQUIRES = {
  fake: {
    why: 'talks to the fake API',
    env: [{ name: VAR_MISSING, label: 'Fake API key' }],
    scopes: [],
  },
};

test('preflight verdicts: non-interactive missing env → skip with missingEnv', () => {
  const root = stageTokenStore(null);
  const { gates } = withStreams(false, () => {
    let result;
    const log = captureLog(() => {
      result = runPreflight({ services: ['fake'], brandConfig: {}, brandRoot: root, options: {} }, { requires: PROMPTED_REQUIRES });
    });
    assert.match(log, /Preflight/);
    return result;
  });

  assert.equal(gates.fake.action, 'skip');
  assert.match(gates.fake.reason, new RegExp(VAR_MISSING));
  assert.match(gates.fake.reason, /^preflight: /);
  assert.deepEqual(gates.fake.missingEnv, [VAR_MISSING]);
});

test('preflight verdicts: interactive + prompted entries → run (the paste flow fixes it mid-run)', () => {
  const root = stageTokenStore(null);
  const { gates } = withStreams(true, () => {
    let result;
    captureLog(() => {
      result = runPreflight({ services: ['fake'], brandConfig: {}, brandRoot: root, options: {} }, { requires: PROMPTED_REQUIRES });
    });
    return result;
  });
  assert.equal(gates.fake.action, 'run');
});

test('preflight verdicts: interactive but unprompted entry → still skip (no flow collects it)', () => {
  const root = stageTokenStore(null);
  const { gates } = withStreams(true, () => {
    let result;
    captureLog(() => {
      result = runPreflight({ services: ['fake'], brandConfig: {}, brandRoot: root, options: {} }, { requires: UNPROMPTED_REQUIRES });
    });
    return result;
  });
  assert.equal(gates.fake.action, 'skip');
});

test('preflight verdicts: --strict → error, even interactive', () => {
  const root = stageTokenStore(null);
  const { gates } = withStreams(true, () => {
    let result;
    captureLog(() => {
      result = runPreflight({ services: ['fake'], brandConfig: {}, brandRoot: root, options: { strict: true } }, { requires: PROMPTED_REQUIRES });
    });
    return result;
  });
  assert.equal(gates.fake.action, 'error');
});

test('preflight verdicts: a consent/scope gap carries the ⚑ pending marker; a missing-secret gap does not (#228)', () => {
  const requires = {
    consenty: { why: 'needs Google', env: [], scopes: ['https://www.googleapis.com/auth/webmasters'] },
    envy: { why: 'needs a key', env: [{ name: VAR_MISSING, prompted: true }], scopes: [] },
  };

  const noStore = stageTokenStore(null);
  const { gates } = withStreams(false, () => {
    let result;
    captureLog(() => {
      result = runPreflight({ services: ['consenty', 'envy'], brandConfig: {}, brandRoot: noStore, options: {} }, { requires });
    });
    return result;
  });

  assert.match(gates.consenty.needsInteractive, /Google consent/,
    'the summary ⚑ section reads this field — without it the skip is a nameless count');
  assert.equal(gates.envy.needsInteractive, undefined,
    'a missing secret already rides the 🔑 section; double-listing is noise');

  // A store that exists but lacks the scope is the same pending human step
  const narrowStore = stageTokenStore({
    access_token: 'a',
    refresh_token: 'r',
    scopes: ['https://www.googleapis.com/auth/firebase'],
  });
  const narrow = withStreams(false, () => {
    let result;
    captureLog(() => {
      result = runPreflight({ services: ['consenty'], brandConfig: {}, brandRoot: narrowStore, options: {} }, { requires });
    });
    return result;
  });

  assert.match(narrow.gates.consenty.needsInteractive, /webmasters/, 'and it names the scopes to re-consent');
});

test('preflight verdicts: nothing missing → no gates, nothing printed', () => {
  process.env[VAR_SET] = SECRET_VALUE;
  try {
    const root = stageTokenStore(null);
    const requires = { fake: { env: [{ name: VAR_SET, prompted: true }], scopes: [] } };
    const log = captureLog(() => {
      const { findings, gates } = withStreams(false, () => runPreflight({ services: ['fake'], brandConfig: {}, brandRoot: root, options: {} }, { requires }));
      assert.equal(findings.length, 0);
      assert.deepEqual(gates, {});
    });
    assert.equal(log, '');
  } finally {
    delete process.env[VAR_SET];
  }
});

// ─── Walkthrough content (cp236 tone) ───────────────────────────────────────

test('preflight walkthrough: what/which/why/fix/rerun — and env VALUES never appear', () => {
  process.env[VAR_SET] = SECRET_VALUE;
  try {
    const root = stageTokenStore(null);
    const requires = {
      fake: {
        why: 'talks to the fake API',
        env: [
          { name: VAR_SET, prompted: true },
          { name: VAR_MISSING, label: 'Fake API key', url: 'https://example.test/keys', hint: 'Create a read-write key', prompted: true },
        ],
        scopes: [],
      },
    };

    const log = captureLog(() => {
      withStreams(false, () => runPreflight({ services: ['fake'], brandConfig: {}, brandRoot: root, options: {} }, { requires }));
    });

    assert.match(log, /Preflight/);                        // the consolidated header
    assert.match(log, /fake/);                             // which service
    assert.match(log, /talks to the fake API/);            // why it matters
    assert.match(log, new RegExp(`${VAR_MISSING}=<value>`)); // the exact .env line
    assert.match(log, /https:\/\/example\.test\/keys/);    // where the value comes from
    assert.match(log, /Create a read-write key/);          // the hint
    assert.match(log, new RegExp(`npm run manage -- --service=fake`)); // the rerun verb
    assert.ok(!log.includes(VAR_SET));                     // present vars aren't nagged
    assert.ok(!log.includes(SECRET_VALUE));                // values NEVER print
  } finally {
    delete process.env[VAR_SET];
  }
});

test('preflight walkthrough: scope gap names the acting identity + both remedies (cp236 model)', () => {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = SECRET_VALUE;
  try {
    const root = stageTokenStore({ access_token: 'tok', scopes: ['https://www.googleapis.com/auth/webmasters'], account_email: 'ops@example.test' });

    const log = captureLog(() => {
      withStreams(false, () => runPreflight({ services: ['search'], brandConfig: {}, brandRoot: root, options: {} }));
    });

    assert.match(log, /search/);
    assert.match(log, /scope:siteverification/);           // what's missing, short form
    assert.match(log, /ops@example\.test/);                // acting identity (cp236)
    assert.match(log, /google-tokens\.json/);              // the token store path
    assert.match(log, /re-consent/);                       // remedy 1
    assert.match(log, /delete the token store/);           // remedy 2 (cp236 alternative)
    assert.ok(!log.includes(SECRET_VALUE));
  } finally {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  }
});

// ─── Registry sanity ────────────────────────────────────────────────────────

test('preflight registry: every REQUIRES key is a real service, env entries are name-shaped', () => {
  for (const [serviceName, declaration] of Object.entries(REQUIRES)) {
    assert.ok(SERVICE_ORDER.includes(serviceName), `${serviceName} is not in SERVICE_ORDER`);
    for (const entry of declaration.env || []) {
      assert.match(entry.name, /^[A-Z][A-Z0-9_]+$/, `${serviceName} env entry ${entry.name}`);
    }
    for (const scope of declaration.scopes || []) {
      assert.match(scope, /^https:\/\/www\.googleapis\.com\/auth\//, `${serviceName} scope ${scope}`);
    }
  }
});

// ─── runManage wiring ───────────────────────────────────────────────────────

function stageBrand() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-preflight-brand-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'preflight-brand',
    private: true,
    workspaces: ['targets/*'],
  }, null, 2));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: {
    id: 'preflight-brand',
    name: 'Preflight Brand',
    url: 'https://preflight-brand.test',
  },
  targets: {
    web: {},
  },
}`);
  // A no-dep website target whose build writes dist/index.html — the update
  // service must pass so the loop provably continues PAST preflight skips
  fs.mkdirSync(path.join(root, 'targets', 'website'), { recursive: true });
  fs.writeFileSync(path.join(root, 'targets', 'website', 'package.json'), JSON.stringify({
    name: 'preflight-website',
    private: true,
    scripts: { build: 'node build.js' },
  }, null, 2));
  fs.writeFileSync(path.join(root, 'targets', 'website', 'build.js'), `const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), '<!doctype html><title>preflight</title>');
`);
  return root;
}

test('runManage: preflight-failing service skips with the walkthrough reason and missingEnv', async () => {
  const root = stageBrand();
  const report = await withStreams(false, () => runManage(root, { service: 'edge' }));

  assert.equal(report.hasErrors, false);
  assert.equal(report.results.edge.status, 'skipped');
  assert.match(report.results.edge.reason, /^preflight: /);
  assert.match(report.results.edge.reason, /CLOUDFLARE_TOKEN/);
  assert.deepEqual(report.results.edge.missingEnv, ['CLOUDFLARE_TOKEN']);
});

test('runManage: --strict turns the preflight failure into a hard error', async () => {
  const root = stageBrand();
  const report = await withStreams(false, () => runManage(root, { service: 'edge', strict: true }));

  assert.equal(report.hasErrors, true);
  assert.equal(report.results.edge.status, 'error');
  assert.match(report.results.edge.error, /^preflight: /);
  assert.match(report.results.edge.error, /CLOUDFLARE_TOKEN/);
});

test('runManage: a consent-gated preflight skip is NAMED in the ⚑ pending list, with its rerun hint (#228)', async () => {
  const root = stageBrand();

  const log = await captureLogAsync(() => withStreams(false, () => runManage(root, { service: 'search' })));

  assert.match(log, /⚑ Skipped — needs an interactive run/,
    'a consent gap belongs in the pending aggregate, not only in the walkthrough scroll-back');
  assert.match(log, /search\/preflight/, 'the ⚑ line names the service');
  assert.match(log, /npm run manage -- --service=search/);
});

test('runManage: the cycle continues past preflight skips (absorb, never crash)', async () => {
  const root = stageBrand();
  const report = await withStreams(false, () => runManage(root, {}));

  // edge (and friends) skipped by preflight…
  assert.equal(report.results.edge.status, 'skipped');
  assert.match(report.results.edge.reason, /^preflight: /);
  // …while later services still ran — the loop never stopped
  assert.ok(report.results.testing, 'testing service should still have run');
  assert.ok(report.results.workspace, 'workspace service should still have run');
});

// ─── The lockstep boot check (#794) ─────────────────────────────────────────

const MANAGER_VERSION = require('../package.json').version;

/**
 * Stage a brand with installed @omega.js packages: `installs` maps a target
 * dir to { framework, version, client?, clientAt? } — clientAt 'nested' puts
 * the client under the framework's own node_modules (where npm nests a
 * second copy), 'root' hoists it to the brand root (where npm normally
 * lands it in a workspace tree).
 */
function stageInstalledBrand(installs, { spec = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lockstep-'));
  const targets = [];

  const writePkg = (dir, contents) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(contents, null, 2));
  };

  for (const [dir, install] of Object.entries(installs)) {
    const targetPath = path.join(root, 'targets', dir);
    const framework = `@omega.js/${install.framework}`;
    writePkg(targetPath, {
      name: `lockstep-${dir}`,
      private: true,
      devDependencies: { [framework]: spec || install.spec || MANAGER_VERSION },
    });
    targets.push({ name: dir, dir: `targets/${dir}`, path: targetPath, target: install.target });

    if (install.version) {
      writePkg(path.join(targetPath, 'node_modules', framework), { name: framework, version: install.version });
    }
    if (install.client) {
      const clientHome = install.clientAt === 'nested'
        ? path.join(targetPath, 'node_modules', framework, 'node_modules', '@omega.js', 'client')
        : path.join(root, 'node_modules', '@omega.js', 'client');
      writePkg(clientHome, { name: '@omega.js/client', version: install.client });
    }
  }

  return { root, targets };
}

test('lockstep boot check: every installed package on the family version passes', () => {
  const { root, targets } = stageInstalledBrand({
    website: { target: 'web', framework: 'web', version: MANAGER_VERSION, client: MANAGER_VERSION },
    backend: { target: 'backend', framework: 'backend', version: MANAGER_VERSION, client: MANAGER_VERSION, clientAt: 'nested' },
  });

  const report = assertFamilyVersions({ brandRoot: root, targets });

  assert.deepEqual(report.mismatched, []);
  assert.deepEqual(report.checked.map((entry) => entry.dir).sort(), ['backend', 'website']);
  // The client is found wherever npm put it — hoisted at the root, or nested
  assert.deepEqual(report.checked.map((entry) => entry.dir + ':' + entry.packages.length).sort(), ['backend:2', 'website:2']);
});

test('lockstep boot check: one target behind REFUSES, naming the target, both versions and the fix', () => {
  const { root, targets } = stageInstalledBrand({
    website: { target: 'web', framework: 'web', version: MANAGER_VERSION },
    backend: { target: 'backend', framework: 'backend', version: '0.0.9', client: '0.0.9', clientAt: 'nested' },
  });

  assert.throws(
    () => assertFamilyVersions({ brandRoot: root, targets }),
    (error) => {
      assert.match(error.message, /backend/, 'names the drifted target');
      assert.match(error.message, /@omega\.js\/backend 0\.0\.9/, 'names the installed version');
      assert.match(error.message, /@omega\.js\/client 0\.0\.9/, 'names every drifted package under that target');
      assert.match(error.message, new RegExp(MANAGER_VERSION.replace(/\./g, '\\.')), 'names the manager\'s version');
      assert.equal(error.refusal, true, 'a refusal prints its message alone — no stack (#706)');
      assert.match(error.message, /omega update --apply/, 'names the verb that actually installs, not the report-only form');
      assert.ok(!error.message.includes('website'), 'a target that matches is not listed');
      return true;
    },
  );
});

test('lockstep boot check: a `file:` spec is exempt — the local era is the monorepo\'s version by construction', () => {
  const { root, targets } = stageInstalledBrand({
    website: { target: 'web', framework: 'web', version: '9.9.9', client: '9.9.9', clientAt: 'nested' },
  }, { spec: 'file:../../../omega/packages/web' });

  const report = assertFamilyVersions({ brandRoot: root, targets });

  assert.deepEqual(report.mismatched, []);
  assert.deepEqual(report.exempt.map((entry) => entry.dir), ['website']);
});

test('lockstep boot check: a target with no install yet is skipped, not a mismatch', () => {
  const { root, targets } = stageInstalledBrand({
    website: { target: 'web', framework: 'web' },
  });

  const log = captureLog(() => {
    const report = assertFamilyVersions({ brandRoot: root, targets });
    assert.deepEqual(report.mismatched, []);
    assert.deepEqual(report.skipped.map((entry) => entry.dir), ['website']);
  });

  assert.match(log, /website/, 'the skip is a line, never silence');
  assert.match(log, /@omega\.js\/web/);
});

test('lockstep boot check: a custom target has no framework to compare', () => {
  const { root } = stageInstalledBrand({});
  const targets = [{ name: 'worker', dir: 'targets/worker', path: path.join(root, 'targets', 'worker'), target: null, custom: true }];

  const report = assertFamilyVersions({ brandRoot: root, targets });

  assert.deepEqual(report.checked, []);
  assert.deepEqual(report.skipped, []);
});

test('lockstep boot check: an installed manifest that cannot be read is a REFUSAL naming the file (#794)', () => {
  for (const [label, contents] of [['unparseable', '{ not json'], ['versionless', JSON.stringify({ name: '@omega.js/web' })]]) {
    const { root, targets } = stageInstalledBrand({
      website: { target: 'web', framework: 'web', version: MANAGER_VERSION },
    });
    const manifest = path.join(root, 'targets', 'website', 'node_modules', '@omega.js', 'web', 'package.json');
    fs.writeFileSync(manifest, contents);

    assert.throws(
      () => assertFamilyVersions({ brandRoot: root, targets }),
      (error) => {
        assert.equal(error.refusal, true);
        assert.match(error.message, /cannot be read/);
        assert.ok(error.message.includes(manifest), `${label}: the refusal names the file`);
        assert.match(error.message, /npm install/, 'the fix is a reinstall');
        return true;
      },
      `a ${label} manifest must never pass as "no version, no problem"`,
    );
  }
});

test('lockstep boot check: the framework hoisted at the BRAND ROOT is found by the climb', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lockstep-hoist-'));
  const targetPath = path.join(root, 'targets', 'website');
  fs.mkdirSync(targetPath, { recursive: true });
  fs.writeFileSync(path.join(targetPath, 'package.json'), JSON.stringify({
    name: 'hoisted-website', devDependencies: { '@omega.js/web': MANAGER_VERSION },
  }));
  // npm's normal placement in a workspace tree: nothing under the target
  const hoisted = path.join(root, 'node_modules', '@omega.js', 'web');
  fs.mkdirSync(hoisted, { recursive: true });
  fs.writeFileSync(path.join(hoisted, 'package.json'), JSON.stringify({ name: '@omega.js/web', version: '0.0.7' }));

  const targets = [{ name: 'website', dir: 'targets/website', path: targetPath, target: 'web' }];

  assert.throws(
    () => assertFamilyVersions({ brandRoot: root, targets }),
    (error) => {
      assert.match(error.message, /@omega\.js\/web 0\.0\.7/, 'the hoisted copy IS the installed copy');
      return true;
    },
  );
});

test('lockstep boot check: a target-local copy WINS over the hoisted one — nearest, climbing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-lockstep-nearest-'));
  const targetPath = path.join(root, 'targets', 'website');
  fs.mkdirSync(targetPath, { recursive: true });
  fs.writeFileSync(path.join(targetPath, 'package.json'), JSON.stringify({
    name: 'nearest-website', devDependencies: { '@omega.js/web': MANAGER_VERSION },
  }));

  const hoisted = path.join(root, 'node_modules', '@omega.js', 'web');
  fs.mkdirSync(hoisted, { recursive: true });
  fs.writeFileSync(path.join(hoisted, 'package.json'), JSON.stringify({ name: '@omega.js/web', version: '0.0.7' }));

  // The nested copy npm writes when the ranges stop overlapping — what this
  // target actually loads, so it is what the gate must judge
  const local = path.join(targetPath, 'node_modules', '@omega.js', 'web');
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(local, 'package.json'), JSON.stringify({ name: '@omega.js/web', version: MANAGER_VERSION }));

  const targets = [{ name: 'website', dir: 'targets/website', path: targetPath, target: 'web' }];
  const report = assertFamilyVersions({ brandRoot: root, targets });

  assert.deepEqual(report.mismatched, [], 'the target-local copy matches, so the stale hoisted one is not what runs here');
  assert.deepEqual(report.checked[0].packages, [{ name: '@omega.js/web', version: MANAGER_VERSION }]);
});
