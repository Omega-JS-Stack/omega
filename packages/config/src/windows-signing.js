/**
 * @omega.js/config windows-signing: the ONE declaration of how a desktop brand
 * signs for Windows. `platforms.windows.signing.strategy` picks the strategy and,
 * under `cloud`, `platforms.windows.signing.cloud.provider` picks whose service
 * signs. The config schema's enums, the env schema's credential gates, the
 * desktop signer and its precheck all read these sets.
 *
 * A leaf on purpose: schema.js reads it, so it requires nothing from this package.
 */

const WINDOWS_SIGNING_STRATEGIES = ['self-hosted', 'local', 'cloud'];
const DEFAULT_WINDOWS_SIGNING_STRATEGY = 'self-hosted';
const WINDOWS_CLOUD_PROVIDERS = ['azure', 'sslcom', 'digicert'];

/**
 * The Windows signing strategy a resolved desktop config signs with.
 * @param {object} [config] - A resolved desktop target config.
 * @returns {string} The configured strategy, else the default.
 */
function windowsSigningStrategy(config) {
  return config?.platforms?.windows?.signing?.strategy || DEFAULT_WINDOWS_SIGNING_STRATEGY;
}

module.exports = {
  WINDOWS_SIGNING_STRATEGIES,
  DEFAULT_WINDOWS_SIGNING_STRATEGY,
  WINDOWS_CLOUD_PROVIDERS,
  windowsSigningStrategy,
};
