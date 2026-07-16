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
const SHARED_SECTIONS = ['brand', 'cloud', 'analytics', 'advertising', 'payment', 'monitoring', 'oauth2', 'theme', 'translation'];

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
    path:        'advertising.providers.google-adsense.client',
    type:        'string',
    required:    false,
    description: 'AdSense publisher client id (ca-pub-…). Presence-driven: set to enable ad units.',
  },
  {
    path:        'advertising.providers.google-adsense.display-slot',
    type:        'string',
    required:    false,
    description: 'Default AdSense slot id for display units (per-include override wins).',
  },
  {
    path:        'advertising.providers.google-adsense.in-article-slot',
    type:        'string',
    required:    false,
    description: 'Default AdSense slot id for in-article units.',
  },
  {
    path:        'advertising.providers.google-adsense.in-feed-slot',
    type:        'string',
    required:    false,
    description: 'Default AdSense slot id for in-feed units.',
  },
  {
    path:        'advertising.providers.google-adsense.multiplex-slot',
    type:        'string',
    required:    false,
    description: 'Default AdSense slot id for multiplex units.',
  },
  {
    path:        'advertising.providers.inhouse.serverUrl',
    type:        'string',
    required:    false,
    description: 'In-house ad server base URL (serves /verts/main; the AdSense-unfilled fallback and `type: custom` units). Presence-driven — unset disables in-house ads.',
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
    description: "Theme id (seeded 'classy' at onboarding). Project-owned — omega-manager never overwrites it.",
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
    description: 'Key presence = target enabled; values = target-scoped config (any shared key inside overrides it). Unknown keys are errors.',
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
      path:        'restartManager.feed.url',
      type:        'string',
      required:    false,
      match:       /^https?:\/\//,
      description: 'Full base-URL override for the RM feed + artifacts (air-gapped mirrors). Wins over feed.owner/repo.',
    },
  ],

  // Near-empty at launch by design.
  extension: [],

  // RESERVED — MAM is parked for a separate overhaul; schema slot only.
  mobile: [],
};

module.exports = { TARGETS, SHARED_SECTIONS, SHARED_SCHEMA, TARGET_SCHEMAS };
