/**
 * Unit pins for the credential scrub: what a scrubbed child env keeps, what
 * it strips, and where it points every stored login (each CLI's config home,
 * and Google's application default credentials) so none is in reach.
 */
const test = require('node:test');
const assert = require('node:assert');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scrubCredentialEnv, CLI_CONFIG_HOMES } = require('../src/test/credential-scrub.js');

const ONBOARD_SEAMS = path.join(__dirname, '..', '..', 'manager', 'test', 'lib', 'onboard-seams.js');
const ADC_FILE = path.join('gcloud', 'application_default_credentials.json');

/** A real, empty throwaway home root. */
function tempHomeRoot() {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'credential-scrub-'));
}

test('scrubCredentialEnv drops credential-shaped vars, keeps operating env, adds the stored-login redirects', () => {
  const homeRoot = path.join(path.sep, 'tmp', 'x');
  const scrubbed = scrubCredentialEnv({
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    NODE_ENV: 'test',
    npm_config_cache: '/tmp/npm',
    OMEGA_MONOREPO: '/repo',
    OMEGA_NON_INTERACTIVE: '1',
    // Every one of these must go: the runtime legs prove themselves credless
    GOOGLE_CLIENT_ID: 'x',
    GOOGLE_CLIENT_SECRET: 'x',
    CLOUDFLARE_TOKEN: 'x',
    GH_TOKEN: 'x',
    GITHUB_TOKEN: 'x',
    SENDGRID_API_KEY: 'x',
    APPLE_API_KEY: 'x',
    STRIPE_SECRET_KEY: 'x',
    OMEGA_ADMIN_KEY: 'x',
    SENTRY_AUTH_TOKEN: 'x',
    DB_PASSWORD: 'x',
  }, homeRoot);

  assert.deepEqual(Object.keys(scrubbed).sort(), [
    'CLOUDSDK_CONFIG', 'GH_CONFIG_DIR', 'GOOGLE_APPLICATION_CREDENTIALS', 'HOME', 'NODE_ENV',
    'OMEGA_MONOREPO', 'OMEGA_NON_INTERACTIVE', 'PATH', 'XDG_CONFIG_HOME', 'npm_config_cache',
  ]);
  assert.equal(scrubbed.PATH, '/usr/bin');
  assert.equal(scrubbed.HOME, '/Users/someone');
});

test('scrubCredentialEnv points every CLI at its throwaway config home', () => {
  const homeRoot = path.join(path.sep, 'tmp', 'x');
  const scrubbed = scrubCredentialEnv({ PATH: '/usr/bin', GH_TOKEN: 'x' }, homeRoot);

  assert.equal(scrubbed.GH_CONFIG_DIR, path.join(homeRoot, 'gh'));
  assert.equal(scrubbed.XDG_CONFIG_HOME, path.join(homeRoot, 'xdg'));
  assert.equal(scrubbed.CLOUDSDK_CONFIG, path.join(homeRoot, 'gcloud'));
  assert.equal('GH_TOKEN' in scrubbed, false);
});

test('scrubCredentialEnv replaces an incoming CLOUDSDK_CONFIG with the throwaway one', () => {
  const homeRoot = path.join(path.sep, 'tmp', 'x');
  const scrubbed = scrubCredentialEnv({ CLOUDSDK_CONFIG: '/Users/someone/.config/gcloud' }, homeRoot);

  assert.equal(scrubbed.CLOUDSDK_CONFIG, path.join(homeRoot, 'gcloud'));
});

test('CLI_CONFIG_HOMES lists gh, firebase-tools and gcloud', () => {
  assert.deepEqual(CLI_CONFIG_HOMES.map((home) => home.cli), ['gh', 'firebase-tools', 'gcloud']);
});

test('a scrub with a home root points GOOGLE_APPLICATION_CREDENTIALS at a throwaway path no file sits at', () => {
  const homeRoot = tempHomeRoot();
  const scrubbed = scrubCredentialEnv({ PATH: '/usr/bin' }, homeRoot);

  assert.equal(scrubbed.GOOGLE_APPLICATION_CREDENTIALS, path.join(homeRoot, ADC_FILE));
  assert.equal(fs.existsSync(scrubbed.GOOGLE_APPLICATION_CREDENTIALS), false);

  fs.rmSync(homeRoot, { recursive: true, force: true });
});

test('scrubCredentialEnv replaces an incoming GOOGLE_APPLICATION_CREDENTIALS with the throwaway path', () => {
  const homeRoot = path.join(path.sep, 'tmp', 'x');
  const scrubbed = scrubCredentialEnv({ GOOGLE_APPLICATION_CREDENTIALS: '/Users/someone/adc.json' }, homeRoot);

  assert.equal(scrubbed.GOOGLE_APPLICATION_CREDENTIALS, path.join(homeRoot, ADC_FILE));
});

test('scrubCredentialEnv with no home root throws', () => {
  assert.throws(() => scrubCredentialEnv({ PATH: '/usr/bin', GH_TOKEN: 'x' }), /scrubCredentialEnv needs a home root/);
});

test('the onboard seams leave the process env pointed at a throwaway root for every stored login', () => {
  // A child loads the seams, so their env edits never touch this process
  const script = [
    `require(${JSON.stringify(ONBOARD_SEAMS)});`,
    "const keys = ['GH_CONFIG_DIR', 'XDG_CONFIG_HOME', 'CLOUDSDK_CONFIG', 'GOOGLE_APPLICATION_CREDENTIALS'];",
    'process.stdout.write(JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key]]))));',
  ].join('\n');
  const output = childProcess.execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  const env = JSON.parse(output.slice(output.indexOf('{')));

  assert.equal(typeof env.GH_CONFIG_DIR, 'string', 'GH_CONFIG_DIR is set');
  const homeRoot = path.dirname(env.GH_CONFIG_DIR);
  assert.equal(env.GH_CONFIG_DIR, path.join(homeRoot, 'gh'));
  assert.equal(env.XDG_CONFIG_HOME, path.join(homeRoot, 'xdg'));
  assert.equal(env.CLOUDSDK_CONFIG, path.join(homeRoot, 'gcloud'));
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, path.join(homeRoot, ADC_FILE));

  // Throwaway: inside the temp dir, never the machine's own home
  const tmp = [os.tmpdir(), fs.realpathSync(os.tmpdir())];
  assert.ok(tmp.some((dir) => homeRoot.startsWith(`${dir}${path.sep}`)), `${homeRoot} sits under the temp dir`);
});
