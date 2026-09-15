/**
 * The desktop target's ONE env load
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)).
 *
 * Two boots populate `process.env` for a desktop target: the CLI (`src/cli.js`)
 * and gulp (`src/gulp/main.js`, which runs as its own process and is invoked
 * directly by `npm start`). Both call HERE, so a signing path is derived once,
 * by one rule, and every reader after it (the build, `validate-certs`, the
 * deploy precheck's secrets publish) reads the answer instead of deriving its
 * own. The derivation itself is `@omega.js/devkit/signing-env`: the signing
 * tree, company tier first.
 *
 * The lines it prints name PATHS, never contents: `CSC_LINK derived from
 * <path>` is exactly what a signing failure is diagnosed from. WHEN they print
 * is the caller's (gulp holds them until its log tee is attached, so build.log
 * carries them); the SHAPE of them is here, once.
 */
const { loadEnv } = require('@omega.js/config');
const { deriveSigningEnv } = require('@omega.js/devkit/signing-env');

/**
 * Load the `.env` cascade for a desktop target and derive its signing paths.
 *
 * @param {string} projectRoot - The target root.
 * @param {object} [options]
 * @param {object} [options.logger] - `{ log, warn }`; the result is reported at
 *   once when given, and handed back for the caller to report otherwise.
 * @param {object} [options.env] - The env map to populate (default process.env).
 * @returns {{ derived: Array<{ key: string, value: string }>, problems: Array<{ key: string, reason: string }> }}
 */
function loadDesktopEnv(projectRoot, options = {}) {
  const env = options.env || process.env;

  // The cascade first (shell > target .env > brand .env > company .env). The
  // target name delivers the schema's `deliverAs` renames (#678).
  loadEnv(projectRoot, { target: 'desktop' });

  const result = deriveSigningEnv({ env, targetDir: projectRoot });

  if (options.logger) {
    reportSigningEnv(result, options.logger);
  }

  return result;
}

/**
 * Say what the derivation answered: one line per key, paths only.
 *
 * @param {{ derived: Array, problems: Array }} result - What loadDesktopEnv returned.
 * @param {object} logger - `{ log, warn }`.
 */
function reportSigningEnv({ derived, problems }, logger) {
  for (const { key, value } of derived) {
    logger.log(`${key} derived from ${value}`);
  }

  // A file that is THERE and cannot be used is never silent: the key stays
  // unset (Keychain discovery stays the default), and the reason is said out
  // loud so the next rung's error is not the first anyone hears of it.
  for (const { key, reason } of problems) {
    logger.warn(`${key} not derived: ${reason}`);
  }
}

module.exports = { loadDesktopEnv, reportSigningEnv };
