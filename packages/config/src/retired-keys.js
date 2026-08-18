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
 *
 * RETIRED_PATHS is the second half (#23): the de-branding rekey moved whole
 * top-level keys into role-shaped homes where the provider keeps its own
 * name (`slapform` → `forms.providers.slapform`), and folded two keys into
 * `cloud`. A name test can't express those — `slapform` is legitimate again
 * one level down, and `firebase` lives on as `client.firebase` — so these
 * match one EXACT path from the root.
 *
 * `github` is deliberately NOT here: the brand's own `github` (content
 * identity, unchanged; a shared key since #277) lives at the top level, and
 * a `targets.backend.github` override is overlaid there too by the resolved
 * view, so a name test would false-positive. Its rename to
 * `repo.providers.github` is carried by the mapping tables in
 * docs/shared/config.md instead.
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

// exact dotted path → { replacement, why } (docs/shared/config.md carries the rows)
const RETIRED_PATHS = {
  slapform: {
    replacement: 'forms.providers.slapform',
    why: 'config keys name the ROLE, not the vendor (#23)',
  },
  chatsy: {
    replacement: 'inbound.chat.providers.chatsy',
    why: 'config keys name the ROLE, not the vendor (#23) — one home for the manager fields and the widget settings',
  },
  replyify: {
    replacement: 'inbound.email.providers.replyify',
    why: 'config keys name the ROLE, not the vendor (#23)',
  },
  cloudflare: {
    replacement: 'edge.providers.cloudflare',
    why: 'config keys name the ROLE, not the vendor (#23)',
  },
  recaptcha: {
    replacement: 'captcha.providers.recaptcha',
    why: 'config keys name the ROLE, not the vendor (#23)',
  },
  searchConsole: {
    replacement: 'search.providers.searchConsole',
    why: 'config keys name the ROLE, not the vendor (#23) — `seo` already means the parasite-SEO content feature',
  },
  gcp: {
    replacement: 'cloud',
    why: 'one cloud home (#23): gcp.organizationId/billingAccount are now cloud.organizationId/cloud.billingAccount',
  },
  firebase: {
    replacement: 'cloud',
    why: 'one cloud home (#23): the provisioning fields are now cloud.shared/supportEmail/apiSubdomain, and projectId lives only at cloud.config.projectId',
  },
  'advertising.providers.google-adsense': {
    replacement: 'advertising.providers.adsense',
    why: 'provider ids drop the vendor prefix and every key is camelCase (#23) — the slots are displaySlot/inArticleSlot/inFeedSlot/multiplexSlot',
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

    if (RETIRED_PATHS[keyPath]) {
      found.push({ path: keyPath, key, ...RETIRED_PATHS[keyPath] });
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

module.exports = { findRetiredKeys, RETIRED_KEYS, RETIRED_PATHS };
