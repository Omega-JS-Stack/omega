// Where CSC_LINK and APPLE_API_KEY come from when nothing has answered yet
// ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)).
//
// The manager's disperse service used to stamp both into the target's .env as
// target-relative paths, and only when the file was there. No machine writes a
// target .env any more, so the build derives them instead: the artifacts are
// delivered into config/certs/ by every verb (deliver-certs.js), and a delivered
// file that nothing has pointed at IS the answer.
//
// Rules, per key: an env value that is already set always wins (an explicit
// answer is never overridden), and a file that is not there sets nothing (an
// unset key lets electron-builder's own skip/auto-discovery logic apply — the
// same reason sanitize-signing-env.js deletes empty placeholders).
//
// APPLE_API_KEY's filename carries the key id, so an unset APPLE_API_KEY_ID
// means there is no path to derive.

const path = require('node:path');
const jetpack = require('fs-jetpack');

const CERTS_DIR = path.join('config', 'certs');
const DEVELOPER_ID_APPLICATION = 'developer-id-application.p12';

/**
 * Set the signing paths the delivered artifacts imply. Mutates `env`.
 *
 * @param {object} input
 * @param {object} input.env - The env map to derive into (the build's process env).
 * @param {string} input.projectDir - The target root (paths are written relative to it).
 * @returns {Array<{ key: string, value: string }>} What was derived — empty when nothing was.
 */
function deriveSigningEnv({ env, projectDir }) {
  const derived = [];

  const candidates = [
    { key: 'CSC_LINK', file: DEVELOPER_ID_APPLICATION },
    { key: 'APPLE_API_KEY', file: env.APPLE_API_KEY_ID ? `AuthKey_${env.APPLE_API_KEY_ID}.p8` : null },
  ];

  for (const { key, file } of candidates) {
    if (!file) continue;
    if (typeof env[key] === 'string' && env[key].trim() !== '') continue;

    const relative = path.join(CERTS_DIR, file);
    if (!jetpack.exists(path.join(projectDir, relative))) continue;

    env[key] = relative;
    derived.push({ key, value: relative });
  }

  return derived;
}

module.exports = deriveSigningEnv;
module.exports.CERTS_DIR = CERTS_DIR;
module.exports.DEVELOPER_ID_APPLICATION = DEVELOPER_ID_APPLICATION;
