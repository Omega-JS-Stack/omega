/**
 * GET /test/health — the liveness probe's old home, kept for the dev/testing
 * callers that still ask for it. ONE implementation: the probe is a real route
 * now (`routes/health`), and this folder is development-only, so the path 404s
 * in production like every other test route
 * ([#238](https://github.com/Omega-JS-Stack/omega/issues/238)).
 */
module.exports = require('../../health/get.js');
