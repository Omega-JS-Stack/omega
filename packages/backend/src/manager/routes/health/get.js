const path = require('path');
const { readTestMode, applyEnvFromFile } = require('../../../test/utils/test-mode-file.js');

/**
 * GET /health — the deployed backend's liveness + version probe
 *
 * Public by design: no auth, and it echoes NO request input, so it is safe at a
 * production URL. @omega.js/manager's live API check reads it on a real host and
 * the test runner reads it to confirm the emulator's project + mode. It used to
 * live at `test/health` and needed a carve-out in the dev-only folder gate; a
 * liveness probe is not a test route, so it is a real route now and the folder
 * has zero exceptions ([#238](https://github.com/Omega-JS-Stack/omega/issues/238)).
 */
module.exports = async ({ ctx, Manager }) => {

  // Belt-and-suspenders freshness check: re-read the test-mode file before
  // reporting `testExtendedMode`. fs.watch installed in Manager.init usually
  // catches changes within ~50ms, but this handler hits the disk directly to
  // guarantee the runner sees the actual current value even if the watcher
  // missed an event. ~1ms cost on a debug endpoint.
  try {
    const projectDir = path.dirname(Manager.cwd);
    const data = readTestMode(projectDir);
    applyEnvFromFile(data);
  } catch (e) {
    // Non-fatal — if the file can't be read, fall through to whatever
    // process.env already has.
  }

  const response = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: ctx.meta?.environment || 'unknown',
    projectId: Manager.config?.cloud?.config?.projectId || process.env.GCLOUD_PROJECT || 'unknown',
    version: Manager.package?.version || 'unknown',
    backendVersion: Manager.version || 'unknown',
    testExtendedMode: !!process.env.TEST_EXTENDED_MODE,
  };

  ctx.log('Health check', response);

  return ctx.respond(response);
};
