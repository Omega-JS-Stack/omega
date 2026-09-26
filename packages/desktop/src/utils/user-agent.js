// user-agent: the global user agent fallback every @omega.js/desktop app carries,
// so web requests (BrowserWindow loads, fetch, electron-updater downloads) send a
// branded UA: Mozilla parsers see a normal Chrome UA and the app's own
// server-side telemetry sees `{brand.name}/{app.version}`. Merge tags use
// node-powertools.template (single-curly syntax). A consumer overrides it by
// re-setting `app.userAgentFallback` from its main.js after initialize().

const TEMPLATES = {
  darwin: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) {brand.name}/{app.version} Chrome/{chrome} Safari/537.36',
  win32:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) {brand.name}/{app.version} Chrome/{chrome} Safari/537.36',
  linux:  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) {brand.name}/{app.version} Chrome/{chrome} Safari/537.36',
};

/**
 * Set `app.userAgentFallback` from the brand and this process's versions.
 * @param {object} omega - the main-process instance (its config, getVersion() and logger).
 * @returns {string} the user agent it set.
 */
function applyUserAgent(omega) {
  const { template } = require('node-powertools');
  const { app } = require('electron');

  const ua = template(TEMPLATES[process.platform] || TEMPLATES.linux, {
    brand: {
      name: omega.config.brand.name,
      id:   omega.config.brand.id,
    },
    app: {
      version: omega.getVersion(),
    },
    chrome:   process.versions.chrome,
    electron: process.versions.electron,
    node:     process.versions.node,
    platform: process.platform,
    arch:     process.arch,
  });

  app.userAgentFallback = ua;
  omega.logger.log(`userAgent: ${ua}`);

  return ua;
}

module.exports = applyUserAgent;
