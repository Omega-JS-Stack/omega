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
 * still exists as a legitimate key somewhere in the schema (`google`/`meta`
 * under `analytics.providers`) would false-positive and is left to the mapping
 * tables. `sentry` is the one that LOOKS like an omission and is not: its new
 * home is itself a `sentry` key (`monitoring.providers.sentry` — #485 moved
 * the web converter there too), so a name test would fire on the very shape
 * every mapping row points at.
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
  cookieConsent: {
    replacement: 'client.consent',
    why: 'the banner became a real consent gate (#383) — the block names the DECISION, not the cookie, and its palette/theme/type keys are gone (tokens paint it, the visitor\'s region picks opt-in vs opt-out)',
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

  // ─── one provider shape everywhere (#425) ──────────────────────────────
  // Every role names its vendors under `providers`, so the flat picks
  // (`domain.provider`), the fourth word (`payment.processors`) and the bare
  // vendor key (`certificates.apple`) are gone. Each CONVERTED LEAF is its
  // own row: a config still carrying the old key would validate clean and
  // silently lose the setting, which is exactly what this guard exists for.
  'payment.processors': {
    replacement: 'payment.providers',
    why: 'one provider shape everywhere (#425) — the block is `providers` in every role, payment included (and the singular word followed in #428: `provider` on a subscription/webhook document, on the payments routes, and in the code)',
  },
  'certificates.apple': {
    replacement: 'certificates.providers.apple',
    why: 'one provider shape everywhere (#425) — no bare vendor keys; Windows signing will sit beside it as certificates.providers.<vendor>',
  },
  'domain.provider': {
    replacement: 'domain.providers.<registrar>',
    why: 'one provider shape everywhere (#425) — the registrar is a KEY under `domain.providers` (namecheap/squarespace); no entry = none chosen and the domain service skips, exactly as a null provider did',
  },
  'domain.email.provider': {
    replacement: 'domain.email.providers.<provider>',
    why: 'one provider shape everywhere (#425) — the mailbox provider is a KEY under `domain.email.providers` (cloudflare/squarespace/privateemail); `domain.email.forwarding` stays role-level',
  },
  'translation.provider': {
    replacement: 'translation.providers.<name>',
    why: 'one provider shape everywhere (#425) — presence picks the engine ({ claude: {} } / { chatgpt: {} }); `translation.model` stays role-level',
  },
  'devlog.provider': {
    replacement: 'devlog.providers.ghostii',
    why: 'one provider shape everywhere (#425) — the writer is a KEY under `devlog.providers`, and its settings moved inside it; `devlog.enabled` stays role-level',
  },
  'devlog.lookbackDays': {
    replacement: 'devlog.providers.ghostii.lookbackDays',
    why: 'provider-hung devlog settings live under the provider that reads them (#425)',
  },
  'devlog.orgs': {
    replacement: 'devlog.providers.ghostii.orgs',
    why: 'provider-hung devlog settings live under the provider that reads them (#425)',
  },
  'devlog.excludeRepos': {
    replacement: 'devlog.providers.ghostii.excludeRepos',
    why: 'provider-hung devlog settings live under the provider that reads them (#425)',
  },
  'devlog.excludeCommits': {
    replacement: 'devlog.providers.ghostii.excludeCommits',
    why: 'provider-hung devlog settings live under the provider that reads them (#425)',
  },
  'devlog.excludeTopics': {
    replacement: 'devlog.providers.ghostii.excludeTopics',
    why: 'provider-hung devlog settings live under the provider that reads them (#425)',
  },
  'devlog.includePrivate': {
    replacement: 'devlog.providers.ghostii.includePrivate',
    why: 'provider-hung devlog settings live under the provider that reads them (#425)',
  },
  'devlog.postPath': {
    replacement: 'devlog.providers.ghostii.postPath',
    why: 'provider-hung devlog settings live under the provider that reads them (#425)',
  },
  'devlog.destinations': {
    replacement: 'devlog.providers.ghostii.destinations',
    why: 'provider-hung devlog settings live under the provider that reads them (#425)',
  },
  'devlog.overrides': {
    replacement: 'devlog.providers.ghostii.overrides',
    why: 'provider-hung devlog settings live under the provider that reads them (#425)',
  },
  'monitoring.provider': {
    replacement: 'monitoring.providers.sentry',
    why: "one provider shape everywhere (#425) — the monitor is a KEY under `monitoring.providers` (only sentry today); `monitoring.enabled` stays role-level",
  },
  'monitoring.org': {
    replacement: 'monitoring.providers.sentry.org',
    why: 'provider-hung Sentry settings live under the provider that reads them (#425)',
  },
  'monitoring.dsn': {
    replacement: 'monitoring.providers.sentry.dsn',
    why: 'provider-hung Sentry settings live under the provider that reads them (#425) — per-surface DSNs are targets.<type>.monitoring.providers.sentry.dsn',
  },
  'monitoring.environment': {
    replacement: 'monitoring.providers.sentry.environment',
    why: 'provider-hung Sentry settings live under the provider that reads them (#425)',
  },
  'monitoring.sampleRate': {
    replacement: 'monitoring.providers.sentry.sampleRate',
    why: 'provider-hung Sentry settings live under the provider that reads them (#425)',
  },
  'monitoring.tracesSampleRate': {
    replacement: 'monitoring.providers.sentry.tracesSampleRate',
    why: 'provider-hung Sentry settings live under the provider that reads them (#425)',
  },
  'monitoring.scrubEmail': {
    replacement: 'monitoring.providers.sentry.scrubEmail',
    why: 'provider-hung Sentry settings live under the provider that reads them (#425)',
  },
  'monitoring.attachScreenshot': {
    replacement: 'monitoring.providers.sentry.attachScreenshot',
    why: 'provider-hung Sentry settings live under the provider that reads them (#425)',
  },
  'monitoring.bundlePatterns': {
    replacement: 'monitoring.providers.sentry.bundlePatterns',
    why: 'provider-hung Sentry settings live under the provider that reads them (#425)',
  },
  'marketing.campaigns.provider': {
    replacement: 'marketing.campaigns.providers.sendgrid',
    why: "one provider shape everywhere (#425) — the email-marketing vendor is a KEY under `marketing.campaigns.providers`; `marketing.campaigns.enabled` stays role-level",
  },
  'marketing.campaigns.listId': {
    replacement: 'marketing.campaigns.providers.sendgrid.listId',
    why: 'the list id is a SendGrid fact and lives under the provider that reads it (#425)',
  },
  'marketing.newsletter.provider': {
    replacement: 'marketing.newsletter.providers.beehiiv',
    why: "one provider shape everywhere (#425) — the newsletter vendor is a KEY under `marketing.newsletter.providers`; `marketing.newsletter.enabled` and `marketing.newsletter.content` stay role-level (content is pipeline config, not Beehiiv config)",
  },
  'marketing.newsletter.publicationId': {
    replacement: 'marketing.newsletter.providers.beehiiv.publicationId',
    why: 'the publication id is a Beehiiv fact and lives under the provider that reads it (#425)',
  },
  'blog.provider': {
    replacement: 'blog.providers.ghostii',
    why: "one provider shape everywhere (#425) — the blog writer is a KEY under `blog.providers`; `blog.enabled` and `blog.content` stay role-level (content is pipeline config)",
  },

  // ─── one home for the download/extension links (#610) ──────────────────
  // The legacy UJM page maps survived beside the derivation #85/#124 added,
  // so explicit config could silently override the release the desktop target
  // actually ships. Matched at their AUTHORED path: `targets.web` is where the
  // converter wrote them and where every carrying brand still has them, and
  // the merged targets map rides every resolved config, so one row fires once
  // for every target load (a root `download` on a web load is the same key
  // overlaid, not a second mistake).
  'targets.web.download': {
    replacement: 'targets.desktop.releases',
    why: 'two homes for one fact (#610) — the /download page and its shortlinks derive from the desktop target\'s releases block, curated onto site.targets.desktop.releasesUrl; a hand-written map could point at a release that does not exist',
  },
  'targets.web.extension': {
    replacement: 'targets.extension.listings',
    why: 'two homes for one fact (#610) — the /extension page and its shortlinks read the extension target\'s store listings, curated onto site.targets.extension.listings',
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
