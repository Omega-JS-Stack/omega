/**
 * The credential scrub: an env copy with no machine credential in reach, for
 * every test run that must prove itself without one (the journey's runtime
 * legs, the onboard seams, the brand-template first run).
 */
const path = require('node:path');

// Every CLI the manage walk can spawn, and the variable naming its config home
// (where its stored login lives). A scrubbed run points each at an empty dir.
const CLI_CONFIG_HOMES = [
  { cli: 'gh', env: 'GH_CONFIG_DIR', dir: 'gh' },
  { cli: 'firebase-tools', env: 'XDG_CONFIG_HOME', dir: 'xdg' },
  { cli: 'gcloud', env: 'CLOUDSDK_CONFIG', dir: 'gcloud' },
];

/**
 * Strip credential-shaped variables from an env copy, point every
 * CLI_CONFIG_HOMES variable at `<homeRoot>/<dir>`, and point
 * GOOGLE_APPLICATION_CREDENTIALS at a file under the root that is never
 * created: Google's auth library reads that variable first and fails on the
 * missing file instead of falling back to the stored one under `$HOME`.
 *
 * @param {Object} env - Source environment (not mutated)
 * @param {string} homeRoot - Throwaway root for the CLI config homes
 * @returns {Object} Scrubbed copy
 */
function scrubCredentialEnv(env, homeRoot) {
  if (!homeRoot) {
    throw new Error('scrubCredentialEnv needs a home root');
  }
  const CREDENTIAL_SHAPE = /(TOKEN|SECRET|PASSWORD|PASSPHRASE|API_KEY|APIKEY|_KEY$|CLIENT_ID|CLIENT_SECRET|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS|AUTH)/i;
  const scrubbed = {};
  for (const [name, value] of Object.entries(env)) {
    if (!CREDENTIAL_SHAPE.test(name)) {
      scrubbed[name] = value;
    }
  }
  for (const home of CLI_CONFIG_HOMES) {
    scrubbed[home.env] = path.join(homeRoot, home.dir);
  }
  scrubbed.GOOGLE_APPLICATION_CREDENTIALS = path.join(scrubbed.CLOUDSDK_CONFIG, 'application_default_credentials.json');
  return scrubbed;
}

module.exports = { CLI_CONFIG_HOMES, scrubCredentialEnv };
