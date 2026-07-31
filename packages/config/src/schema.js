/**
 * Canonical schema for config/omega.json5 — pure data, no logic.
 *
 * Entry format is electron-manager's proven src/config/schema.js shape:
 *
 *   {
 *     path:        'brand.id',            // dot-path into the RESOLVED config
 *     type:        'string' | 'boolean' | 'number' | 'array' | 'object',
 *     required:    true | false | (config) => bool,
 *     match:       RegExp,                // only checked when value present + string
 *     enum:        [...],                 // only checked when value present
 *     description: 'What the field drives.',
 *   }
 *
 * Rules run against the RESOLVED config for a target — target-section keys
 * are overlaid at the top level by loadConfig() (targets.desktop.platforms
 * validates as `platforms`), which is also how any shared key inside a
 * target entry overrides the shared value.
 *
 * SHARED_SCHEMA always applies; TARGET_SCHEMAS[target] adds that target's
 * refinements. Sections grow as each framework adopts dual-read — seed
 * entries come from EM's schema (desktop) and the sandbox brand's real @omega.js/backend
 * config (backend), never from guesses.
 */

// Canonical target names — the only keys allowed under `targets`.
// Key presence in a config's `targets` object = "this brand enables this
// target" (absorbs the legacy brand-config targets ARRAY).
const TARGETS = ['web', 'backend', 'desktop', 'extension', 'mobile'];

// The machine-owned top-level sections identical in every omega.json5 —
// omega-manager's disperse enumerates THIS list instead of hardcoding
// per-target mapping blocks. (`targets` itself is the scoping key, not a
// shared section; `theme` is project-owned but shared-shaped.)
const SHARED_SECTIONS = ['brand', 'cloud', 'repo', 'edge', 'captcha', 'search', 'forms', 'inbound', 'analytics', 'advertising', 'payment', 'monitoring', 'oauth2', 'theme', 'translation'];

