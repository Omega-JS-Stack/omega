/**
 * Provider modules: where they are found, whether they can run a grant, and the
 * credentials the brand registered them with
 * ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)).
 *
 * One concern, one file: nothing here knows what a grant step does, what the
 * state cipher is, or which user the route is acting on.
 */

const path = require('path');
const jetpack = require('fs-jetpack');
// Aliased: this file exports its OWN loadProvider (the connection lookup below)
const loadProviderModule = require('../../../libraries/load-provider.js');
const providerPath = loadProviderModule.providerPath;
const env = require('../../../libraries/env.js');

const PROVIDERS_DIR = path.join(__dirname, 'providers');

// A brand's own providers, staged with the rest of its src/
// ([#771](https://github.com/Omega-JS-Stack/omega/issues/771)): the same
// `${Manager.cwd}/<dir>/<name>.js` convention `src/routes/` and the event
// handlers already use, and it is searched FIRST — a brand may replace a
// packaged provider by shipping a file with its name.
const BRAND_PROVIDERS_DIR = 'connections';

/**
 * The directories a provider name is looked up in, in order: the brand's own
 * staged `connections/` dir, then the package's.
 *
 * @param {object|null} Manager - The BackendManager (its `cwd` is the staged consumer dir)
 * @returns {string[]} Absolute directory paths, brand first
 */
function providerDirs(Manager) {
  const dirs = [];

  if (Manager && Manager.cwd) {
    dirs.push(path.join(Manager.cwd, BRAND_PROVIDERS_DIR));
  }

  dirs.push(PROVIDERS_DIR);

  return dirs;
}

/**
 * A provider module that cannot run its grant is a PROGRAMMER error, not a
 * caller's typo: it throws here, naming the file and the field, instead of
 * failing at the redirect or the token exchange with the provider's own
 * opaque message ([#771](https://github.com/Omega-JS-Stack/omega/issues/771)).
 *
 * The three requirements are the three things the lane cannot invent
 * ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)): where the user
 * is sent, how the code becomes a token, and who the token belongs to. Every
 * other step has a default.
 *
 * The message names the FILE, never the path it was found at: the request that
 * tripped it belongs to a signed-in user, and where a brand's code is deployed
 * is not theirs to read. The file name is what a developer needs anyway.
 *
 * @param {*} provider - The required module
 * @param {string} filePath - The file it came from
 * @returns {object} The same module
 * @throws {Error} When the module cannot answer an authorize, an exchange or an identity
 */
function assertProviderShape(provider, filePath) {
  const file = path.basename(filePath);

  if (!provider || typeof provider !== 'object') {
    throw new Error(`Connection provider ${file} must export an object (the module shape: provider, name, urls, scope, identity)`);
  }

  if (!provider.urls?.authorize && typeof provider.authorize !== 'function') {
    throw new Error(`Connection provider ${file} declares no urls.authorize and no authorize() — one of the two has to say where the user is sent`);
  }

  if (!provider.urls?.token && typeof provider.exchange !== 'function') {
    throw new Error(`Connection provider ${file} declares no urls.token and no exchange() — one of the two has to say how the code becomes a token`);
  }

  if (typeof provider.identity !== 'function') {
    throw new Error(`Connection provider ${file} declares no identity() — the lane cannot know whose account a token belongs to`);
  }

  if (provider.pkce && provider.pkce !== 'S256') {
    throw new Error(`Connection provider ${file} declares pkce: '${provider.pkce}' — S256 is the only challenge method the lane mints`);
  }

  return provider;
}

/**
 * Resolve a provider module by name: the brand's own file wins, the package's
 * answers otherwise, and a name nothing answers is null (the caller's 400).
 *
 * @param {string} providerName - The provider key ('google', 'twitch', …)
 * @param {object|null} Manager - The BackendManager
 * @returns {object|null} The provider module, or null when no file exists
 * @throws {Error} When a file exists but exports a malformed shape
 */
function resolveProvider(providerName, Manager) {
  for (const dir of providerDirs(Manager)) {
    let file;

    try {
      file = providerPath(dir, providerName);
    } catch (e) {
      // An invalid name can never name a file: it is an unknown provider, and
      // the confined loader is what decided that (never a second copy of the rule)
      return null;
    }

    if (jetpack.exists(file) !== 'file') {
      continue;
    }

    return assertProviderShape(loadProviderModule(dir, providerName), file);
  }

  return null;
}

/**
 * The credential pair a provider was registered with — the ONE home of the env
 * key convention ([#793](https://github.com/Omega-JS-Stack/omega/issues/793)):
 * the provider name uppercased, dashes as underscores.
 *
 * A public client has no secret ([#785](https://github.com/Omega-JS-Stack/omega/issues/785)),
 * and an unset key resolves to nothing rather than an empty string the grant
 * would send.
 *
 * @param {string} providerName - The provider key
 * @returns {{ clientId: string|undefined, clientSecret: string|undefined }}
 */
function providerCredentials(providerName) {
  const providerEnvKey = providerName.toUpperCase().replace(/-/g, '_');

  return {
    clientId: env.get(`CONNECTIONS_${providerEnvKey}_CLIENT_ID`),
    clientSecret: env.get(`CONNECTIONS_${providerEnvKey}_CLIENT_SECRET`),
  };
}

/**
 * Load a provider and its credentials, or the 400 an unknown name answers.
 *
 * @param {string} providerName - The provider key
 * @param {object|null} Manager - The BackendManager
 * @returns {object} `{ connectionProvider, clientId, clientSecret }` or `{ error }`
 */
function loadProvider(providerName, Manager) {
  const connectionProvider = resolveProvider(providerName, Manager);

  if (!connectionProvider) {
    return { error: { message: `Unknown connection provider: ${providerName}`, code: 400 } };
  }

  return { connectionProvider, ...providerCredentials(providerName) };
}

/**
 * The ONE line a provider's identity step may log
 * ([#641](https://github.com/Omega-JS-Stack/omega/issues/641)).
 *
 * Every provider used to hand `ctx.log` the token exchange RESPONSE, which
 * carries the access token, the refresh token and (Google) the id token — so a
 * brand's Cloud Logging held live third-party credentials for the whole
 * retention window, readable by anyone with a log-viewer role. The decoded
 * profile and the provider's identity response went the same way, and those are
 * the user's PII.
 *
 * What a log needs is WHICH provider, WHOSE account, and whether the exchange
 * came back with a token. Nothing on this line is a credential or a person, and
 * one home for the format keeps the providers from drifting apart.
 *
 * @param {object} ctx - The route context (the log sink)
 * @param {object} options
 * @param {string} options.provider - The provider key ('google', 'discord', …)
 * @param {string|null} [options.uid] - The account the identity is being linked to
 * @param {object} [options.token] - The token exchange response — READ for whether
 *   it succeeded, never logged
 */
function logIdentityCheck(ctx, { provider, uid, token }) {
  ctx.log(`identity(): provider=${provider}, uid=${uid || 'null'}, tokenExchange=${token?.access_token ? 'succeeded' : 'failed'}`);
}

module.exports = {
  assertProviderShape,
  resolveProvider,
  loadProvider,
  logIdentityCheck,
};
