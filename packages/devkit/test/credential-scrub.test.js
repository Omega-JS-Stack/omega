/**
 * Unit pins for the credential scrub: what a scrubbed child env keeps, what
 * it strips, and where it points every stored login (each CLI's config home,
 * and Google's application default credentials) so none is in reach.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'credential-scrub',
  tests: [
    {
      name: 'scrubCredentialEnv drops credential-shaped vars, keeps operating env, adds the stored-login redirects',
      run: (ctx) => {
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

        ctx.expect(Object.keys(scrubbed).sort()).toEqual([
          'CLOUDSDK_CONFIG', 'GH_CONFIG_DIR', 'GOOGLE_APPLICATION_CREDENTIALS', 'HOME', 'NODE_ENV',
          'OMEGA_MONOREPO', 'OMEGA_NON_INTERACTIVE', 'PATH', 'XDG_CONFIG_HOME', 'npm_config_cache',
        ]);
        ctx.expect(scrubbed.PATH).toBe('/usr/bin');
        ctx.expect(scrubbed.HOME).toBe('/Users/someone');
      },
    },

    {
      name: 'scrubCredentialEnv points every CLI at its throwaway config home',
      run: (ctx) => {
        const homeRoot = path.join(path.sep, 'tmp', 'x');
        const scrubbed = scrubCredentialEnv({ PATH: '/usr/bin', GH_TOKEN: 'x' }, homeRoot);

        ctx.expect(scrubbed.GH_CONFIG_DIR).toBe(path.join(homeRoot, 'gh'));
        ctx.expect(scrubbed.XDG_CONFIG_HOME).toBe(path.join(homeRoot, 'xdg'));
        ctx.expect(scrubbed.CLOUDSDK_CONFIG).toBe(path.join(homeRoot, 'gcloud'));
        ctx.expect('GH_TOKEN' in scrubbed).toBe(false);
      },
    },

    {
      name: 'scrubCredentialEnv replaces an incoming CLOUDSDK_CONFIG with the throwaway one',
      run: (ctx) => {
        const homeRoot = path.join(path.sep, 'tmp', 'x');
        const scrubbed = scrubCredentialEnv({ CLOUDSDK_CONFIG: '/Users/someone/.config/gcloud' }, homeRoot);

        ctx.expect(scrubbed.CLOUDSDK_CONFIG).toBe(path.join(homeRoot, 'gcloud'));
      },
    },

    {
      name: 'CLI_CONFIG_HOMES lists gh, firebase-tools and gcloud',
      run: (ctx) => {
        ctx.expect(CLI_CONFIG_HOMES.map((home) => home.cli)).toEqual(['gh', 'firebase-tools', 'gcloud']);
      },
    },

    {
      name: 'a scrub with a home root points GOOGLE_APPLICATION_CREDENTIALS at a throwaway path no file sits at',
      run: (ctx) => {
        const homeRoot = tempHomeRoot();
        const scrubbed = scrubCredentialEnv({ PATH: '/usr/bin' }, homeRoot);

        ctx.expect(scrubbed.GOOGLE_APPLICATION_CREDENTIALS).toBe(path.join(homeRoot, ADC_FILE));
        ctx.expect(fs.existsSync(scrubbed.GOOGLE_APPLICATION_CREDENTIALS)).toBe(false);

        fs.rmSync(homeRoot, { recursive: true, force: true });
      },
    },

    {
      name: 'scrubCredentialEnv replaces an incoming GOOGLE_APPLICATION_CREDENTIALS with the throwaway path',
      run: (ctx) => {
        const homeRoot = path.join(path.sep, 'tmp', 'x');
        const scrubbed = scrubCredentialEnv({ GOOGLE_APPLICATION_CREDENTIALS: '/Users/someone/adc.json' }, homeRoot);

        ctx.expect(scrubbed.GOOGLE_APPLICATION_CREDENTIALS).toBe(path.join(homeRoot, ADC_FILE));
      },
    },

    {
      name: 'scrubCredentialEnv with no home root throws',
      run: (ctx) => {
        ctx.expect(() => scrubCredentialEnv({ PATH: '/usr/bin', GH_TOKEN: 'x' })).toThrow(/scrubCredentialEnv needs a home root/);
      },
    },

    {
      name: 'the onboard seams leave the process env pointed at a throwaway root for every stored login',
      run: (ctx) => {
        // A child loads the seams, so their env edits never touch this process
        const script = [
          `require(${JSON.stringify(ONBOARD_SEAMS)});`,
          "const keys = ['GH_CONFIG_DIR', 'XDG_CONFIG_HOME', 'CLOUDSDK_CONFIG', 'GOOGLE_APPLICATION_CREDENTIALS'];",
          'process.stdout.write(JSON.stringify(Object.fromEntries(keys.map((key) => [key, process.env[key]]))));',
        ].join('\n');
        const output = childProcess.execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
        const env = JSON.parse(output.slice(output.indexOf('{')));

        ctx.expect(typeof env.GH_CONFIG_DIR, 'GH_CONFIG_DIR is set').toBe('string');
        const homeRoot = path.dirname(env.GH_CONFIG_DIR);
        ctx.expect(env.GH_CONFIG_DIR).toBe(path.join(homeRoot, 'gh'));
        ctx.expect(env.XDG_CONFIG_HOME).toBe(path.join(homeRoot, 'xdg'));
        ctx.expect(env.CLOUDSDK_CONFIG).toBe(path.join(homeRoot, 'gcloud'));
        ctx.expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe(path.join(homeRoot, ADC_FILE));

        // Throwaway: inside the temp dir, never the machine's own home
        const tmp = [os.tmpdir(), fs.realpathSync(os.tmpdir())];
        ctx.expect(tmp.some((dir) => homeRoot.startsWith(`${dir}${path.sep}`)), `${homeRoot} sits under the temp dir`).toBeTruthy();
      },
    },
  ],
});
