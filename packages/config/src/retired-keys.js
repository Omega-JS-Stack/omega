/**
 * Retired-key detection (#142) — a key that was RENAMED outright in the
 * migration to omega.json5 is an error, never a silent no-op. There is no
 * dual-read anywhere in OMEGA, so a config still carrying `web_manager`
 * validated clean and quietly lost its auth policy, cookie consent and
 * chatsy settings: nothing reads that name.
 *
 * Like secrets.js this is a key-NAME test, walked at every depth (shared
 * level, inside a target entry, inside an instance array) — the rename moved
 * the key, not its home. Only unambiguous renames belong here: a name that
 * still exists as a legitimate key somewhere in the schema (`sentry`, which
 * lives on as `client.sentry`; `google`/`meta` under `analytics.providers`)
 * would false-positive and is left to the mapping tables.
 */

// key name → { replacement, why } (docs/shared/config.md carries the rows)
const RETIRED_KEYS = {
  web_manager: {
    replacement: 'client',
    why: 'it configures @omega.js/client (#1); WebManager is not an OMEGA concept',
  },
  firebaseConfig: {
    replacement: 'cloud',
    why: "the provider-discriminated role key: cloud: { provider: 'firebase', config: {…} }",
  },
};

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

    if (RETIRED_KEYS[key]) {
      found.push({ path: keyPath, key, ...RETIRED_KEYS[key] });
    }

    walk(node[key], keyPath, found);
  });
}

/**
 * Recursively find retired config keys.
 * @param {object} object - Parsed config (or any sub-tree of one).
 * @returns {Array<{ path: string, key: string, replacement: string, why: string }>}
 */
function findRetiredKeys(object) {
  const found = [];
  walk(object, '', found);
  return found;
}

module.exports = { findRetiredKeys, RETIRED_KEYS };
