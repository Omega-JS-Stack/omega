/**
 * Secret-shaped key detection — secrets NEVER live in omega.json5; they live
 * in .env. loadConfig() scans the raw files and throws before a resolved
 * config is even produced; validateConfig() reports the same keys as errors.
 *
 * This is a key-NAME test, not a value test: a secret key with an empty or
 * placeholder value is still in the wrong home. Public credentials pass by
 * design — publishableKey, clientId, cloud.config.apiKey (the Firebase web
 * API key is public) all fail to match.
 */

const SECRET_KEY_PATTERN = /(secret|privateKey|apiSecret)$/i;

function walk(node, path, found) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, path ? `${path}.${index}` : String(index), found));
    return;
  }

  if (typeof node !== 'object' || node === null) {
    return;
  }

  Object.keys(node).forEach((key) => {
    const keyPath = path ? `${path}.${key}` : key;

    if (SECRET_KEY_PATTERN.test(key)) {
      found.push(keyPath);
    }

    walk(node[key], keyPath, found);
  });
}

/**
 * Recursively find config keys whose names look like secrets.
 * @param {object} object - Parsed config (or any sub-tree of one).
 * @returns {string[]} Dot-paths of offending keys (array indices included).
 */
function findSecretKeys(object) {
  const found = [];
  walk(object, '', found);
  return found;
}

module.exports = { findSecretKeys, SECRET_KEY_PATTERN };
