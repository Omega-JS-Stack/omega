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
const { runPreflight, checkService, readTokenStore } = require('../src/lib/preflight.js');
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

test('preflight: service when-gate false → no finding (disabled cloudflare)', () => {
  const finding = checkService('cloudflare', REQUIRES.cloudflare, { edge: { providers: { cloudflare: { enabled: false } } } }, EMPTY_STORE);
  assert.equal(finding, null);
});

test('preflight: missing env → finding naming the exact vars', () => {
  const finding = checkService('cloudflare', REQUIRES.cloudflare, {}, EMPTY_STORE);
  assert.ok(finding);
  assert.deepEqual(finding.missingEnv.map((entry) => entry.name), ['CLOUDFLARE_TOKEN']);
  assert.equal(finding.missingScopes.length, 0);
  assert.equal(finding.noConsent, false);
});

test('preflight: env present → no finding', () => {
  process.env.CLOUDFLARE_TOKEN = SECRET_VALUE;
  try {
    assert.equal(checkService('cloudflare', REQUIRES.cloudflare, {}, EMPTY_STORE), null);
  } finally {
    delete process.env.CLOUDFLARE_TOKEN;
  }
});

test('preflight: entry-level when — namecheap creds only for namecheap brands', () => {
  const squarespace = checkService('domain', REQUIRES.domain, { domain: { provider: 'squarespace' } }, EMPTY_STORE);
  assert.deepEqual(squarespace.missingEnv.map((entry) => entry.name), ['CLOUDFLARE_TOKEN']);

  const namecheap = checkService('domain', REQUIRES.domain, { domain: { provider: 'namecheap' } }, EMPTY_STORE);
  assert.deepEqual(namecheap.missingEnv.map((entry) => entry.name), ['CLOUDFLARE_TOKEN', 'NAMECHEAP_USERNAME', 'NAMECHEAP_API_KEY']);

  // No provider chosen → the service skips itself; preflight stays quiet
  assert.equal(checkService('domain', REQUIRES.domain, {}, EMPTY_STORE), null);
});

test('preflight: scopes — no token store → noConsent', () => {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = SECRET_VALUE;
  try {
    const finding = checkService('search-console', REQUIRES['search-console'], {}, EMPTY_STORE);
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
    const finding = checkService('search-console', REQUIRES['search-console'], {}, partial);
    assert.deepEqual(finding.missingScopes, ['https://www.googleapis.com/auth/siteverification']);

    const full = { ...partial, scopes: [...partial.scopes, 'https://www.googleapis.com/auth/siteverification'] };
    assert.equal(checkService('search-console', REQUIRES['search-console'], {}, full), null);
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
      withStreams(false, () => runPreflight({ services: ['search-console'], brandConfig: {}, brandRoot: root, options: {} }));
    });

    assert.match(log, /search-console/);
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
    workspaces: ['apps/*'],
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
  // A no-dep website app whose build writes dist/index.html — the update
  // service must pass so the loop provably continues PAST preflight skips
  fs.mkdirSync(path.join(root, 'apps', 'website'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'website', 'package.json'), JSON.stringify({
    name: 'preflight-website',
    private: true,
    scripts: { build: 'node build.js' },
  }, null, 2));
  fs.writeFileSync(path.join(root, 'apps', 'website', 'build.js'), `const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), '<!doctype html><title>preflight</title>');
`);
  return root;
}

test('runManage: preflight-failing service skips with the walkthrough reason and missingEnv', async () => {
  const root = stageBrand();
  const report = await withStreams(false, () => runManage(root, { service: 'cloudflare' }));

  assert.equal(report.hasErrors, false);
  assert.equal(report.results.cloudflare.status, 'skipped');
  assert.match(report.results.cloudflare.reason, /^preflight: /);
  assert.match(report.results.cloudflare.reason, /CLOUDFLARE_TOKEN/);
  assert.deepEqual(report.results.cloudflare.missingEnv, ['CLOUDFLARE_TOKEN']);
});

test('runManage: --strict turns the preflight failure into a hard error', async () => {
  const root = stageBrand();
  const report = await withStreams(false, () => runManage(root, { service: 'cloudflare', strict: true }));

  assert.equal(report.hasErrors, true);
  assert.equal(report.results.cloudflare.status, 'error');
  assert.match(report.results.cloudflare.error, /^preflight: /);
  assert.match(report.results.cloudflare.error, /CLOUDFLARE_TOKEN/);
});

test('runManage: a consent-gated preflight skip is NAMED in the ⚑ pending list, with its rerun hint (#228)', async () => {
  const root = stageBrand();

  const log = await captureLogAsync(() => withStreams(false, () => runManage(root, { service: 'search-console' })));

  assert.match(log, /⚑ Skipped — needs an interactive run/,
    'a consent gap belongs in the pending aggregate, not only in the walkthrough scroll-back');
  assert.match(log, /search-console\/preflight/, 'the ⚑ line names the service');
  assert.match(log, /npm run manage -- --service=search-console/);
});

test('runManage: the cycle continues past preflight skips (absorb, never crash)', async () => {
  const root = stageBrand();
  const report = await withStreams(false, () => runManage(root, {}));

  // cloudflare (and friends) skipped by preflight…
  assert.equal(report.results.cloudflare.status, 'skipped');
  assert.match(report.results.cloudflare.reason, /^preflight: /);
  // …while later services still ran — the loop never stopped
  assert.ok(report.results.testing, 'testing service should still have run');
  assert.ok(report.results.workspace, 'workspace service should still have run');
});
