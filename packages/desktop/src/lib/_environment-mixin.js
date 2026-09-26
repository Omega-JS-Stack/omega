// The main process's environment and backend-URL surface: methods mixed into
// the `Omega` class (src/main.js) with `Object.assign(Omega.prototype, ...)`, so
// they stay `omega.getEnvironment()`, `omega.getApiUrl()`, ... on the instance.

const { getEnvironment, isDevelopment, isProduction, isTesting, getVersion } = require('../utils/mode-helpers.js');
const { getFunctionsUrl, getApiUrl, getWebsiteUrl, getAuthUrl } = require('../utils/url-helpers.js');

module.exports = {
  // The environment surface (#817): @omega.js/config's ONE implementation,
  // reading the process's OMEGA_ENVIRONMENT, then this instance's baked
  // `config.environment`
  getEnvironment() {
    return getEnvironment.call(this);
  },

  isDevelopment() {
    return isDevelopment.call(this);
  },

  isProduction() {
    return isProduction.call(this);
  },

  isTesting() {
    return isTesting.call(this);
  },

  getVersion() {
    return getVersion();
  },

  // The backend URL helpers (utils/url-helpers.js): local in development and
  // testing, the brand's hosts in production. `environment` overrides the
  // running one.
  getFunctionsUrl(environment) {
    return getFunctionsUrl(this, environment);
  },

  getApiUrl(environment) {
    return getApiUrl(this, environment);
  },

  getWebsiteUrl(environment) {
    return getWebsiteUrl(this, environment);
  },

  getAuthUrl(environment, returnUrl) {
    return getAuthUrl(this, environment, returnUrl);
  },
};
