// Resolve the build OUTPUT directory for a project root.
//
// Default `<root>/dist` — what every gulp task joined by hand until #110. The ONE seam:
// `OMEGA_BUILD_OUTPUT` redirects the whole build output elsewhere, so a boot-test build
// never interleaves writes with a concurrent `npm start` watcher's dist/. An absolute
// value is used as-is; a relative one resolves against the project root.
//
// Build-time only — the runtime (window-manager, tray) still reads `<appRoot>/dist`,
// because the boot runner stages an app root whose dist IS the redirected output.

const path = require('path');

module.exports = function distRoot(root) {
  const override = process.env.OMEGA_BUILD_OUTPUT;

  if (!override) {
    return path.join(root, 'dist');
  }

  return path.isAbsolute(override) ? override : path.resolve(root, override);
};
