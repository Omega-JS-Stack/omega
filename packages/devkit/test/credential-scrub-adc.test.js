/**
 * The credential scrub against Google's real auth library: the copy that
 * firebase-admin installs, which firebase-tools falls back to with no
 * signed-in user. It finds a stored login at
 * `$HOME/.config/gcloud/application_default_credentials.json`; a scrubbed env
 * must make it fail on the scrub's missing path instead of falling back there.
 *
 * Real library, stand-in credentials file (made-up values) in a temp HOME.
 * No network: a fixed project id keeps the library off gcloud and the metadata server.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scrubCredentialEnv } = require('../src/test/credential-scrub.js');

const BACKEND_DIR = path.join(__dirname, '..', '..', 'backend');

// The copy firebase-admin itself resolves from the backend; a failed resolve throws at load
const FIREBASE_ADMIN_DIR = path.dirname(require.resolve('firebase-admin', { paths: [BACKEND_DIR] }));
const { GoogleAuth, UserRefreshClient } = require(require.resolve('google-auth-library', {
  paths: [FIREBASE_ADMIN_DIR],
}));

const STAND_IN = {
  type: 'authorized_user',
  client_id: 'stand-in-client.apps.googleusercontent.com',
  client_secret: 'stand-in-secret',
  refresh_token: 'stand-in-refresh-token',
};

/** A temp HOME holding a stand-in default credentials file, plus an empty scrub home root. */
function adcFixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-adc-home-'));
  const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-adc-scrub-'));
  const gcloudDir = path.join(home, '.config', 'gcloud');
  fs.mkdirSync(gcloudDir, { recursive: true });
  fs.writeFileSync(path.join(gcloudDir, 'application_default_credentials.json'), JSON.stringify(STAND_IN));

  return {
    home,
    homeRoot,
    cleanup() {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(homeRoot, { recursive: true, force: true });
    },
  };
}

/**
 * Run `thunk` with process.env replaced by `env` wholesale, restoring the
 * runner's own env afterwards: the library reads process.env, and a leaked
 * HOME would steer every later test in the run.
 */
async function withProcessEnv(env, thunk) {
  const saved = { ...process.env };
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, env);

  try {
    return await thunk();
  } finally {
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, saved);
  }
}

/** The library's default-credentials lookup, on a fresh instance so nothing is cached. */
function applicationDefault() {
  return new GoogleAuth({ projectId: 'demo-adc' }).getApplicationDefault();
}

module.exports = defineCases({
  type: 'group',
  description: 'credential-scrub-adc',
  tests: [
    {
      name: 'with the scrub\'s variable, the auth library rejects and names the missing path',
      run: async (ctx) => {
        const fixture = adcFixture();

        try {
          const scrubbed = scrubCredentialEnv({ ...process.env, HOME: fixture.home }, fixture.homeRoot);
          const missing = path.join(fixture.homeRoot, 'gcloud', 'application_default_credentials.json');

          await withProcessEnv(scrubbed, async () => {
            await ctx.expect(applicationDefault()).rejects.toThrow((error) => {
              ctx.expect(error.message.includes(missing), `the rejection names ${missing}: ${error.message}`).toBeTruthy();
              return true;
            });
          });
        } finally {
          fixture.cleanup();
        }
      },
    },

    {
      name: 'without the scrub\'s variable, the auth library loads the stored file under HOME',
      run: async (ctx) => {
        const fixture = adcFixture();

        try {
          const scrubbed = scrubCredentialEnv({ ...process.env, HOME: fixture.home }, fixture.homeRoot);
          delete scrubbed.GOOGLE_APPLICATION_CREDENTIALS;

          await withProcessEnv(scrubbed, async () => {
            const { credential } = await applicationDefault();
            ctx.expect(credential instanceof UserRefreshClient, 'the stand-in authorized_user file loaded').toBeTruthy();
            ctx.expect(credential._clientId).toBe(STAND_IN.client_id);
          });
        } finally {
          fixture.cleanup();
        }
      },
    },
  ],
});
