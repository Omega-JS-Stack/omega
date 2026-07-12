/**
 * node-version — resolve which Node an app's commands run under, from its
 * own `.nvmrc` (friction #15: one brand spans Node majors — web pins 24,
 * backend functions pin 22 — so the manager drives each app's commands
 * under THAT app's Node instead of whatever it was launched with).
 *
 * Ported from legacy omega-manager's update-service resolution: the pinned
 * major is matched against nvm's installed versions ($NVM_DIR/versions/node,
 * highest patch wins) and that version's bin dir is prepended to PATH for
 * the spawned command — node, npm, and npx all resolve to it. No .nvmrc →
 * inherited PATH. Pinned major not installed → a hard error naming the
 * `nvm install` to run.
 */
const path = require('node:path');
const os = require('node:os');
const jetpack = require('fs-jetpack');

/** nvm's installed-versions dir (resolved per call — tests override NVM_DIR). */
function nvmVersionsDir() {
  return path.join(process.env.NVM_DIR || path.join(os.homedir(), '.nvm'), 'versions', 'node');
}

/**
 * Parse the Node major out of an .nvmrc spec ('v24/*', 'v24', '24', '24.1.0' → 24).
 *
 * @param {string} content - Raw .nvmrc content.
 * @returns {number|null} The major, or null when unparseable.
 */
function parseNvmrcMajor(content) {
  const match = String(content || '').trim().match(/^v?(\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * Find the app's .nvmrc — the app dir first, then its `functions/` (the
 * backend convention pins Node where the Firebase runtime reads it).
 *
 * @param {string} appDir - The app directory commands run in.
 * @returns {{ spec: string, file: string }|null} The trimmed spec + its file.
 */
function findNvmrc(appDir) {
  for (const dir of [appDir, path.join(appDir, 'functions')]) {
    const file = path.join(dir, '.nvmrc');
    const content = jetpack.read(file);
    if (content && content.trim()) {
      return { spec: content.trim(), file };
    }
  }
  return null;
}

/**
 * Find the highest nvm-installed Node for a major (24 → { version, binDir }).
 *
 * @param {number} major - Required Node major.
 * @returns {{ version: string, binDir: string }|null} Best install, or null.
 */
function findInstalledNode(major) {
  const versions = (jetpack.list(nvmVersionsDir()) || [])
    .map((name) => {
      const match = name.match(/^v(\d+)\.(\d+)\.(\d+)$/);
      return match ? { name, parts: [Number(match[1]), Number(match[2]), Number(match[3])] } : null;
    })
    .filter(Boolean)
    .filter((v) => v.parts[0] === major)
    .sort((a, b) => b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2]);

  if (!versions.length) {
    return null;
  }
  return {
    version: versions[0].name,
    binDir: path.join(nvmVersionsDir(), versions[0].name, 'bin'),
  };
}

/**
 * Resolve which Node an app's commands should run under.
 *
 * @param {string} appDir - The directory the command will run in.
 * @returns {null|object} null (no/unparseable .nvmrc: inherited PATH),
 *   { major, spec, file, version, binDir } (binDir null when the current
 *   Node already matches), or { major, spec, file, error } (major not
 *   installed in nvm).
 */
function resolveAppNode(appDir) {
  const found = findNvmrc(appDir);
  if (!found) {
    return null;
  }

  const major = parseNvmrcMajor(found.spec);
  if (!major) {
    return null;
  }

  const currentMajor = Number(process.versions.node.split('.')[0]);
  if (major === currentMajor) {
    return { major, spec: found.spec, file: found.file, version: `v${process.versions.node}`, binDir: null };
  }

  const installed = findInstalledNode(major);
  if (!installed) {
    return {
      major,
      spec: found.spec,
      file: found.file,
      error: `Node v${major} required by .nvmrc (${found.spec}) is not installed — run: nvm install ${major}`,
    };
  }

  return { major, spec: found.spec, file: found.file, version: installed.version, binDir: installed.binDir };
}

/**
 * Env overrides for a spawned command so node/npm/npx resolve to the app's
 * Node ({} when the inherited PATH is already right).
 *
 * @param {object|null} resolved - A resolveAppNode() result.
 * @returns {object} Env override ({ PATH } or {}).
 */
function nodeEnvFor(resolved) {
  if (!resolved?.binDir) {
    return {};
  }
  return { PATH: `${resolved.binDir}${path.delimiter}${process.env.PATH}` };
}

module.exports = { parseNvmrcMajor, findInstalledNode, resolveAppNode, nodeEnvFor };
