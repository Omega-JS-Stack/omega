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

  // The web instance IS the subdomain (#588). `brand.subdomains` was read by
  // ONE thing (the cloud hosting op, which ensured an api.{sub}.{domain} per
  // entry) and declared by nothing: no schema rule, no default, never
  // materialized. Ian's 2026-09-01 call gave the fact a real home. A NAME test
  // by the rule above: `subdomains` exists nowhere else in the schema (the
  // legacy searchConsole.subdomains was dropped outright), so the walk catches
  // it at every depth, instance arrays included.
  subdomains: {
    replacement: 'targets.web',
    why: "each subdomain is a web INSTANCE (#588): [\"admin\", \"cdn\"] becomes web: [{ id: 'main' }, { id: 'admin' }, { id: 'cdn' }], where the id IS the subdomain (https://admin.<brand host>), an entry's own `url` overrides it for a custom host, and the subdomains share ONE api.<domain>",
  },

  // The feature is `connections` now (#788, Ian 2026-09-03): a user connection
  // will not always be an OAuth grant — an API key or a bot token is a
  // connection too — so the section, the route, the user-record field, the env
  // prefix and the brand provider folder all carry the product word, and each
  // record names its own kind with `type: 'oauth2'`. A NAME test by the rule
  // above: `oauth2` exists nowhere else in the schema.
  oauth2: {
    replacement: 'connections',
    why: "the product concept is a CONNECTION (#788) — the per-provider block is unchanged, the credentials are the CONNECTIONS_<PROVIDER>_CLIENT_ID/_SECRET env pair now, and a brand's own provider lives at targets/backend/src/connections/<name>.js",
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

  // ─── adsense has ONE switch (#527/#628) ───────────────────────────────
  // The second gate is what let one config say "stop managing" while the site
  // kept serving ads off the same id, so #527 deleted the service's
  // `enabled === false` skip and never shipped the `units` half of the same
  // proposal. Neither was registered here, so a brand still carrying
  // `enabled: false` validated CLEAN — and the account it was meant to leave
  // alone started being managed on the next walk, the gate reading exactly
  // like it still worked.
  'advertising.providers.adsense.enabled': {
    replacement: 'advertising.providers.adsense',
    why: 'adsense has ONE switch (#527): `client` presence manages the account, renders the units and writes the ads.txt record together — set `advertising.providers.adsense: false` to opt the provider out, and there is no second gate to disable it with',
  },
  'advertising.providers.adsense.units': {
    replacement: 'advertising.providers.adsense',
    why: 'adsense has ONE switch (#527): the render gate the key proposed was refused — `client` presence is the whole answer, so a managed-but-ad-free brand omits the block and manages the account by hand',
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

  // ─── a page's TITLE and DESCRIPTION live in page frontmatter (#607/#564) ──
  // The config `meta` section shipped for one wave as the site's default page
  // meta, beside the bare `meta:` a page and a layout already wrote — two homes
  // for one fact, free to disagree. Ian's 2026-08-26 ruling deleted the copy
  // that could not win: the head walk is page `meta:` → layout `meta:` →
  // brand.name / brand.description, so a title or description left in
  // omega.json5 reaches NOTHING and every page silently falls back to the brand.
  //
  // `index` is the exception, and #564 (Ian 2026-09-09, the same-name ruling in
  // docs/shared/rulings.md) is why the rows are per KEY now rather than on the
  // whole block: a site-wide default and the page override of it share ONE name
  // at every level, so the site default is `targets.web.meta.index` and the page
  // writes `meta.index`. That key is LIVE, and it overlays to the resolved root
  // on a web load like every target key, and a row on the whole `meta` object would
  // fire on a brand that is simply using it.
  //
  // Matched at AUTHORED paths, never by key NAME: `analytics.providers.meta` is
  // a legitimate key one level down.
  'meta.title': {
    replacement: 'brand.name (and the page\'s own frontmatter `meta.title`)',
    why: 'a title never exists in two places (#607): page frontmatter `meta:` is the only per-page meta, and the site-wide default is the brand block the head falls back to',
  },
  'meta.description': {
    replacement: 'brand.description (and the page\'s own frontmatter `meta.description`)',
    why: 'a description never exists in two places (#607): page frontmatter `meta:` is the only per-page meta, and the site-wide default is the brand block the head falls back to',
  },
  'targets.web.meta.title': {
    replacement: 'brand.name (and the page\'s own frontmatter `meta.title`)',
    why: 'a title never exists in two places (#607): @omega.js/web reads no site-wide title; a per-page title belongs in that page\'s own frontmatter',
  },
  'targets.web.meta.description': {
    replacement: 'brand.description (and the page\'s own frontmatter `meta.description`)',
    why: 'a description never exists in two places (#607): @omega.js/web reads no site-wide description; a per-page description belongs in that page\'s own frontmatter',
  },

  // ─── one index flag, one name at both levels (#564) ────────────────────
  // #725 gave the site-wide noindex its own name, `seo.index`, while a page
  // said `meta.index`, one decision spelled two ways, which is the defect
  // Ian's 2026-09-09 same-name ruling names. The site default is now the same
  // key the page writes, under the target that reads it.
  'seo.index': {
    replacement: 'targets.web.meta.index',
    why: 'a global value and its specific override share ONE name (#564, Ian 2026-09-09): the site-wide default is `targets.web.meta.index` and a page overrides it with `meta.index` in its own frontmatter; `seo` keeps `enabled` and `github.content`',
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

  // ─── redirects are not web config (#466) ──────────────────────────────
  // The block shipped for one wave (0.45.0) and was withdrawn: static hosting
  // has no server, so the map could only be answered CLIENT-side off the built
  // 404 page — a search engine saw a 404 that redirects, never a move. A
  // TEMPLATED redirect genuinely needs edge computing and is a Cloudflare
  // redirect rule; an enumerable one is a redirect PAGE. Matched at its
  // AUTHORED path, the one place a carrying brand has it.
  'targets.web.redirects': {
    replacement: 'edge.providers.cloudflare.rules.redirect',
    why: 'redirects are not web config (#466) — a TEMPLATED redirect (/c/:id → /code?id=:id) is a Cloudflare redirect rule the edge service reconciles, and a redirect whose URLs can be enumerated is a PAGE on the `modules/utilities/redirect` layout with `redirect.url` in its frontmatter',
  },

  // ─── the bundler has no consumer override (#737) ──────────────────────
  // Desktop moved off webpack and the externals knob went with it: esbuild's
  // externals set is the framework's own native-module list plus whatever the
  // consumer's package.json declares from it, resolved at build time. Nothing
  // reads the key any more — and it sits inside the `targets` namespace the
  // undeclared-key warning EXEMPTS, so without a row here a brand still
  // carrying it validates completely clean and silently loses the setting.
  // Matched at its AUTHORED path, the one place a carrying brand has it.
  'targets.desktop.em.webpack.externals': {
    replacement: 'nothing — the externals set is framework-owned',
    why: "the desktop bundler is esbuild (#737) and there is no consumer-facing override key: the externals set is the framework's native-module list (`nativeExternals` in @omega.js/desktop's src/gulp/tasks/bundle.js) plus what the consumer's own package.json declares from it, so a genuinely native module the list misses is raised upstream and every brand gets the fix",
  },

  // ─── one features catalog, one values map (#647) ───────────────────────
  // A metered feature used to be spelled twice on every product — a number in
  // `limits` and a display row in the `features` ARRAY — and its PACING was a
  // product-wide `rateLimit` that no single feature could opt out of. The
  // catalog defines each feature once (name, icon, definition, and the `usage`
  // block that meters it) and a product names only its value, so a limit and
  // the row that renders it can no longer disagree. Matched at their AUTHORED
  // paths: `limits` is a legitimate word elsewhere, so this is not a name test.
  'payment.products.limits': {
    replacement: 'payment.products[].features',
    why: 'a product names one VALUE per feature (#647) — `limits: { saves: 100 }` becomes `features: { saves: 100 }`, and the feature itself (name, icon, definition, pacing, mirrors) is defined once in the top-level `features` catalog',
  },
  'payment.products.rateLimit': {
    replacement: 'features.<id>.usage.pace',
    why: 'pacing is per FEATURE now (#647) — day pacing is the default on every counted feature, and `usage: { pace: false }` on the catalog entry is the opt-out the product-wide `rateLimit: "monthly"` used to be',
  },

  // ─── one releases repo, no mirror (#620/#799) ──────────────────────────
  // The `download-server` mirror existed to give marketing a fixed filename,
  // which the versionless artifact names (#620) made free: the site links the
  // releases repo directly and reads nothing from the mirror. #799 deleted the
  // lane (gulp/mirror-downloads, the finalize-release mirror step, the repo
  // provisioning), so a brand still carrying the block gets a second repo
  // provisioned and nothing published to it. Matched at their AUTHORED paths,
  // one row per key: `downloads` is a legitimate word elsewhere (the curated
  // site.targets.desktop.downloads map is the derived direct-download links),
  // so this is not a name test.
  'targets.desktop.downloads.enabled': {
    replacement: 'targets.desktop.releases',
    why: 'one public releases repo per brand (#620/#799): the fixed-name mirror is gone, and the versionless assets on the releases repo ARE the permanent download links',
  },
  'targets.desktop.downloads.owner': {
    replacement: 'targets.desktop.releases.owner',
    why: 'one public releases repo per brand (#620/#799): there is no second repo to own, and the releases owner defaults to the brand repo owner',
  },
  'targets.desktop.downloads.repo': {
    replacement: 'targets.desktop.releases.repo',
    why: 'one public releases repo per brand (#620/#799): the release artifacts and the marketing downloads are the same assets in `<brand.id>-releases`',
  },
  'targets.desktop.downloads.tag': {
    replacement: 'nothing: the versionless assets live on the `v<x.y.z>` release',
    why: 'one public releases repo per brand (#620/#799): a stable mirror tag is what `/releases/latest/download/<asset>` replaced, so no tag is configured anywhere',
  },
};

// A multi-instance target is an ARRAY, so the walked path carries the position
// (`targets.web.0.meta`) while every RETIRED_PATHS row names the shape
// (`targets.web.meta`) — without this, each `targets.<type>.*` row missed the
// array form outright (#732). Matching only: the REPORTED path keeps the index,
// which is where the author finds the key.
function withoutIndices(keyPath) {
  return keyPath.split('.').filter((segment) => !/^\d+$/.test(segment)).join('.');
}

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

    const shapePath = withoutIndices(keyPath);

    if (RETIRED_PATHS[shapePath]) {
      found.push({ path: keyPath, key, ...RETIRED_PATHS[shapePath] });
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