const SHARED_SCHEMA = [
  // ── brand ────────────────────────────────────────────────────────────────
  {
    path:        'brand.id',
    type:        'string',
    required:    true,
    match:       /^[a-z][a-z0-9+\-.]*$/,
    description: 'URL-scheme-safe slug. Drives deep-link schemes, default appIds, repo names. Lowercase, starts with a letter, alnum/+/-/.',
  },
  {
    path:        'brand.name',
    type:        'string',
    required:    true,
    description: 'Human-readable brand name. Default productName/site title everywhere.',
  },
  {
    path:        'brand.url',
    type:        'string',
    required:    false,
    match:       /^https?:\/\//,
    description: 'Marketing site URL. Derives remote-config URLs, "Open Website" menu items, hosting boilerplate links.',
  },
  {
    path:        'brand.description',
    type:        'string',
    required:    false,
    description: 'One-sentence brand description. Meta descriptions, store listings.',
  },
  {
    path:        'brand.tagline',
    type:        'string',
    required:    false,
    description: 'Short marketing tagline.',
  },
  {
    path:        'brand.company',
    type:        'string',
    required:    false,
    description: 'Parent/legal entity name ("Acme Inc"). Legal documents, receipts; falls back to brand.name.',
  },
  {
    path:        'brand.contact.email',
    type:        'string',
    required:    false,
    match:       /@/,
    description: 'Support email surfaced in About / Help / legal pages.',
  },
  {
    path:        'brand.contact.person.name',
    type:        'string',
    required:    false,
    description: 'The human who signs "personal" emails, as it should read ("Jane Doe, CEO"). Required only when something sends a personal-signoff email — that path fails loudly rather than substituting a framework identity.',
  },
  {
    path:        'brand.contact.person.firstName',
    type:        'string',
    required:    false,
    description: 'Conversational short name for personal email copy ("Jane" in "I\'m Jane, the founder"). Defaults to the first word of brand.contact.person.name.',
  },
  {
    path:        'brand.contact.person.image',
    type:        'string',
    required:    false,
    description: 'Headshot URL for the personal email signoff. Omitted from the signoff when unset.',
  },
  {
    path:        'brand.contact.person.url',
    type:        'string',
    required:    false,
    match:       /^https?:\/\//,
    description: 'Personal URL linked from the email signoff. Omitted when unset.',
  },
  {
    path:        'brand.contact.person.urlText',
    type:        'string',
    required:    false,
    description: 'Link text for brand.contact.person.url (e.g. a social handle). Falls back to the URL itself.',
  },
  {
    path:        'brand.contact.carbonCopy',
    type:        'array',
    required:    false,
    description: 'Audit BCC recipients ([{ email, name }]) added to transactional sends with copy: true. Unset = no audit copies; never a framework default.',
  },
  {
    path:        'brand.address',
    type:        'object',
    required:    false,
    description: 'Postal address (line1, line2, city, region, postalCode, country). Legal pages + email footers.',
  },
  {
    path:        'brand.images',
    type:        'object',
    required:    false,
    description: 'Brand image URLs/paths (wordmark, brandmark, combomark, icon).',
  },
  {
    path:        'brand.images.companyWordmark',
    type:        'string',
    required:    false,
    description: 'Parent/legal-entity wordmark (brand.company) rendered in the transactional email footer. Omitted from the footer when unset.',
  },

  // ── cloud (role: app/cloud platform; D12 provider-discriminated) ─────────
  {
    path:        'cloud.provider',
    type:        'string',
    required:    false,
    enum:        ['firebase'],
    description: "App/cloud platform provider. Only 'firebase' today — the discriminator exists so a second provider slots in without a key rename.",
  },
  {
    path:        'cloud.config',
    type:        'object',
    required:    false,
    description: 'Provider app config. For firebase: the web-app config verbatim from the console. Public by design — the web API key is not a secret.',
  },
  {
    path:        'cloud.config.projectId',
    type:        'string',
    required:    false,
    description: 'Drives auth, emulator project selection, analytics uuidv5 namespace, remote-config URL fallbacks.',
  },
  {
    path:        'cloud.messaging.vapidKey',
    type:        'string',
    required:    false,
    description: 'Web-push VAPID public key (Firebase console → Cloud Messaging → Web Push certificates). Public by design — it ships to every browser; the private half stays in the console.',
  },
  {
    path:        'cloud.shared',
    type:        'boolean',
    required:    false,
    description: 'true = the cloud project is shared with other brands; only per-brand operations run (service-account, sdk-config).',
  },
  {
    path:        'cloud.supportEmail',
    type:        'string',
    required:    false,
    match:       /@/,
    description: "OAuth consent screen support email. Defaults to the AUTHORIZING user's email — the provider rejects any address the caller doesn't own; set only for an owned Google Group.",
  },
  {
    path:        'cloud.apiSubdomain',
    type:        'boolean',
    required:    false,
    description: 'false = skip the api.{domain} hosting custom domain.',
  },
  {
    path:        'cloud.organizationId',
    type:        'string|boolean',
    required:    false,
    description: 'Cloud organization ID the project is created inside — tri-state: unset = ask at project create, false = no org (standalone), value = create inside it.',
  },
  {
    path:        'cloud.billingAccount',
    type:        'string|boolean',
    required:    false,
    description: "Billing account ('billingAccounts/XXXXXX-XXXXXX-XXXXXX') — tri-state: unset = ask, false = stay on the free tier, value = auto-upgrade.",
  },

  // ── analytics ────────────────────────────────────────────────────────────
  {
    path:        'analytics.providers.google.id',
    type:        'string',
    required:    false,
    match:       /^G-[A-Z0-9]+$/,
    description: 'GA4 Measurement ID. Presence-driven: set G-XXXXXXXXXX to enable. Secret lives in process.env.GOOGLE_ANALYTICS_SECRET.',
  },
  {
    path:        'analytics.providers.meta.id',
    type:        'string',
    required:    false,
    description: 'Meta (Facebook) Pixel ID. Presence-driven.',
  },
  {
    path:        'analytics.providers.tiktok.id',
    type:        'string',
    required:    false,
    description: 'TikTok Pixel ID. Presence-driven.',
  },

  // ── advertising ──────────────────────────────────────────────────────────
  {
    path:        'advertising.providers.adsense.client',
    type:        'string',
    required:    false,
    description: 'AdSense publisher client id (ca-pub-…). Presence-driven: set to enable ad units.',
  },
  {
    path:        'advertising.providers.adsense.displaySlot',
    type:        'string',
    required:    false,
    description: 'Default AdSense slot id for display units (per-include override wins).',
  },
  {
    path:        'advertising.providers.adsense.inArticleSlot',
    type:        'string',
    required:    false,
    description: 'Default AdSense slot id for in-article units.',
  },
  {
    path:        'advertising.providers.adsense.inFeedSlot',
    type:        'string',
    required:    false,
    description: 'Default AdSense slot id for in-feed units.',
  },
  {
    path:        'advertising.providers.adsense.multiplexSlot',
    type:        'string',
    required:    false,
    description: 'Default AdSense slot id for multiplex units.',
  },
  {
    path:        'advertising.providers.inhouse.source',
    type:        'string',
    required:    false,
    description: "In-house ads source: 'self' (this brand's backend serves its own `ads` inventory), 'company' (the parent company's api — resolved via company.url), or a full base URL used verbatim. Presence-driven — unset disables house units.",
  },

  // ── company ──────────────────────────────────────────────────────────────
  {
    path:        'company.url',
    type:        'string',
    required:    false,
    match:       /^https?:\/\//,
    description: "The parent company's canonical URL. Sub-brand surfaces derive the company api from it (e.g. advertising inhouse source 'company' → api.<company host>).",
  },

  // ── payment ──────────────────────────────────────────────────────────────
  {
    path:        'payment.processors.stripe.publishableKey',
    type:        'string',
    required:    false,
    match:       /^pk_(test|live)_/,
    description: 'Stripe publishable key. Lives in config (not secret); the secret key stays in env.',
  },
  {
    path:        'payment.processors.paypal.clientId',
    type:        'string',
    required:    false,
    description: 'PayPal client ID. Lives in config; secret stays in env.',
  },
  {
    path:        'payment.processors.chargebee.site',
    type:        'string',
    required:    false,
    description: 'Chargebee site slug.',
  },
  {
    path:        'payment.products',
    type:        'array',
    required:    false,
    description: 'Product catalog (@omega.js/backend-shaped: id, name, type, limits, prices, per-processor IDs) — referenceable from every target. The ONLY pricing-page source (C2); optional presentation fields: tagline, popular, url, features [{ id, name, icon, definition, value }].',
  },

  // ── monitoring (role: error monitoring; D12 provider-discriminated) ──────
  {
    path:        'monitoring.provider',
    type:        'string',
    required:    false,
    enum:        ['sentry'],
    description: "Error-monitoring provider. Only 'sentry' today.",
  },
  {
    path:        'monitoring.org',
    type:        'string',
    required:    false,
    description: 'Sentry organization slug (public). Auto-detected when the auth token sees exactly one org — the sentry service writes it back here.',
  },
  {
    path:        'monitoring.dsn',
    type:        'string',
    required:    false,
    match:       /^https?:\/\//,
    description: 'Sentry DSN (public by design). Per-surface DSNs go in targets.<type>.monitoring.dsn overrides.',
  },

  // ── oauth2 ───────────────────────────────────────────────────────────────
  {
    path:        'oauth2',
    type:        'object',
    required:    false,
    description: 'Public OAuth client IDs only — never client secrets.',
  },

  // ── repo (role: source hosting; provider-discriminated) ─────────────────
  {
    path:        'repo.providers.github.org',
    type:        'string',
    required:    false,
    description: "GitHub org/user the brand monorepo lives in. No org → the repo service skips and the site's desktop release URLs stay underived.",
  },
  {
    path:        'repo.providers.github.repo',
    type:        'string',
    required:    false,
    description: 'Brand repo name, or an "owner/name" slug when the repo lives under a different org than repo.providers.github.org. Defaults to brand.id.',
  },
  {
    path:        'repo.providers.github.shared',
    type:        'boolean',
    required:    false,
    description: 'true = the org is shared with other brands; org-level reconciliation is skipped.',
  },
  {
    path:        'repo.providers.github.private',
    type:        'boolean',
    required:    false,
    description: 'Brand repo visibility (default true).',
  },

  // ── edge (role: CDN/DNS edge; provider-discriminated) ────────────────────
  {
    path:        'edge.providers.cloudflare',
    type:        'object',
    required:    false,
    description: 'Cloudflare zone reconciliation (@omega.js/manager cloudflare service): dns, settings, rules, cacheRules, speedTest, workers. Tokens live in .env.',
  },
  {
    path:        'edge.providers.cloudflare.zone',
    type:        'string',
    required:    false,
    description: "Cloudflare zone id. The web build's cache purge (`omega purge`) targets it; unset = purge skips.",
  },

  // ── captcha (role: bot defense; provider-discriminated) ──────────────────
  {
    path:        'captcha.providers.recaptcha.project',
    type:        'string',
    required:    false,
    description: "The brand's OWN GCP project hosting the classic reCAPTCHA key — used only for the console deep-link in guidance. Site/secret keys stay in .env.",
  },
  {
    path:        'captcha.providers.recaptcha.siteKey',
    type:        'string',
    required:    false,
    description: 'Classic reCAPTCHA site key rendered client-side. Public by design — the secret half stays in .env (RECAPTCHA_SECRET_KEY).',
  },

  // ── forms (role: form handling; provider-discriminated) ──────────────────
  {
    path:        'forms.providers.slapform.enabled',
    type:        'boolean',
    required:    false,
    description: 'false = the slapform service skips and the contact page has no form endpoint.',
  },
  {
    path:        'forms.providers.slapform.formId',
    type:        'string',
    required:    false,
    description: 'Slapform form id — the contact page posts to https://api.slapform.com/{formId}. Interactive manager runs land it here.',
  },
  {
    path:        'forms.providers.slapform.templateFormId',
    type:        'string',
    required:    false,
    description: 'Existing form the new form is cloned from when the service creates one.',
  },
  {
    path:        'forms.providers.slapform.updateFormInfo',
    type:        'boolean',
    required:    false,
    description: 'false = the form is shared and managed by another brand; its name/settings are left alone.',
  },
  {
    path:        'forms.providers.slapform.plan',
    type:        'object',
    required:    false,
    description: 'Tier granted to the form-owner account ({ id, name }) — Slapform-operator only.',
  },

  // ── inbound (role: inbound conversations; per-channel providers) ─────────
  {
    path:        'inbound.chat.providers.chatsy.enabled',
    type:        'boolean',
    required:    false,
    description: 'false = no chat widget boots and the chatsy service skips.',
  },
  {
    path:        'inbound.chat.providers.chatsy.agentId',
    type:        'string',
    required:    false,
    description: 'Chatsy agent id. The manager writes it back here; @omega.js/client boots the widget from it.',
  },
  {
    path:        'inbound.chat.providers.chatsy.templateAgentId',
    type:        'string',
    required:    false,
    description: 'Existing agent the new agent is cloned from when the service creates one.',
  },
  {
    path:        'inbound.chat.providers.chatsy.updateAgentInfo',
    type:        'boolean',
    required:    false,
    description: 'false = the agent is shared and managed by another brand; its settings/knowledge are left alone.',
  },
  {
    path:        'inbound.chat.providers.chatsy.plan',
    type:        'object',
    required:    false,
    description: 'Tier granted to the agent-owner account ({ id, name }) — Chatsy-operator only.',
  },
  {
    path:        'inbound.chat.providers.chatsy.sponsorshipsUrl',
    type:        'string',
    required:    false,
    description: "Sponsorship page the baseline knowledge points at. Unset → {website}/contact.",
  },
  {
    path:        'inbound.chat.providers.chatsy.settings',
    type:        'object',
    required:    false,
    description: 'Widget presentation settings passed verbatim to the Chatsy SDK by @omega.js/client.',
  },
  {
    path:        'inbound.email.providers.replyify.enabled',
    type:        'boolean',
    required:    false,
    description: 'false = the replyify service skips.',
  },
  {
    path:        'inbound.email.providers.replyify.agentId',
    type:        'string',
    required:    false,
    description: 'Replyify agent id. Interactive manager runs land it here.',
  },
  {
    path:        'inbound.email.providers.replyify.templateAgentId',
    type:        'string',
    required:    false,
    description: 'Existing agent the new agent is cloned from when the service creates one.',
  },
  {
    path:        'inbound.email.providers.replyify.updateAgentInfo',
    type:        'boolean',
    required:    false,
    description: 'false = the agent is shared and managed by another brand; its filter/knowledge are left alone.',
  },
  {
    path:        'inbound.email.providers.replyify.plan',
    type:        'object',
    required:    false,
    description: 'Tier granted to the agent-owner account ({ id, name }) — Replyify-operator only.',
  },
  {
    path:        'inbound.email.providers.replyify.discount',
    type:        'object',
    required:    false,
    description: 'Discount the baseline knowledge offers ({ code, label }). Unset = no discount section.',
  },

  // ── search (role: search-engine surfaces; provider-discriminated) ────────
  {
    path:        'search.providers.searchConsole.submitSitemap',
    type:        'boolean',
    required:    false,
    description: 'false = skip sitemap submission to Google Search Console.',
  },
  {
    path:        'search.providers.searchConsole.sitemapPaths',
    type:        'array',
    required:    false,
    description: "Sitemap paths submitted as https://{domain}{path} (default ['/sitemap.xml']).",
  },

  // ── devlog ───────────────────────────────────────────────────────────────
  {
    path:        'devlog',
    type:        'object',
    required:    false,
    description: 'Commit-digest devlog pipeline (@omega.js/manager devlog): enabled, orgs, lookbackDays, publish settings.',
  },

  // ── seo ──────────────────────────────────────────────────────────────────
  {
    path:        'seo',
    type:        'object',
    required:    false,
    description: 'Parasite-SEO content (@omega.js/manager seo service): seo.github.content repos. Big content blocks may live in the config/seo.json5 sidecar.',
  },

  // ── account ──────────────────────────────────────────────────────────────
  {
    path:        'account',
    type:        'object',
    required:    false,
    description: "Managed Firebase Auth accounts (@omega.js/manager account service): enabled + admins ([{ email, account, marketing }]; '{domain}' templates to the brand domain). Owner-defined — typically set once in the COMPANY omega.json5 (arrays replace, so the company list wins whole). Passwords NEVER live here: per-account OMEGA_ACCOUNT_PASSWORD__* env vars, the config/hooks/account/password.js hook, or the ACCOUNT_PASSWORD_SEED derivation.",
  },

  // ── ports (dev-only) ─────────────────────────────────────────────────────
  {
    path:        'ports',
    type:        'object',
    required:    false,
    description: 'Explicit dev-port pins (N7). Unset ports auto-allocate (classic defaults, bump-if-taken); a pinned port never bumps — busy pin is a hard error. Keys: auth, functions, firestore, database, hosting, storage, pubsub, ui, website, livereload, cdp. Dev/emulator only — production never reads this.',
  },

  // ── theme ────────────────────────────────────────────────────────────────
  {
    path:        'theme.id',
    type:        'string',
    required:    false,
    description: "Theme id (seeded 'classy' at onboarding). Project-owned — the manager never overwrites it.",
  },
  {
    path:        'theme.appearance',
    type:        'string',
    required:    false,
    enum:        ['system', 'light', 'dark'],
    description: "Default appearance. 'system' follows the OS; a user's runtime choice persists in storage and wins.",
  },

  // ── translation ──────────────────────────────────────────────────────────
  {
    path:        'translation.enabled',
    type:        'boolean',
    required:    false,
    description: 'Master switch (default true). Translation only runs when languages is non-empty.',
  },
  {
    path:        'translation.default',
    type:        'string',
    required:    false,
    description: "Source language code (default 'en'). Drives <html lang>, og:locale, and the default hreflang.",
  },
  {
    path:        'translation.languages',
    type:        'array',
    required:    false,
    description: "Target language codes (e.g. ['es', 'fr']). Empty/absent = translation off. Validated against @omega.js/devkit/translate's language SSOT.",
  },
  {
    path:        'translation.provider',
    type:        'string',
    required:    false,
    enum:        ['claude', 'chatgpt'],
    description: "AI translation provider. 'claude' (default) rides the local Claude Code install — no API key; 'chatgpt' uses the OpenAI API via OPENAI_API_KEY in env.",
  },
  {
    path:        'translation.model',
    type:        'string',
    required:    false,
    description: "Model override for the provider (defaults: claude → 'sonnet' alias, chatgpt → 'gpt-5.4-nano').",
  },
  {
    path:        'translation.exclude',
    type:        'array',
    required:    false,
    description: 'Web only: extra page paths/folders to skip (system pages like checkout/legal/auth are always skipped).',
  },

  // ── targets ──────────────────────────────────────────────────────────────
  {
    path:        'targets',
    type:        'object',
    required:    false,
    description: 'Key presence = target enabled; values = target-scoped config (any shared key inside overrides it) — an object, or an array of id\'d instances (multi-instance targets). Unknown keys are errors.',
  },
];

