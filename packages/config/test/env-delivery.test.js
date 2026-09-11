/**
 * Unit tests for @omega.js/config's delivery renderer — the ONE place that
 * says HOW a declared env key reaches its consumer (#627).
 *
 * Three deliveries: 'env' (the composed .env the backend artifact ships with),
 * 'ci' (the generated workflow injects it into the runner env for the build
 * step) and 'bake' (the build writes it into the shipped artifact — and the
 * workflow injects it too, so bake IMPLIES ci). Every list here derives from
 * the schema alone: no framework keeps a hand-written secrets list.
 *
 * The fixture schema pins the renderer's RULES; the real-schema block pins the
 * inventory those rules produce per target.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  workflowSecretKeys, renderSecretsBlock, bakeKeys, publishSecretKeys,
  envFileKeys, renderEnvFileKeys, artifactEnvValues,
  WORKFLOW_OWNED_KEYS, DELIVERY_MODES,
} = require('../src/index.js');

// A miniature schema: one entry per rule the renderer applies.
const FIXTURE = [
  { name: 'BACKEND_ONLY',    owner: 't', targets: ['backend'],          group: 'backend-services', secret: true,  required: false, delivery: { backend: 'env' },              description: 'Read from the composed dist/.env.' },
  { name: 'BACKEND_RUNNER',  owner: 't', targets: ['backend'],          group: 'license',          secret: true,  required: false, delivery: { backend: 'ci' },               description: 'The deploy process reads it on the runner; the artifact never does.' },
  { name: 'GH_TOKEN',        owner: 't', targets: ['web'],              group: 'github',           secret: true,  required: false, delivery: { web: 'ci' },                   description: 'The workflow template declares this one itself.' },
  { name: 'WEB_CI',          owner: 't', targets: ['web'],              group: 'captcha',          secret: false, required: false, delivery: { web: 'ci' },                   description: 'Injected into the web build step.' },
  { name: 'MACHINE_PATH',    owner: 't', targets: ['web'],              group: 'fontawesome',      secret: false, required: false, delivery: { web: 'ci' }, machineLocal: true, description: 'A developer-machine path — never published.' },
  { name: 'STREAM_SECRET_WEB', owner: 't', targets: ['web'],            group: 'machine',          secret: true,  required: false, delivery: { web: 'ci' }, deliverAs: 'STREAM_SECRET', description: 'Delivered under its runtime name.' },
  { name: 'BAKED',           owner: 't', targets: ['extension'],        group: 'machine',          secret: true,  required: false, delivery: { extension: 'bake' }, publicAtRest: true, description: 'Written into the shipped artifact.' },
  { match: /^DYNAMIC_.+$/,   owner: 't', targets: ['backend'],          group: 'backend-services', secret: true,  required: false, delivery: { backend: 'env' },              description: 'A pattern family — no fixed name to render.' },
];

// The same bake, undeclared: a real credential one edit away from the artifact.
const UNSAFE_BAKE = [
  { name: 'API_SECRET', owner: 't', targets: ['extension'], group: 'machine', secret: true, required: false, delivery: { extension: 'bake' }, description: 'A credential nobody declared public-at-rest.' },
];

test('DELIVERY_MODES: the three ways a key travels', () => {
  assert.deepEqual(DELIVERY_MODES, ['env', 'ci', 'bake']);
});

test('workflowSecretKeys(): ci and bake, sorted, machine-local dropped', () => {
  // BACKEND_ONLY is 'env' (it never reaches a runner); MACHINE_PATH is a
  // developer-machine value (#454); STREAM_SECRET_WEB rides its deliverAs name
  assert.deepEqual(workflowSecretKeys('web', { schema: FIXTURE }), [
    'GH_TOKEN',
    'STREAM_SECRET',
    'WEB_CI',
  ]);

  // bake IMPLIES ci — the workflow injects what the build bakes
  assert.deepEqual(workflowSecretKeys('extension', { schema: FIXTURE }), ['BAKED']);

  // A target no entry names gets nothing
  assert.deepEqual(workflowSecretKeys('desktop', { schema: FIXTURE }), []);
});

test('renderSecretsBlock(): sorted `KEY: ${{ secrets.KEY }}` lines at the token indent', () => {
  const block = renderSecretsBlock('web', { schema: FIXTURE });

  assert.equal(block, [
    'STREAM_SECRET: ${{ secrets.STREAM_SECRET }}',
    'WEB_CI: ${{ secrets.WEB_CI }}',
  ].join('\n  '));

  // The template's own env: block already declares these — a repeated YAML
  // mapping key is invalid, so the generated block never restates them
  assert.ok(!block.includes('GH_TOKEN'), 'a workflow-owned key never renders');
  assert.deepEqual(WORKFLOW_OWNED_KEYS, ['GH_TOKEN', 'CLOUDFLARE_TOKEN', 'NODE_VERSION', 'NODE_ENV']);
});

test('renderSecretsBlock(): the indent is the caller\'s, and an empty block is still valid YAML', () => {
  const indented = renderSecretsBlock('web', { schema: FIXTURE, indent: '      ' });
  assert.equal(indented, [
    'STREAM_SECRET: ${{ secrets.STREAM_SECRET }}',
    'WEB_CI: ${{ secrets.WEB_CI }}',
  ].join('\n      '));

  const empty = renderSecretsBlock('desktop', { schema: FIXTURE });
  assert.match(empty, /^# /, 'nothing to inject renders one self-explaining comment line');
});

test('bakeKeys(): only what the build writes into the artifact', () => {
  assert.deepEqual(bakeKeys('extension', { schema: FIXTURE }), ['BAKED']);
  assert.deepEqual(bakeKeys('web', { schema: FIXTURE }), [], 'a ci key is not a bake');
});

test('a secret bake without publicAtRest THROWS — a credential never reaches an artifact', () => {
  const message = /API_SECRET.*publicAtRest/s;

  assert.throws(() => bakeKeys('extension', { schema: UNSAFE_BAKE }), message);
  // bake implies ci, so the workflow lanes walk the same entry and refuse too
  assert.throws(() => workflowSecretKeys('extension', { schema: UNSAFE_BAKE }), message);
  assert.throws(() => renderSecretsBlock('extension', { schema: UNSAFE_BAKE }), message);
  assert.throws(() => publishSecretKeys('extension', { schema: UNSAFE_BAKE }), message);

  // Another target's lists never walk it — the refusal is per target
  assert.deepEqual(workflowSecretKeys('web', { schema: UNSAFE_BAKE }), []);
});

test('publishSecretKeys(): what push-secrets sends — the workflow set, workflow-owned keys included', () => {
  const published = publishSecretKeys('web', { schema: FIXTURE });

  assert.deepEqual(published, workflowSecretKeys('web', { schema: FIXTURE }));
  assert.ok(published.includes('GH_TOKEN'), 'the repo secret must EXIST even though the block never restates it');
  assert.ok(!published.includes('MACHINE_PATH'), 'a machine-local value never leaves the machine (#454)');
});

// ─── The real inventory (#627) ───

test('web: the build-step keys, and nothing the backend alone reads', () => {
  assert.deepEqual(workflowSecretKeys('web'), [
    'CLOUDFLARE_TOKEN',
    'GH_TOKEN',
    'GOOGLE_ANALYTICS_SECRET',
    'OMEGA_LICENSE_KEY',
    'OMEGA_TEST_FIREBASE_ADMIN_KEY',
    'OMEGA_TEST_USER_UID',
    'OPENAI_API_KEY',
    'RECAPTCHA_SITE_KEY',
  ]);

  const block = renderSecretsBlock('web');
  assert.ok(block.includes('RECAPTCHA_SITE_KEY: ${{ secrets.RECAPTCHA_SITE_KEY }}'));
  // The brand's GOOGLE_ANALYTICS_SECRET_WEB reaches CI under its delivered name
  assert.ok(block.includes('GOOGLE_ANALYTICS_SECRET: ${{ secrets.GOOGLE_ANALYTICS_SECRET }}'));
  assert.ok(!block.includes('GOOGLE_ANALYTICS_SECRET_WEB'), 'the brand-level name never reaches a runner');
  assert.ok(!block.includes('GH_TOKEN'), 'the template declares it itself');
  for (const backendOnly of ['STRIPE_SECRET_KEY', 'PAYPAL_CLIENT_SECRET', 'SENDGRID_API_KEY']) {
    assert.ok(!block.includes(backendOnly), `${backendOnly} is a backend runtime key — a static site build never sees it`);
  }
  assert.ok(!block.includes('OMEGA_FONTAWESOME_ROOT'), 'the machine-local Pro path never publishes (#454)');

  assert.deepEqual(bakeKeys('web'), [], 'the web build bakes nothing — the client blob reads the runner env');
});

test('a workflow-owned key is PUBLISHED and never re-rendered — the #715 duplicate mapping (#728)', () => {
  // CLOUDFLARE_TOKEN is both halves at once: the publish lane pushes the repo
  // secret so the purge step's `if: env.CLOUDFLARE_TOKEN != ''` can be true,
  // and the template's own env: block already declares it. A generated line
  // for it would repeat a YAML mapping key and GitHub would refuse the file.
  assert.ok(publishSecretKeys('web').includes('CLOUDFLARE_TOKEN'), 'the purge gate needs the repo secret to exist');

  const block = renderSecretsBlock('web');
  for (const key of WORKFLOW_OWNED_KEYS) {
    assert.ok(!block.includes(`${key}:`), `${key} is the template's own — a second mapping key invalidates the workflow`);
  }
});

// #872: the backend deploy runs on a RUNNER now, and a runner has no `.env`.
// So the workflow carries every key delivered to backend and WRITES the target
// .env from them, which makes the `env` deliveries part of its set.
test('backend: the runner carries the env deliveries too, because the workflow writes the .env (#872)', () => {
  const keys = workflowSecretKeys('backend', { schema: FIXTURE });

  assert.deepEqual(keys, ['BACKEND_ONLY', 'BACKEND_RUNNER'], 'an `env` key rides the runner so the workflow can write it, beside the runner-only `ci` keys');
  assert.deepEqual(bakeKeys('backend', { schema: FIXTURE }), [], 'nothing bakes into a functions upload');

  // The other three targets are untouched: their artifacts carry no .env, so
  // an `env` delivery there would be a key nothing reads.
  assert.deepEqual(workflowSecretKeys('web', { schema: FIXTURE }), ['GH_TOKEN', 'STREAM_SECRET', 'WEB_CI']);
  assert.deepEqual(workflowSecretKeys('extension', { schema: FIXTURE }), ['BAKED']);
});

test('renderEnvFileKeys(): the KEY LIST the backend workflow writes its .env from, as JSON (#872)', () => {
  // The workflow's writer is a node one-liner that reads these names out of the
  // runner env and writes the file through serializeEnv, the same serializer
  // every other .env writeback rides: the shell never sees a value, so a value
  // carrying a quote, a backslash or a newline cannot corrupt the file.
  assert.equal(renderEnvFileKeys('backend', { schema: FIXTURE }), '["BACKEND_ONLY"]');
  assert.deepEqual(JSON.parse(renderEnvFileKeys('backend', { schema: FIXTURE })), envFileKeys('backend', { schema: FIXTURE }));

  // The key set is the SCHEMA's `env` deliveries. A `ci` key rides the runner
  // env (the deploy credential, the license key the deploy checks with) and is
  // never a line in the .env the artifact ships with.
  assert.deepEqual(envFileKeys('backend', { schema: FIXTURE }), ['BACKEND_ONLY']);
  assert.deepEqual(envFileKeys('web', { schema: FIXTURE }), [], 'no other target ships a .env');

  // A target that delivers nothing still renders valid JSON, so the one-liner
  // parses and writes an empty file rather than dying on a bare token.
  assert.equal(renderEnvFileKeys('desktop', { schema: FIXTURE }), '[]');
});

test('artifactEnvValues(): the composed values minus every runner-only key (#872)', () => {
  // The composer (env.js) resolves a value for everything the schema delivers
  // to a target, because the secrets publisher needs `ci` values to publish.
  // The ARTIFACT's own .env is the narrower set: what the deployed code reads.
  const composed = { BACKEND_ONLY: 'kept', BACKEND_RUNNER: 'runner-only', DYNAMIC_THING: 'pattern-family' };

  assert.deepEqual(artifactEnvValues('backend', composed, { schema: FIXTURE }), {
    BACKEND_ONLY: 'kept',
    DYNAMIC_THING: 'pattern-family',
  });

  assert.deepEqual(composed.BACKEND_RUNNER, 'runner-only', 'it filters, it never mutates the composed map');
  assert.deepEqual(artifactEnvValues('web', composed, { schema: FIXTURE }), composed, 'a target with no `ci` claim on these keys keeps them all');
});

test('backend: the real inventory the workflow injects and writes (#872)', () => {
  const keys = workflowSecretKeys('backend');

  assert.ok(keys.includes('OMEGA_ADMIN_KEY'), 'the runtime keys ride the runner so the .env can be written');
  assert.ok(keys.includes('STRIPE_SECRET_KEY'));
  assert.ok(keys.includes('OMEGA_SERVICE_ACCOUNT_JSON'), 'the deploy credential the runner authenticates with');
  assert.deepEqual(bakeKeys('backend'), []);

  // The .env the workflow writes carries the RUNTIME half only
  const envKeys = envFileKeys('backend');
  assert.ok(envKeys.includes('OMEGA_ADMIN_KEY'));
  assert.ok(!envKeys.includes('OMEGA_SERVICE_ACCOUNT_JSON'), 'the service account is a FILE, not a runtime env line');
  assert.ok(JSON.parse(renderEnvFileKeys('backend')).includes('OMEGA_ADMIN_KEY'));
});

test('desktop: the signing + publishing set the build workflow injects today', () => {
  const keys = workflowSecretKeys('desktop');

  // The static `${{ secrets.* }}` list in packages/desktop's build.yml, plus
  // the GA secret its webpack bake needs (the workflow never injected it)
  assert.deepEqual(keys, [
    'APPLE_API_ISSUER',
    'APPLE_API_KEY',
    'APPLE_API_KEY_ID',
    'APPLE_TEAM_ID',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_TENANT_ID',
    'AZURE_TRUSTED_SIGNING_ENDPOINT',
    'CSC_KEY_PASSWORD',
    'CSC_LINK',
    'DIGICERT_API_KEY',
    'DIGICERT_KEYPAIR_ALIAS',
    'GH_TOKEN',
    'GOOGLE_ANALYTICS_SECRET',
    'OMEGA_LICENSE_KEY',
    'SIGNTOOL_PATH',
    'SNAPCRAFT_STORE_CREDENTIALS',
    'SSLCOM_CREDENTIAL_ID',
    'SSLCOM_PASSWORD',
    'SSLCOM_USERNAME',
    'WIN_CSC_KEY_PASSWORD',
    'WIN_EV_TOKEN_PATH',
  ]);

  assert.deepEqual(bakeKeys('desktop'), ['GOOGLE_ANALYTICS_SECRET'], 'a packaged app ships no .env');
});

test('extension: the three stores plus the baked Measurement Protocol secret', () => {
  assert.deepEqual(workflowSecretKeys('extension'), [
    'CHROME_CLIENT_ID',
    'CHROME_CLIENT_SECRET',
    'CHROME_EXTENSION_ID',
    'CHROME_REFRESH_TOKEN',
    'EDGE_API_KEY',
    'EDGE_CLIENT_ID',
    'EDGE_PRODUCT_ID',
    'FIREFOX_API_KEY',
    'FIREFOX_API_SECRET',
    'FIREFOX_EXTENSION_ID',
    'GOOGLE_ANALYTICS_SECRET',
    'OMEGA_LICENSE_KEY',
  ]);

  assert.deepEqual(bakeKeys('extension'), ['GOOGLE_ANALYTICS_SECRET'], 'build.json carries it into the packaged zip');
});

test('the license key rides the runner env and NEVER an artifact (#320)', () => {
  // The check runs where the build runs, so the three CI-built targets get it
  // injected — but a baked license key is a license key anyone who unpacks the
  // app can copy, so it appears in no bake list anywhere.
  for (const target of ['web', 'backend', 'desktop', 'extension']) {
    assert.ok(!bakeKeys(target).includes('OMEGA_LICENSE_KEY'), `${target} must never bake the license key`);
  }

  // All FOUR now: the backend's deploy runs on a runner too (#872), and the
  // check runs inside `omega deploy --direct` there, so a keyless verdict would
  // be stamped into every CI-deployed backend without this delivery.
  for (const target of ['web', 'backend', 'desktop', 'extension']) {
    assert.ok(workflowSecretKeys(target).includes('OMEGA_LICENSE_KEY'), `${target} deploys on a runner, so the check needs it there`);
    assert.ok(publishSecretKeys(target).includes('OMEGA_LICENSE_KEY'), `${target}'s repo secret must exist for the workflow to read`);
  }

  // `ci`, never `env`: the runner env carries it for the verdict, and neither
  // .env-writing lane of the backend ever sees it, so the key can never land in
  // the .env the functions artifact ships with.
  assert.ok(!envFileKeys('backend').includes('OMEGA_LICENSE_KEY'), 'the workflow writes no line for it');
  assert.deepEqual(
    artifactEnvValues('backend', { OMEGA_LICENSE_KEY: 'omg_live_key', OMEGA_ADMIN_KEY: 'admin' }),
    { OMEGA_ADMIN_KEY: 'admin' },
    'and the stage strips it out of the composed values',
  );
});
