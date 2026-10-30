/**
 * ensureTarget, loaded FRESH under a recording peer installer so it holds the
 * recorder however it requires it: a scaffold case never reaches npm. npm is
 * offline meanwhile, so a missed stub fails instead of downloading.
 */
const path = require('path');

const TARGET_DEPENDENCIES = path.join(__dirname, '..', '..', 'dist', 'vendor', 'devkit', 'target-dependencies.js');
const ENSURE_TARGET = path.join(__dirname, '..', '..', 'dist', 'cli', 'utils', 'ensure-target.js');

/**
 * Run ensureTarget with the peer install recorded, never performed.
 *
 * @param {object} options - What ensureTarget takes (`projectDir`, `log`).
 * @returns {Promise<{ result: object, peers: object[] }>} Its result, and every peer-install call it made.
 */
async function ensureTargetOffline(options) {
  const module = require(TARGET_DEPENDENCIES);
  const real = module.ensurePeerDependencies;
  const offline = process.env.npm_config_offline;
  const peers = [];

  module.ensurePeerDependencies = async (input) => { peers.push(input); };
  process.env.npm_config_offline = 'true';
  delete require.cache[ENSURE_TARGET];

  try {
    const result = await require(ENSURE_TARGET).ensureTarget(options);
    return { result, peers };
  } finally {
    module.ensurePeerDependencies = real;
    delete require.cache[ENSURE_TARGET];
    if (offline === undefined) {
      delete process.env.npm_config_offline;
    } else {
      process.env.npm_config_offline = offline;
    }
  }
}

module.exports = { ensureTargetOffline };
