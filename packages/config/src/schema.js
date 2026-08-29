/**
 * Canonical schema for config/omega.json5 — pure data, no logic.
 *
 * Entry format is electron-manager's proven src/config/schema.js shape:
 *
 *   {
 *     path:        'brand.id',            // dot-path into the RESOLVED config
 *     type:        'string' | 'boolean' | 'number' | 'integer' | 'array' | 'object',
 *     required:    true | false | (config) => bool,
 *     min:         Number,                // only checked when value present + number
 *     max:         Number,                // only checked when value present + number
 *     match:       RegExp,                // only checked when value present + string
 *     enum:        [...],                 // only checked when value present
 *     default:     <value>,               // the framework answer — see below
 *     pageBare:    true,                  // section root only — see below
 *     description: 'What the field drives.',
 *   }
 *
 * `pageBare:` is the page-override allow-list
 * ([#607](https://github.com/Omega-JS-Stack/omega/issues/607)): a page's
 * frontmatter overrides config keys under a `config:` parent, and a SECTION
 * ROOT rule carrying `pageBare: true` is the exception a page may restate
 * BARE. `meta` is the only one, and a page restating any other section bare
 * is a build error. configSections() below derives the per-target list of
 * top-level sections this schema declares — the namespace `config:` holds.
 *
 * `default:` is the ONE home of every config default
 * ([#478](https://github.com/Omega-JS-Stack/omega/issues/478)): defaults.js
 * builds the merge chain's LOWEST layer from these entries, and the manage
 * walk materializes any missing block into the brand's omega.json5 with this
 * description as its guiding comment. A key with no sane framework answer —
 * owner decisions, tri-states that mean "ask", ids the services provision,
 * anything secret-shaped — carries NO `default:` and is never materialized.
 *
 * The other standing exclusion is the PRESENCE GATE (#425), which means the
 * sections a service reads presence from: `monitoring.providers.sentry` is the
 * brand's pick of Sentry, so those SDK knobs carry NO default and keep their
 * home in @omega.js/monitoring, and `advertising` is the brand's pick of ads
 * (#527 — the adsense `client` id is the ONE switch, and a materialized
 * advertising block would switch the web build's automatic vert placements on
 * for a brand that configured none). Blocks whose services gate on `enabled`
 * instead — github, cloudflare, searchConsole, slapform, chatsy, replyify —
 * DO carry the default that states the polarity (`enabled: true`, read
 * `!== false`), because presence there picks nothing. Role-level switches
 * beside any providers block (`monitoring.enabled`,
 * `marketing.campaigns.enabled`) always may. The gating doctrine those three
 * cases come from lives in docs/shared/config.md.
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

// The durations a winback coupon can be built for on every provider that
// supports the offer (#268). Stripe's third option ('repeating') needs a
// duration_in_months beside it, which is provider surface nothing here asks
// for. It lives HERE, with the rule that enumerates it, so winback.js can
// derive its offer defaults from this schema without a require cycle;
// winback.js re-exports it, so every existing import keeps working.
const WINBACK_DURATIONS = ['once', 'forever'];

// Canonical target names — the FRAMEWORK keys allowed under `targets`.
// Key presence in a config's `targets` object = "this brand enables this
// target" (absorbs the legacy brand-config targets ARRAY).
const TARGETS = ['web', 'backend', 'desktop', 'extension', 'mobile'];

// A brand also runs targets no framework owns — a Render API, a worker, a
// script (#603). Those are declared under any OTHER key, and the entry must
// say so: `targets.api: { type: 'custom' }`. The type is what separates a
// deliberate custom target from a typo'd framework name, which stays an error.
// Their verbs come entirely from the target's own package.json scripts; the
// manager is the one that runs them (docs/manager/index.md).
const CUSTOM_TARGET_TYPE = 'custom';

/**
 * Whether a `targets.<key>` entry declares itself custom. The array
 * (multi-instance) form is custom only when EVERY instance says so — a mixed
 * array has no honest reading, so the validator fails it.
 *
 * @param {object|Array|null|undefined} entry - The raw targets.<key> value.
 * @returns {boolean} True when the entry is a custom target.
 */
function isCustomTargetEntry(entry) {
  if (Array.isArray(entry)) {
    return entry.length > 0 && entry.every((instance) => instance?.type === CUSTOM_TARGET_TYPE);
  }
  return entry?.type === CUSTOM_TARGET_TYPE;
}

// What SHAPE the backend target deploys as (#584). Not to be confused with the
// custom TARGET above: that is a target no framework owns; this is the
// @omega.js/backend target itself, running its Express app on `PORT` for a
// container host (Render & co) instead of exporting Cloud Functions. Same
// framework, same auth middleware, same helpers — a different artifact, and
// with it no Functions deploy and no emulator lane.
const BACKEND_PROJECT_TYPES = ['firebase', 'custom'];

/**
 * The backend target's project type. Reads a `targets.backend` entry or a
 * RESOLVED backend config alike — a target entry's keys land at the top level
 * of the resolved view, so `projectType` is in the same place either way.
 *
 * Anything that isn't the literal 'custom' reads as 'firebase': the validator
 * is what makes a nonsense value loud, and a READER must never take a brand
 * off Cloud Functions on a typo.
 *
 * @param {object|null|undefined} entry - targets.backend, or a resolved backend config.
 * @returns {'firebase'|'custom'}
 */