// Per-target refinements — validated against the RESOLVED config (the target
// section's keys land at the top level).
const TARGET_SCHEMAS = {
  // Grows with @omega.js/web's design: distribute, purgecss safelist,
  // workflows land as their features do.
  web: [
    {
      path:        'imagemin',
      type:        'object',
      required:    false,
      description: 'Responsive image matrix (build-time 320/640/1024 + webp, quality 80). `enabled: false` ships images verbatim.',
    },
  ],

  // Seeded from the sandbox brand's real @omega.js/backend config (backend-manager-config.json).
  backend: [
    {
      path:        'parent',
      type:        'string|boolean',
      required:    false,
      description: "Webhook parent topology: 'self' when this brand IS the parent, a parent URL otherwise, or false to deliberately opt out (shared webhook account owned elsewhere).",
    },
    {
      path:        'github',
      type:        'object',
      required:    false,
      description: 'GitHub identity for the brand (user, website repo URL).',
    },
    {
      path:        'reviews',
      type:        'object',
      required:    false,
      description: 'Review-collection settings (enabled, sites).',
    },
    {
      path:        'marketing',
      type:        'object',
      required:    false,
      description: 'Marketing automation: campaigns, newsletter (Beehiiv), prune.',
    },
    {
      path:        'blog',
      type:        'object',
      required:    false,
      description: 'AI blog-content settings (Ghostii pipeline).',
    },
    {
      path:        'dataRequest',
      type:        'object',
      required:    false,
      description: 'GDPR/CCPA data-request query definitions.',
    },
  ],

  // Seeded from EM's proven src/config/schema.js. EM's per-OS `targets` key
  // is renamed `platforms` here (avoids targets.desktop.targets).
  desktop: [
    {
      path:        'app.category',
      type:        'string',
      required:    false,
      enum:        ['productivity', 'developer-tools', 'utilities', 'media', 'social', 'network'],
      description: 'Generic high-level category. Maps to per-platform UTI + freedesktop strings.',
    },
    {
      path:        'platforms.win.signing.strategy',
      type:        'string',
      required:    false,
      enum:        ['self-hosted', 'cloud', 'local'],
      description: 'Windows code-signing path. self-hosted = EV USB token on a runner; cloud = provider CLI; local = developer signs manually.',
    },
    {
      path:        'startup.mode',
      type:        'string',
      required:    false,
      enum:        ['normal', 'hidden'],
      description: 'normal = main window appears at launch; hidden = bakes LSUIElement=true on macOS (no dock, no Cmd+Tab).',
    },
    {
      path:        'cdp.readySignal',
      type:        'string',
      required:    false,
      description: 'Boot-complete signal for `mgr cdp relaunch` — a URL substring matched against CDP page targets.',
    },
    {
      path:        'releases.enabled',
      type:        'boolean',
      required:    false,
      description: 'One switch for the release surface: false suppresses the site\'s derived download links AND desktop publishing (electron-builder publish). Site derivation defaults true only when the releases block exists; desktop publishing defaults true regardless.',
    },
    {
      path:        'releases.repo',
      type:        'string',
      required:    false,
      description: 'GitHub repo where built artifacts + the auto-update feed live.',
    },
    {
      path:        'restartManager.enabled',
      type:        'boolean',
      required:    false,
      description: 'External guardian app that relaunches this app on crash. Default true; false disables entirely.',
    },
    {
      path:        'restartManager.feed.owner',
      type:        'string',
      required:    false,
      match:       /^[A-Za-z0-9-]+$/,
      description: 'GitHub owner of the RM release feed. Override for forks/mirrors.',
    },
    {
      path:        'restartManager.feed.repo',
      type:        'string',
      required:    false,
      match:       /^[\w.-]+$/,
      description: 'GitHub repo of the RM release feed.',
    },
    {
      path:        'remoteScripts.enabled',
      type:        'boolean',
      required:    false,
      description: 'Emergency remote code execution in the main process — OPT-IN: only `true` arms the lane, anything else leaves it inert.',
    },
    {
      path:        'remoteScripts.url',
      type:        'string',
      required:    false,
      match:       /^https?:\/\//,
      description: 'Remote-script source override (default `${brand.url}/data/scripts/main.js`). https-only at runtime — a cleartext URL is refused (localhost excepted for dev).',
    },
    {
      path:        'restartManager.feed.url',
      type:        'string',
      required:    false,
      match:       /^https?:\/\//,
      description: 'Full base-URL override for the RM feed + artifacts (air-gapped mirrors). Wins over feed.owner/repo.',
    },
  ],

  // Store listings drive the extension page's site.extension map and the
  // curated site.targets.extension view (#85).
  extension: [
    {
      path:        'listings.chrome.url',
      type:        'string',
      required:    false,
      match:       /^https?:\/\//,
      description: 'Chrome Web Store listing URL. Feeds site.extension.chrome on the extension page.',
    },
    {
      path:        'listings.chrome.state',
      type:        'string',
      required:    false,
      description: 'Listing state note (e.g. live, pending review). Display-safe, informational only.',
    },
    {
      path:        'listings.firefox.url',
      type:        'string',
      required:    false,
      match:       /^https?:\/\//,
      description: 'Firefox Add-ons (AMO) listing URL. Feeds site.extension.firefox.',
    },
    {
      path:        'listings.firefox.state',
      type:        'string',
      required:    false,
      description: 'Listing state note (e.g. live, pending review). Display-safe, informational only.',
    },
    {
      path:        'listings.edge.url',
      type:        'string',
      required:    false,
      match:       /^https?:\/\//,
      description: 'Microsoft Edge Add-ons listing URL. Feeds site.extension.edge.',
    },
    {
      path:        'listings.edge.state',
      type:        'string',
      required:    false,
      description: 'Listing state note (e.g. live, pending review). Display-safe, informational only.',
    },
    {
      path:        'listings.opera.url',
      type:        'string',
      required:    false,
      match:       /^https?:\/\//,
      description: 'Opera Add-ons listing URL. Feeds site.extension.opera.',
    },
    {
      path:        'listings.opera.state',
      type:        'string',
      required:    false,
      description: 'Listing state note (e.g. live, pending review). Display-safe, informational only.',
    },
    {
      path:        'listings.safari.url',
      type:        'string',
      required:    false,
      match:       /^https?:\/\//,
      description: 'App Store (Safari extension) listing URL. Feeds site.extension.safari.',
    },
    {
      path:        'listings.safari.state',
      type:        'string',
      required:    false,
      description: 'Listing state note (e.g. live, pending review). Display-safe, informational only.',
    },
    {
      path:        'listings.brave.url',
      type:        'string',
      required:    false,
      match:       /^https?:\/\//,
      description: 'Brave listing URL (Chrome Web Store serves Brave). Feeds site.extension.brave.',
    },
    {
      path:        'listings.brave.state',
      type:        'string',
      required:    false,
      description: 'Listing state note (e.g. live, pending review). Display-safe, informational only.',
    },
  ],

  // RESERVED — MAM is parked for a separate overhaul; schema slot only.
  mobile: [],
};

module.exports = { TARGETS, SHARED_SECTIONS, SHARED_SCHEMA, TARGET_SCHEMAS };