function backendProjectType(entry) {
  return entry?.projectType === 'custom' ? 'custom' : 'firebase';
}

// The machine-owned top-level sections identical in every omega.json5 —
// omega-manager's disperse enumerates THIS list instead of hardcoding
// per-target mapping blocks. (`targets` itself is the scoping key, not a
// shared section; `theme` is project-owned but shared-shaped.)
const SHARED_SECTIONS = ['brand', 'cloud', 'repo', 'edge', 'captcha', 'search', 'forms', 'inbound', 'analytics', 'advertising', 'payment', 'monitoring', 'oauth2', 'theme', 'translation'];

// brand.id's slug rule — the ONE home for the pattern. Anything that gates a
// caller-supplied brand id (the backend verts routes' normalizeBrandId) imports
// this instead of copying the regex.
const BRAND_ID_PATTERN = /^[a-z][a-z0-9+\-.]*$/;

const SHARED_SCHEMA = [
  // ── brand ────────────────────────────────────────────────────────────────
  {
    path:        'brand.id',
    type:        'string',
    required:    true,
    match:       BRAND_ID_PATTERN,
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
    path:        'brand.type',
    type:        'string',
    required:    false,
    description: "The brand's schema.org type ('Organization', 'Corporation', 'LocalBusiness'). @omega.js/web stamps it on the JSON-LD brand node and every @id that cross-references it; unset renders the framework default 'Organization' (#271).",
  },
  {
    path:        'brand.font',
    type:        'string',
    required:    false,
    description: "Display font NAME (no extension, 'CromaSans-ExtraBold') the assets service renders the wordmark + combomark from, resolved against the brand's assets/fonts/ then the system font dirs. Unset = those two logo variants are skipped, not generated with a substitute face.",
  },
  {
    path:        'brand.contact.email',
    type:        'string',
    required:    false,
    match:       /@/,
    description: 'Support email surfaced in About / Help / legal pages.',
  },
  {
    path:        'brand.contact.phone',
    type:        'string',
    required:    false,
    description: "Support phone number as it should read. @omega.js/web publishes it as the JSON-LD brand node's `telephone`; unset renders empty.",
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
    path:        'brand.color',
    type:        'string',
    required:    false,
    match:       /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
    description: 'Brand accent color as a hex string (#RGB or #RRGGBB). @omega.js/web composes the --omega-accent ramps (light + dark) from it; unset leaves the theme\'s neutral placeholder standing.',
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

  // ── meta (the site's default page meta — the ONE page-bare section) ──────
  // #607: a page's `meta:` block is the SITE default's page-level override,
  // and `meta` is the only config section a page may restate BARE
  // (`pageBare: true`); every other section a page overrides goes under
  // `config:`. Merge order @omega.js/web renders: page `meta:` → layout `meta`
  // defaults → this block → brand.name/brand.description.
  {
    path:        'meta',
    type:        'object',
    required:    false,
    pageBare:    true,
    description: "Default page meta for every page the site builds (@omega.js/web's head): title, description, image, keywords plus the head knobs below. A page (or layout) restates `meta:` BARE in frontmatter to override it — the one config section that may. No value here = the head falls back to brand.name / brand.description.",
  },
  {
    path:        'meta.title',
    type:        'string',
    required:    false,
    description: 'Default <title>/og:title. Unset falls back to brand.name.',
  },
  {
    path:        'meta.description',
    type:        'string',
    required:    false,
    description: 'Default meta description/og:description. Unset falls back to brand.description.',
  },
  {
    path:        'meta.image',
    type:        'string',
    required:    false,
    description: 'Default og:image/twitter:image. Unset falls back to brand.images.social, then brand.images.brandmark.',
  },
  {
    path:        'meta.keywords',
    type:        'string',
    required:    false,
    description: 'Default meta keywords (comma-separated). Unset emits no keywords tag.',
  },
  {
    path:        'meta.index',
    type:        'boolean',
    required:    false,
    description: 'false marks every page noindex AND drops it from sitemap.xml (#564) — the site-wide switch a staging brand flips. Per-page/per-layout `meta.index` overrides it.',
  },
  {
    path:        'meta.viewport',
    type:        'string',
    required:    false,
    description: 'Overrides the framework viewport meta ("width=device-width, initial-scale=1.0, user-scalable=yes, shrink-to-fit=no").',
  },
  {
    path:        'meta.referrer',
    type:        'string',
    required:    false,
    description: 'Overrides the framework referrer policy meta ("strict-origin-when-cross-origin").',
  },
  {
    path:        'meta.twitter_card',
    type:        'string',
    required:    false,
    description: "Twitter card type ('summary_large_image' by default).",
  },
  {
    path:        'meta.og_image_width',
    type:        'integer',
    required:    false,
    description: 'og:image:width for the default image (1200 by default).',
  },
  {
    path:        'meta.og_image_height',
    type:        'integer',
    required:    false,
    description: 'og:image:height for the default image (630 by default).',
  },

  // ── socials ──────────────────────────────────────────────────────────────
  {
    path:        'socials',
    type:        'object',
    required:    false,
    description: "Platform → handle ({ twitter: 'somiibo' }). The handle derives the profile URL every surface reads (JSON-LD sameAs, the footer row, omega_social), and @omega.js/web emits a redirect shortlink page at /<platform> for each entry (#429). An entry that redirects somewhere OTHER than its profile URL takes the object form { handle, redirect } — the redirect target wins for the shortlink, the handle still names the profile.",
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
    default:     false,
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
    path:        'cloud.oauthRedirectsConfigured',
    type:        'boolean',
    required:    false,
    description: "true = the Google OAuth client's authorized origins + redirect URIs are configured by hand. The ONE reconcile flag config keeps (#434) — that surface has no API to re-check, so the cloud service asks once, writes the answer back here, and every later run trusts it. Never set it without doing the work: the confirm is the only proof there is.",
  },
  {
    path:        'cloud.apiSubdomain',
    type:        'boolean',
    required:    false,
    default:     true,
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
    path:        'analytics.providers.google.propertyId',
    type:        'string',
    required:    false,
    description: 'GA4 property id (digits, as the Admin API returns it) — the manager\'s analytics service reconciles the brand\'s data streams and the Firebase link against it, and it gates the whole google half: no propertyId, no google operations. Interactive setup selects/creates the property and writes it back here.',
  },
  {
    path:        'analytics.providers.google.accountId',
    type:        'string',
    required:    false,
    description: "GA account id the property lives under (digits) — the analytics property picker and the console bookmarks read it. A company-managed brand inherits the COMPANY layer's value through the merge chain; a brand-level value always wins.",
  },
  {
    path:        'analytics.providers.meta.id',
    type:        'string',
    required:    false,
    description: 'Meta (Facebook) Pixel ID. Presence-driven.',
  },
  {
    path:        'analytics.providers.meta.accountId',
    type:        'string',
    required:    false,
    description: "Meta AD ACCOUNT id ('act_…' or the bare digits) the pixel is created on and found by name against. A non-secret platform id, so it lives here beside google.accountId — the token that reaches the account stays in .env (META_ACCESS_TOKEN).",
  },
  {
    path:        'analytics.providers.tiktok.id',
    type:        'string',
    required:    false,
    description: 'TikTok Pixel ID. Presence-driven.',
  },
  {
    path:        'analytics.providers.tiktok.accountId',
    type:        'string',
    required:    false,
    description: 'TikTok ADVERTISER id the pixel is created on. Same rule as meta.accountId: the id lives here, TIKTOK_ACCESS_TOKEN stays in .env.',
  },
  {
    path:        'analytics.providers.tiktok.appId',
    type:        'string',
    required:    false,
    description: "TikTok DEVELOPER APP id the access-token mint authorizes through (#448) — public config, so the manager can walk the portal without asking twice; setup writes it back here (#635). The app secret is pasted once and never saved, and the token lands in .env (TIKTOK_ACCESS_TOKEN).",
  },

  // ── advertising ──────────────────────────────────────────────────────────
  {
    path:        'advertising.providers.adsense.client',
    type:        'string',
    required:    false,
    description: 'AdSense publisher client id (ca-pub-…). The ONE adsense switch (#527), presence-driven: set it and the manager service manages the account, the site renders units from it and ads.txt carries the record; leave it out and none of that happens. No second gate — a managed-but-ad-free brand is deliberately inexpressible.',
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
  {
    path:        'advertising.fallback',
    type:        'string|boolean',
    required:    false,
    description: "The role a provider miss falls through to — 'inhouse' renders the house unit, false (or absent) ends the ladder at the built-in promo. Role-level, beside `providers` (docs/web/ads-system.md).",
  },
  {
    path:        'advertising.tags',
    type:        'array',
    required:    false,
    description: "This brand's contextual tags (['music', 'audio-tools']) — the targeting match input a house unit sends with its serve request unless the include passes its own. No user tracking.",
  },

  // ── company ──────────────────────────────────────────────────────────────
  {
    path:        'company.url',
    type:        'string',
    required:    false,
    match:       /^https?:\/\//,
    description: "The parent company's canonical URL. Sub-brand surfaces derive the company api from it (e.g. advertising inhouse source 'company' → api.<company host>).",
  },

  // ── payment (role: billing; provider-discriminated) ──────────────────────
  {
    path:        'payment.providers.stripe.publishableKey',
    type:        'string',
    required:    false,
    match:       /^pk_(test|live)_/,
    description: 'Stripe publishable key. Lives in config (not secret); the secret key stays in env.',
  },
  {
    path:        'payment.providers.paypal.clientId',
    type:        'string',
    required:    false,
    description: 'PayPal client ID. Lives in config; secret stays in env.',
  },
  {
    path:        'payment.providers.chargebee.site',
    type:        'string',
    required:    false,
    description: 'Chargebee site slug.',
  },
  {
    path:        'payment.products',
    type:        'array',
    required:    false,
    description: 'Product catalog (@omega.js/backend-shaped: id, name, type, limits, prices, per-provider IDs) — referenceable from every target. The ONLY pricing-page source (C2); optional presentation fields: tagline, popular, enterprise (the talk-to-us tier: its own full-width row, never a card), hidden (still created on every provider and purchasable by id — QA tiers, grandfathered plans — but never rendered on the pricing page), url, features [{ id, name, icon, definition, value }].',
  },
  {
    path:        'payment.winback.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'The cancel-flow save offer (#268), shown before the cancellation questionnaire. Defaults ON — false is the whole off switch, and the cancel flow goes straight to the questionnaire.',
  },
  {
    path:        'payment.winback.percent',
    type:        'integer',
    required:    false,
    min:         1,
    max:         100,
    default:     50,
    description: 'Whole percentage off the next cycle the save offer pitches. Defaults to 50. Mutually exclusive with payment.winback.amount.',
  },
  {
    path:        'payment.winback.amount',
    type:        'number',
    required:    false,
    min:         0.01,
    description: "Flat amount off the next cycle (payment.currency's major unit, e.g. 10 = $10), instead of a percentage. Mutually exclusive with payment.winback.percent.",
  },
  {
    path:        'payment.winback.duration',
    type:        'string',
    required:    false,
    enum:        WINBACK_DURATIONS,
    default:     'once',
    description: "How long the accepted offer lasts: 'once' (the next cycle only, the default) or 'forever' (a permanent price cut).",
  },

  // ── monitoring (role: error monitoring; provider-keyed, #425) ────────────
  {
    path:        'monitoring.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'Role-level switch (default true). false skips the monitoring service outright, whatever the providers block says.',
  },
  {
    path:        'monitoring.providers.sentry.org',
    type:        'string',
    required:    false,
    description: 'Sentry organization slug (public). Auto-detected when the auth token sees exactly one org — the monitoring service writes it back here.',
  },
  {
    path:        'monitoring.providers.sentry.dsn',
    type:        'string',
    required:    false,
    match:       /^https?:\/\//,
    description: 'Sentry DSN (public by design). Per-surface DSNs go in targets.<type>.monitoring.providers.sentry.dsn overrides.',
  },
  {
    path:        'monitoring.providers.sentry.environment',
    type:        'string',
    required:    false,
    description: "Environment tag every event carries. Unset (or null) lets the host's own gate name it: 'production' on a production run, 'development' otherwise.",
  },
  {
    path:        'monitoring.providers.sentry.sampleRate',
    type:        'number',
    required:    false,
    min:         0,
    max:         1,
    description: 'Fraction of ERROR events kept, 0..1. Defaults to 1 (keep everything).',
  },
  {
    path:        'monitoring.providers.sentry.tracesSampleRate',
    type:        'number',
    required:    false,
    min:         0,
    max:         1,
    description: 'Fraction of performance traces kept, 0..1. Defaults to 0.1.',
  },
  {
    path:        'monitoring.providers.sentry.replaysSessionSampleRate',
    type:        'number',
    required:    false,
    min:         0,
    max:         1,
    description: 'Browser only: fraction of SESSIONS recorded as a replay, 0..1. Defaults to 0 — replay costs bandwidth and captures the DOM, so it is strictly opt-in; any value above 0 loads the replay integration.',
  },
  {
    path:        'monitoring.providers.sentry.replaysOnErrorSampleRate',
    type:        'number',
    required:    false,
    min:         0,
    max:         1,
    description: 'Browser only: fraction of ERRORING sessions recorded as a replay, 0..1. Defaults to 0 (same opt-in gate as replaysSessionSampleRate).',
  },
  {
    path:        'monitoring.providers.sentry.scrubEmail',
    type:        'boolean',
    required:    false,
    description: 'PII guard on the user attached to an event: the uid always rides, the email only when this is explicitly false. Defaults to true (scrubbed).',
  },
  {
    path:        'monitoring.providers.sentry.attachScreenshot',
    type:        'boolean',
    required:    false,
    description: '@omega.js/desktop only: attach a screenshot of the window to a captured event. Defaults to false.',
  },
  {
    path:        'monitoring.providers.sentry.bundlePatterns',
    type:        'array',
    required:    false,
    description: "Browser only: the URL fragments that identify OUR bundles — a browser event reports only when a stack frame matches one. Defaults to ['/assets/js/'], where both @omega.js/web and @omega.js/extension serve every framework bundle.",
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
    path:        'repo.providers.github.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'false = the repo service skips entirely — no org profile, no repo settings, no GitHub Pages reconciliation; the brand hosts its source somewhere the manager does not touch.',
  },
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
    default:     false,
    description: 'true = the org is shared with other brands; org-level reconciliation is skipped.',
  },
  {
    path:        'repo.providers.github.private',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'Brand repo visibility (default true).',
  },

  // ── domain (two roles: registrar + mailbox; provider-keyed, #425) ────────
  {
    path:        'domain.providers',
    type:        'object',
    required:    false,
    description: "The brand's REGISTRAR, named as the one KEY under it ({ namecheap: {} }) — presence picks it, and no entry means nothing chosen, so the domain service skips. The provider set is open; the entry may be empty.",
  },
  {
    path:        'domain.providers.namecheap',
    type:        'object',
    required:    false,
    description: 'Namecheap as the registrar — the one provider whose nameservers the domain service points at the Cloudflare zone via API (NAMECHEAP_USERNAME + NAMECHEAP_API_KEY in .env). An empty object is the whole declaration; every other registrar gets manual instructions.',
  },
  {
    path:        'domain.email.providers',
    type:        'object',
    required:    false,
    description: "The brand's MAILBOX provider, named as the one KEY under it ({ cloudflare: {} } | { squarespace: {} } | { privateemail: {} }) — presence picks it; no entry leaves the edge service's email-routing operations off.",
  },
  {
    path:        'domain.email.forwarding',
    type:        'array',
    required:    false,
    description: "Address forwarding rules ([{ from: 'support' | '*', to: 'inbox@example.com' }]) the mailbox provider reconciles. Role-level and provider-agnostic.",
  },

  // ── edge (role: CDN/DNS edge; provider-discriminated) ────────────────────
  {
    path:        'edge.providers.cloudflare.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'false = the edge service skips entirely — no zone, DNS, settings, rules, speed-test or worker reconciliation for this brand.',
  },
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
  {
    path:        'captcha.providers.recaptcha.domainsConfirmed',
    type:        'array',
    required:    false,
    description: "Domains the owner has confirmed on the classic reCAPTCHA key (the API cannot read the key's domain list, so the confirmation is the record). Machine-written: the captcha service stamps a domain here once, and finding it is what keeps later runs from asking again.",
  },

  // ── forms (role: form handling; provider-discriminated) ──────────────────
  {
    path:        'forms.providers.slapform.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
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
    default:     true,
    description: 'false = the form is shared and managed by another brand; its name/settings are left alone.',
  },
  {
    path:        'forms.providers.slapform.plan',
    type:        'object',
    required:    false,
    default:     { id: 'grandmaster', name: 'Grandmaster' },
    description: 'Tier granted to the form-owner account ({ id, name }) — Slapform-operator only.',
  },

  // ── inbound (role: inbound conversations; per-channel providers) ─────────
  {
    path:        'inbound.chat.providers.chatsy.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'false = no chat widget boots and the chatsy service skips.',
  },
  {
    path:        'inbound.chat.providers.chatsy.agentId',
    type:        'string',
    required:    false,
    description: 'Chatsy agent id. The manager writes it back here; @omega.js/client boots the widget from it.',
  },
  {
    path:        'inbound.chat.providers.chatsy.accountId',
    type:        'string',
    required:    false,
    description: "Chatsy owner-account uid the agent belongs to — the account whose subscription the chat service reconciles to `plan`. The service resolves it from the agent itself; set it only when the agent's owner is provisioned elsewhere.",
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
    default:     true,
    description: 'false = the agent is shared and managed by another brand; its settings/knowledge are left alone.',
  },
  {
    path:        'inbound.chat.providers.chatsy.plan',
    type:        'object',
    required:    false,
    default:     { id: 'max', name: 'Max' },
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
    default:     true,
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
    default:     true,
    description: 'false = the agent is shared and managed by another brand; its filter/knowledge are left alone.',
  },
  {
    path:        'inbound.email.providers.replyify.plan',
    type:        'object',
    required:    false,
    default:     { id: 'max', name: 'Max' },
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
    path:        'search.providers.searchConsole.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'false = the search service skips entirely — the property is never verified and no sitemap is submitted (submitSitemap only turns the sitemap half off).',
  },
  {
    path:        'search.providers.searchConsole.submitSitemap',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'false = skip sitemap submission to Google Search Console.',
  },
  {
    path:        'search.providers.searchConsole.sitemapPaths',
    type:        'array',
    required:    false,
    default:     ['/sitemap.xml'],
    description: "Sitemap paths submitted as https://{domain}{path} (default ['/sitemap.xml']).",
  },
  {
    path:        'search.providers.searchConsole.gaLinked',
    type:        'boolean',
    required:    false,
    description: 'true = the owner has associated this Search Console property with the brand\'s GA property (no API exists for the link, so the confirmation is the record). Machine-written: the search service stamps it after the interactive association, and finding it is what keeps later runs from asking again.',
  },

  // ── certificates (role: code signing; provider-discriminated) ────────────
  {
    path:        'certificates.enabled',
    type:        'boolean',
    required:    false,
    description: 'false = the certificates service skips entirely — no bundle ids, no signing certificates, no provisioning profiles for this brand. Absent reads as ON for brands with a desktop/mobile target (the service still skips one with neither).',
  },
  {
    path:        'certificates.providers.apple.bundleIdPrefix',
    type:        'string',
    required:    false,
    description: "Reverse-DNS prefix the brand's bundle id is composed from ('com.mycompany' + brand.id → com.mycompany.my.brand). The brand's own answer — the onboard wizard seeds it and setup asks for it (#635); unset, the Apple operations have no id to reconcile.",
  },
  {
    path:        'certificates.providers.apple.capabilities',
    type:        'array',
    required:    false,
    description: "App Store Connect capabilities enabled on the bundle id (['APPLE_ID_AUTH']). Unset uses the framework set.",
  },
  {
    path:        'certificates.providers.apple.profiles',
    type:        'array',
    required:    false,
    description: 'Certificate types that get a provisioning profile per applicable platform (IOS_DISTRIBUTION, MAC_APP_DISTRIBUTION, DEVELOPER_ID_APPLICATION_G2). Unset uses the framework set.',
  },
  {
    path:        'certificates.providers.apple.certificates',
    type:        'array',
    required:    false,
    description: "Certificate types managed for the Apple Developer account ([{ type, manual }]) — `manual: true` marks the ones Apple's API cannot create, which the Account Holder downloads from the portal. Unset uses the framework set.",
  },

  // ── devlog (role: commit-digest publishing; provider-discriminated) ──────
  {
    path:        'devlog',
    type:        'object',
    required:    false,
    description: 'Commit-digest devlog pipeline (@omega.js/manager devlog): enabled + providers.ghostii (orgs, lookbackDays, publish settings).',
  },
  {
    path:        'devlog.enabled',
    type:        'boolean',
    required:    false,
    description: 'true PUBLISHES AI-written commit-digest posts to the brand\'s live website. Case 3 (docs/shared/config.md): the literal true is the only ON, absence is off, and no default is materialized — publishing is never implicit.',
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

  // ── parent ───────────────────────────────────────────────────────────────
  // parent … dataRequest are brand-level sections the manager reads UNFOLDED
  // (#277): a website-only brand has no targets.backend to hold them, and
  // adding one purely as a config home would falsely enable the target. A
  // targets.backend block still overrides any of them: that comes free from
  // the merge chain.
  {
    path:        'parent',
    type:        'string|boolean',
    required:    false,
    description: "Webhook parent topology: 'self' when this brand IS the parent, a parent URL otherwise, or false to deliberately opt out (shared webhook account owned elsewhere).",
  },

  // ── github ───────────────────────────────────────────────────────────────
  {
    path:        'github',
    type:        'object',
    required:    false,
    description: 'GitHub identity for the brand (user, website repo URL).',
  },

  // ── reviews ──────────────────────────────────────────────────────────────
  {
    path:        'reviews',
    type:        'object',
    required:    false,
    description: 'Review-collection settings (enabled, sites).',
  },

  // ── marketing (two roles: campaigns + newsletter, provider-keyed, #425) ──
  // Enumerated field by field (#425): the section used to validate as one
  // opaque object, so a typo in a list id or a publication id read as nothing
  // and the sync silently landed contacts in the wrong place. The section entry
  // stays too — it is one of the shared keys #277 types at brand level.
  {
    path:        'marketing',
    type:        'object',
    required:    false,
    description: 'Marketing automation: the campaigns + newsletter roles (each provider-keyed) and the prune switch.',
  },
  {
    path:        'marketing.campaigns.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'Role-level switch for email marketing (default true). false skips the campaigns service and the backend contact sync.',
  },
  {
    path:        'marketing.campaigns.providers.sendgrid.listId',
    type:        'string',
    required:    false,
    description: "SendGrid Marketing list UUID the brand's contacts land in. Written back by the campaigns service; unset means contacts reach All Contacts only.",
  },
  {
    path:        'marketing.newsletter.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'Role-level switch for the newsletter (default true). false skips the newsletter service and the backend subscriber sync.',
  },
  {
    path:        'marketing.newsletter.providers.beehiiv.publicationId',
    type:        'string',
    required:    false,
    description: "Beehiiv publication id (e.g. 'pub_xxxxx') the brand's subscribers land in, and the id every inbound Beehiiv webhook event is matched against. Written back by the newsletter service.",
  },
  {
    path:        'marketing.newsletter.content',
    type:        'object|array',
    required:    false,
    description: 'Newsletter-PIPELINE config (sources, categories, tone, template, theme, sponsorships) — a single object or an array whose first entry the generator uses. Role-level on purpose: it configures @omega.js/backend\'s generator, not Beehiiv.',
  },
  {
    path:        'marketing.prune.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'Monthly cold-contact prune across both providers. ON by default (Ian 2026-08-22) and materialized into every brand config — false is the per-brand off switch.',
  },

  // ── blog ─────────────────────────────────────────────────────────────────
  {
    path:        'blog',
    type:        'object',
    required:    false,
    description: 'AI blog-content settings (Ghostii pipeline).',
  },

  // ── dataRequest ──────────────────────────────────────────────────────────
  {
    path:        'dataRequest',
    type:        'object',
    required:    false,
    description: 'GDPR/CCPA data-request query definitions.',
  },

  // ── directory ────────────────────────────────────────────────────────────
  // The same brand-level family (#277): the manager's directory service reads
  // these unfolded. PUBLIC FACTS ONLY — the entry is pushed into the parent
  // project's world-readable `brands` collection, so the validator's
  // secret-shape guard is the hard floor here (#246).
  {
    path:        'directory',
    type:        'object',
    required:    false,
    description: "Directory participation (@omega.js/manager directory service): { enabled } — opt in to push this brand's entry into the parent project's `brands` collection. Absent or false never pushes. Needs `parent` to name the relationship and DIRECTORY_SERVICE_ACCOUNT in the brand .env.",
  },
  {
    path:        'directory.enabled',
    type:        'boolean',
    required:    false,
    default:     false,
    description: 'true opts the brand into the directory push. Default false — participation is never implicit.',
  },

  // ── sponsorships ─────────────────────────────────────────────────────────
  {
    path:        'sponsorships',
    type:        'object',
    required:    false,
    description: "The brand's sponsorship terms — the first directory BLOCK (#246), and the section the server service also publishes. Public terms only: { acceptable, unacceptable, prices }.",
  },
  {
    path:        'sponsorships.acceptable',
    type:        'array',
    required:    false,
    description: 'Topics the brand accepts sponsored content about (strings).',
  },
  {
    path:        'sponsorships.unacceptable',
    type:        'array',
    required:    false,
    description: 'Topics the brand refuses sponsored content about (strings).',
  },
  {
    path:        'sponsorships.prices',
    type:        'object',
    required:    false,
    description: "Price in USD per placement type — placement key to number ({ 'guest-post': 70, 'link-insertion': 50 }). A placement with no price is not for sale.",
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

  // ── ai ───────────────────────────────────────────────────────────────────
  {
    path:        'ai.enabled',
    type:        'boolean',
    required:    false,
    description: "The manager's AI-provider setup gate ([#639](https://github.com/Omega-JS-Stack/omega/issues/639)): the `ai` service asks once for OPENAI_API_KEY / ANTHROPIC_API_KEY. `false` is the permanent opt-out the gate's Disable lands; absence means ask. No default is materialized — a brand that never answers is never re-shaped.",
  },

  // ── translation ──────────────────────────────────────────────────────────
  {
    path:        'translation.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'Master switch (default true). Translation only runs when languages is non-empty.',
  },
  {
    path:        'translation.default',
    type:        'string',
    required:    false,
    default:     'en',
    description: "Source language code (default 'en'). Drives <html lang>, og:locale, and the default hreflang.",
  },
  {
    path:        'translation.languages',
    type:        'array',
    required:    false,
    description: "Target language codes (e.g. ['es', 'fr']). Empty/absent = translation off. Validated against @omega.js/devkit/translate's language SSOT.",
  },
  {
    path:        'translation.providers',
    type:        'object',
    required:    false,
    description: "AI translation provider, keyed by name — presence picks the engine ({ claude: {} } or { chatgpt: {} }). 'claude' (the default when the block is absent) rides the local Claude Code install — no API key; 'chatgpt' uses the OpenAI API via OPENAI_API_KEY in env.",
  },
  {
    path:        'translation.model',
    type:        'string',
    required:    false,
    description: "Model override for the chosen provider (defaults: claude → 'sonnet' alias, chatgpt → 'gpt-5.4-nano').",
  },
  {
    path:        'translation.exclude',
    type:        'array',
    required:    false,
    description: 'Web only: extra page paths/folders to skip (system pages like checkout/legal/auth are always skipped).',
  },

  // ── client (the @omega.js/client runtime blob) ───────────────────────────
  // The blob is a settings bag the client normalizes against its own defaults,
  // so it is deliberately NOT enumerated key by key here. `consent` is the
  // exception (#383): it decides whether a visitor is tracked at all, which is
  // a legal surface, not a preference — a typo that silently disabled the
  // banner would ship a site with no consent gate and no error.
  {
    path:        'client.consent.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'The consent banner + the provider-script gate (default true). false ships NO banner — legal only for a site that loads no analytics/marketing provider at all.',
  },
  {
    path:        'client.consent.config.position',
    type:        'string',
    required:    false,
    enum:        ['bottom-left', 'bottom-right', 'bottom'],
    description: "Where the panel sits. 'bottom' is the centered full-width form.",
  },
  {
    path:        'client.consent.config.content',
    type:        'object',
    required:    false,
    description: "Banner copy: message, panelIntro, accept, customize, acceptAll, acceptNone (a literal `{terms}`/`{cookies}` links the terms/cookie-policy page). Category labels are framework copy — a brand renames the buttons, not the categories.",
  },

  // ── targets ──────────────────────────────────────────────────────────────
  {
    path:        'targets',
    type:        'object',
    required:    false,
    description: "Key presence = target enabled; values = target-scoped config (any shared key inside overrides it) — an object, or an array of id'd instances (multi-instance targets). Framework keys are web/backend/desktop/extension/mobile; any other key must declare `type: 'custom'` (#603), a target the manager drives entirely through its own package.json scripts. Anything else is an error.",
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
    {
      path:        'dev.limitCollections',
      type:        'object',
      required:    false,
      description: "Dev-only collection sampling (#190): collection name → max documents ({ posts: 50 }), plus `randomize: true` for a random sample instead of the first N. Collection names are @omega.js/web's (posts, alternatives, team, updates) plus the brand's own `collections`, and the engine hard-fails an unknown one. Development builds only — production never samples.",
    },
    {
      path:        'collections',
      type:        'object',
      required:    false,
      description: "The brand's own content collections (#207): collection name → { field, size, title, description, permalink }. Documents live in `_<name>/`, and @omega.js/web generates the paginated listing page plus one page per category of `field` (the dotted frontmatter path the categories group on, e.g. 'doc.category'). A built-in collection name (posts, alternatives, team, updates) is an error.",
    },
    {
      path:        'redirects',
      type:        'array',
      required:    false,
      description: "Path redirects (#442), ORDERED — first match wins: [{ from, to, type }] where `from` may carry ONE captured `:name` segment ('/c/:id') that `to` references ('/code?id=:id'), and `type` is 301 (default), 302, 307 or 308. Static hosting has no server to answer with, so @omega.js/web materializes the map through the built 404 page and the redirect is CLIENT-side (`omega dev` serves the same map as a real status-code redirect). Entry shapes are validated hard by the web build (unknown key, malformed pattern, a `to` naming a segment `from` never captured).",
    },
    {
      path:        'purgecss',
      type:        'object',
      required:    false,
      description: 'PurgeCSS post-pass settings for the production css bundle.',
    },
    {
      path:        'purgecss.safelist',
      type:        'object|array',
      required:    false,
      description: "Selectors the content scan cannot see, merged OVER the framework's own safelist (#250). The object form takes PurgeCSS's lanes (standard, deep, greedy, keyframes); a bare array is PurgeCSS's shorthand for `standard`.",
    },
    {
      path:        'purgecss.safelist.standard',
      type:        'array',
      required:    false,
      description: 'Exact class names to keep (strings; PurgeCSS also accepts a regex here).',
    },
    {
      path:        'purgecss.safelist.deep',
      type:        'array',
      required:    false,
      description: 'Patterns (strings, compiled to RegExp) whose matching selectors keep their descendants too.',
    },
    {
      path:        'purgecss.safelist.greedy',
      type:        'array',
      required:    false,
      description: 'Patterns (strings, compiled to RegExp) keeping every selector that contains a match — the lane for a runtime-stamped namespace.',
    },
    {
      path:        'purgecss.safelist.keyframes',
      type:        'array',
      required:    false,
      description: 'Patterns (strings, compiled to RegExp) naming @keyframes to keep.',
    },
  ],

  // Seeded from the sandbox brand's real @omega.js/backend config (backend-manager-config.json).
  backend: [
    // parent, github, reviews, marketing, blog, dataRequest moved to
    // SHARED_SCHEMA (#277); a targets.backend block still overrides them
    // through the merge chain.
    {
      path:        'projectType',
      type:        'string',
      required:    false,
      enum:        BACKEND_PROJECT_TYPES,
      description: "How this backend RUNS and deploys (#584). 'firebase' (default) exports Cloud Functions; 'custom' runs the same app as an Express server on `PORT` for a container host (Render & co) — no Functions deploy, no emulator lane, and the target's own `deploy` script is the publish lane. Everything else — the auth middleware, the routes, the schemas, every helper — is identical in both modes.",
    },
    {
      path:        'auth.signup.maxPerIpPerDay',
      type:        'integer',
      required:    false,
      min:         1,
      description: 'Signups allowed per client IP per day (beforeUserCreated blocks the rest). Default 2. Raise it when the audience shares egress (NAT/CGNAT/VPN, offices, campuses).',
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

  // Store listings ARE the extension page's declaration and the curated
  // site.targets.extension view (#85, #610 — no second copy in web config).
  extension: [
    {
      path:        'listings.chrome.url',
      type:        'string',
      required:    false,
      match:       /^https?:\/\//,
      description: "Chrome Web Store listing URL. Feeds site.targets.extension.listings.chrome — the /extension page's button and its /extension/chrome shortlink.",
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
      description: 'Firefox Add-ons (AMO) listing URL. Feeds site.targets.extension.listings.firefox.',
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
      description: 'Microsoft Edge Add-ons listing URL. Feeds site.targets.extension.listings.edge.',
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
      description: 'Opera Add-ons listing URL. Feeds site.targets.extension.listings.opera.',
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
      description: 'App Store (Safari extension) listing URL. Feeds site.targets.extension.listings.safari.',
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
      description: 'Brave listing URL (Chrome Web Store serves Brave). Feeds site.targets.extension.listings.brave.',
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

/** The top-level sections a rule array declares — `targets` is scoping machinery. */
const sectionsOf = (rules) => [...new Set(rules.map((rule) => rule.path.split('.')[0]))].filter((section) => section !== 'targets');

/**
 * The config sections a target's RESOLVED config can hold (#607) — the
 * namespace a page's `config:` block overrides, and the namespace a page may
 * not restate bare. Per-target, because a target's refinements land at the
 * top level: `app` is a desktop section, and a web layout's own `app:` block
 * (the deep-link interstitial) is page data, not config.
 * @param {string} [target] - target name; omitted = the shared sections only
 * @returns {string[]} section names, sorted
 */
function configSections(target) {
  return [...new Set([...sectionsOf(SHARED_SCHEMA), ...sectionsOf(TARGET_SCHEMAS[target] || [])])].sort();
}

// The sections a page MAY restate bare (`pageBare: true` on the section root).
const PAGE_BARE_SECTIONS = [...SHARED_SCHEMA, ...Object.values(TARGET_SCHEMAS).flat()]
  .filter((rule) => rule.pageBare)
  .map((rule) => rule.path)
  .sort();

module.exports = { TARGETS, CUSTOM_TARGET_TYPE, isCustomTargetEntry, BACKEND_PROJECT_TYPES, backendProjectType, SHARED_SECTIONS, SHARED_SCHEMA, TARGET_SCHEMAS, BRAND_ID_PATTERN, WINBACK_DURATIONS, configSections, PAGE_BARE_SECTIONS };
