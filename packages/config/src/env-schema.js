/**
 * Canonical schema for the .env cascade — pure data, no logic
 * ([#581](https://github.com/Omega-JS-Stack/omega/issues/581)).
 *
 * The omega.json5 sibling of schema.js: ONE place that says which env keys
 * OMEGA needs, who owns each, which targets read it, whether OMEGA mints it
 * or a human pastes it from a third party, whether it is required, and what
 * it does. Everything that used to hand-keep its own list derives from here —
 * the manager's mint lane (the keys with a `generated` function), its
 * canonical .env grouping, disperse's backend composition, and the backend's
 * env reader (libraries/env.js), which refuses to boot without a required key.
 *
 * Entry format mirrors schema.js's rule objects:
 *
 *   {
 *     name:        'OMEGA_ADMIN_KEY',      // the env var (SCREAMING_SNAKE)
 *     match:       /^OAUTH2_.+$/,          // …or a pattern, for dynamic families
 *     owner:       'workspace',            // the manager service that owns it
 *                                          // ('backend' = the framework itself)
 *     targets:     ['backend'],            // the targets whose runtime READS it
 *     group:       'omega',                // its ENV_GROUPS bucket (file order)
 *     generated:   () => randomBytes(32)…, // the function that MINTS a value
 *     default:     'value',                // …or a static default, where one applies
 *     secret:      true,                   // never printed, never in omega.json5
 *     required:    true,                   // absent = the backend refuses to boot
 *     devOf:       'STRIPE_SECRET_KEY',    // …or: this key OVERRIDES that one
 *                                          // outside production (see below)
 *     liveShape:   /^sk_live_/,            // the pattern a LIVE credential
 *                                          // matches — refused outside production
 *     description: 'What the key drives.',
 *   }
 *
 * `generated:` is the mint switch: the manager writes those keys into a brand
 * .env (at onboard and on every manage that finds one missing) because no
 * dashboard exists to paste them from. Everything else is a third-party
 * credential a human provides. A key is minted OR defaulted, never both, and
 * only a key OMEGA can produce may be `required` — refusing every boot over a
 * secret nobody can mint would be a hostage note, not a guard.
 *
 * `targets:` is the composition domain: disperse composes the backend's own
 * .env (the ONLY target whose .env ships with a deploy artifact and so cannot
 * walk up to the brand layer) from the keys whose targets include `backend`.
 * Every other target reads brand values through the runtime cascade, so their
 * `targets` entries are documentation.
 *
 * `group:` picks the .env section the key renders into. A group with
 * `file: false` never reaches a brand .env at all — the backend resolves those
 * keys some other way (from config at boot, from disperse's per-target stream
 * lane, from the developer's own shell) — so they are neither rendered as
 * placeholders nor composed from the brand layer.
 *
 * `devOf:` marks a DEV-SUFFIXED twin — `<BASE>_DEV`, the value the backend
 * uses outside production ([#586](https://github.com/Omega-JS-Stack/omega/issues/586)).
 * Public payment keys already split per machine through the config merge
 * chain's local layer; secrets did not, so a brand's local emulator ran with
 * the live Stripe/PayPal/Chargebee credential and a local test purchase could
 * charge a real card. A twin is optional and provider-supplied (nobody mints
 * it), the backend's reader prefers it outside production and treats it as
 * absent IN production, and the deploy lane strips every one of them from the
 * upload. `liveShape:` is the other half of that guarantee: the pattern a LIVE
 * credential matches, which the reader refuses outside production. It is
 * declared only where the provider actually stamps one (Stripe's `sk_live_` /
 * `rk_live_`, Chargebee's `live_`); PayPal's halves are opaque, so PayPal is
 * protected by its twin alone.
 */
const { randomBytes, randomUUID } = require('node:crypto');

// One entry per .env section, in canonical file order — the manager's
// canonical-order lane renders from this list. `comment` is the boxed header,
// `notes` are the plain comment lines under it, `file: false` marks a group
// that is schema-only (see the header).
const ENV_GROUPS = [
  {
    id: 'omega',
    comment: 'Omega keys (auto-generated — minted at scaffold, and by manage when absent; rotate by replacing the value)',
    notes: [
      'Admin key: grants admin on your backend. Webhook key: authenticates third-party',
      'webhook deliveries. Namespace: the brand UUID namespace for deterministic ids.',
      'Unsubscribe key: signs the unsubscribe link in every email the backend sends.',
    ],
  },
  { id: 'github', comment: 'GitHub (repo + seo services) — `gh auth login` works instead of a token' },
  { id: 'cloudflare', comment: 'Cloudflare (edge service + every DNS-writing flow) — API token with Zone edit' },
  { id: 'namecheap', comment: 'Namecheap registrar (domain service)' },
  { id: 'google-oauth', comment: 'Google OAuth client (cloud, analytics, search, advertising services)' },
  { id: 'captcha', comment: "Classic reCAPTCHA keys — the brand's own, from its GCP reCAPTCHA console (captcha service)" },
  {
    id: 'pixels',
    comment: 'Pixel access tokens (analytics service; the names @omega.js/backend reads)',
    notes: [
      'One token per platform: it CREATES the pixel on the ad account',
      '(analytics.providers.{meta,tiktok}.accountId) and signs the conversions it sends.',
      'Meta: a Business Manager system-user token with ads_management — an interactive',
      '`omega manage` walks you to the page, pastes it in here, and discovers the ad',
      'account itself. TikTok: set its advertiser id in config first.',
    ],
  },
  { id: 'monitoring', comment: 'Error monitoring (monitoring service, Sentry provider) — a personal auth token with project+team write scopes' },
  { id: 'email-marketing', comment: 'Email marketing (campaigns + newsletter services: SendGrid + Beehiiv)' },
  { id: 'payment', comment: 'Payment providers (payment service; public halves live in omega.json5)' },
  { id: 'service-accounts', comment: 'Operator service accounts (forms/chat/email/server/assets services) — paths to service-account JSON files' },
  { id: 'apple', comment: 'Apple signing (certificates service — desktop/mobile targets)' },
  { id: 'fontawesome', comment: 'Font Awesome Pro (icons) — path to the local Pro package dir' },
  { id: 'backend-services', comment: 'Backend service keys (composed into targets/backend/.env by disperse)' },
  {
    id: 'machine',
    comment: 'Auto-generated and persisted on the first real run — machine-owned, leave unset',
    notes: [
      'The GA4 Measurement Protocol secrets are per target (the analytics service resolves',
      "one per stream; disperse composes each target its own GOOGLE_ANALYTICS_SECRET), and the",
      'VAPID private key is the half the Firebase console only ever shows you once.',
    ],
  },
  {
    id: 'runtime',
    file: false,
    comment: 'Resolved at runtime, never hand-written into a brand .env',
  },
];

const ENV_SCHEMA = [
  // ── omega — the keys OMEGA mints for itself ──────────────────────────────
  {
    name:        'OMEGA_ADMIN_KEY',
    owner:       'workspace',
    targets:     ['backend'],
    group:       'omega',
    generated:   () => randomBytes(32).toString('base64url'),
    secret:      true,
    required:    true,
    description: 'Grants admin on the brand backend: the header every privileged call carries, and the seed the OAuth2 state cipher derives from.',
  },
  {
    name:        'OMEGA_WEBHOOK_KEY',
    owner:       'workspace',
    targets:     ['backend'],
    group:       'omega',
    generated:   () => randomBytes(32).toString('base64url'),
    secret:      true,
    required:    true,
    description: 'Authenticates third-party webhook deliveries (payments, marketing) — the `key` query parameter every webhook route compares.',
  },
  {
    name:        'OMEGA_NAMESPACE',
    owner:       'workspace',
    targets:     ['backend'],
    group:       'omega',
    generated:   () => randomUUID(),
    secret:      true,
    required:    true,
    description: "The brand's UUID namespace — every deterministic id the backend mints (uuid route, analytics client ids) derives from it.",
  },
  {
    name:        'UNSUBSCRIBE_HMAC_KEY',
    owner:       'workspace',
    targets:     ['backend'],
    group:       'omega',
    generated:   () => randomBytes(32).toString('hex'),
    secret:      true,
    required:    true,
    description: 'Signs the unsubscribe link in every email the backend sends, and verifies the signature when a recipient follows one.',
  },

  // ── third-party credentials, by owning service ───────────────────────────
  {
    name:        'GH_TOKEN',
    owner:       'repo',
    targets:     ['backend'],
    group:       'github',
    secret:      true,
    required:    false,
    description: 'GitHub token for repo + seo work and the backend\'s content/admin routes (blog commits, workflow dispatch). `gh auth login` serves the manager instead; the deployed backend needs the token.',
  },
  {
    name:        'CLOUDFLARE_TOKEN',
    owner:       'edge',
    targets:     ['backend'],
    group:       'cloudflare',
    secret:      true,
    required:    false,
    description: 'Cloudflare API token with Zone edit — the edge service and every DNS-writing flow, plus the backend\'s cache-purge calls.',
  },
  {
    name:        'NAMECHEAP_USERNAME',
    owner:       'domain',
    targets:     [],
    group:       'namecheap',
    secret:      false,
    required:    false,
    description: 'Namecheap account the domain service registers and configures domains through.',
  },
  {
    name:        'NAMECHEAP_API_KEY',
    owner:       'domain',
    targets:     [],
    group:       'namecheap',
    secret:      true,
    required:    false,
    description: 'Namecheap API key paired with NAMECHEAP_USERNAME (the API also allowlists the calling IP).',
  },
  {
    name:        'GOOGLE_CLIENT_ID',
    owner:       'cloud',
    targets:     [],
    group:       'google-oauth',
    secret:      false,
    required:    false,
    description: 'OAuth client the manager authenticates Google APIs with (cloud, analytics, search, advertising services).',
  },
  {
    name:        'GOOGLE_CLIENT_SECRET',
    owner:       'cloud',
    targets:     [],
    group:       'google-oauth',
    secret:      true,
    required:    false,
    description: 'Secret half of GOOGLE_CLIENT_ID.',
  },
  {
    name:        'RECAPTCHA_SITE_KEY',
    owner:       'captcha',
    targets:     ['web'],
    group:       'captcha',
    secret:      false,
    required:    false,
    description: "Public half of the brand's classic reCAPTCHA pair — the web target renders it into forms.",
  },
  {
    name:        'RECAPTCHA_SECRET_KEY',
    owner:       'captcha',
    targets:     ['backend'],
    group:       'captcha',
    secret:      true,
    required:    false,
    description: 'Secret half of the reCAPTCHA pair — the backend verifies submitted tokens with it.',
  },
  {
    name:        'HCAPTCHA_SECRET',
    owner:       'captcha',
    targets:     ['backend'],
    group:       'captcha',
    secret:      true,
    required:    false,
    description: 'hCaptcha secret for brands on hCaptcha instead of reCAPTCHA — the backend verifies form submissions with it.',
  },
  {
    name:        'META_ACCESS_TOKEN',
    owner:       'analytics',
    targets:     ['backend'],
    group:       'pixels',
    secret:      true,
    required:    false,
    description: 'Business Manager system-user token with ads_management: creates the Meta pixel and signs the conversions the backend sends.',
  },
  {
    name:        'TIKTOK_ACCESS_TOKEN',
    owner:       'analytics',
    targets:     ['backend'],
    group:       'pixels',
    secret:      true,
    required:    false,
    description: 'TikTok Business token: creates the pixel on the advertiser account and signs the events the backend sends.',
  },
  {
    name:        'SENTRY_AUTH_TOKEN',
    owner:       'monitoring',
    targets:     [],
    group:       'monitoring',
    secret:      true,
    required:    false,
    description: 'Personal Sentry auth token with project+team write scopes — the monitoring service provisions projects and uploads source maps with it.',
  },
  {
    name:        'SENDGRID_API_KEY',
    owner:       'campaigns',
    targets:     ['backend'],
    group:       'email-marketing',
    secret:      true,
    required:    false,
    description: 'SendGrid API key — every transactional and campaign email the backend sends, and the contact lists the campaigns service reconciles.',
  },
  {
    name:        'BEEHIIV_API_KEY',
    owner:       'newsletter',
    targets:     ['backend'],
    group:       'email-marketing',
    secret:      true,
    required:    false,
    description: 'Beehiiv API key — newsletter subscriptions and the publication the newsletter service reconciles.',
  },
  {
    name:        'STRIPE_SECRET_KEY',
    owner:       'payment',
    targets:     ['backend'],
    group:       'payment',
    secret:      true,
    required:    false,
    liveShape:   /^(sk|rk)_live_/,
    description: 'Stripe secret key — the backend creates checkout sessions, subscriptions, and refunds with it.',
  },
  {
    name:        'STRIPE_SECRET_KEY_DEV',
    owner:       'payment',
    targets:     ['backend'],
    group:       'payment',
    devOf:       'STRIPE_SECRET_KEY',
    secret:      true,
    required:    false,
    description: 'Stripe TEST secret key (sk_test_…) — the backend uses it instead of STRIPE_SECRET_KEY outside production, so a local emulator can never charge a real card. Never uploaded by a deploy.',
  },
  {
    name:        'PAYPAL_CLIENT_SECRET',
    owner:       'payment',
    targets:     ['backend'],
    group:       'payment',
    secret:      true,
    required:    false,
    description: 'Secret half of the PayPal app credentials (the client id is public and lives in omega.json5).',
  },
  {
    name:        'PAYPAL_CLIENT_SECRET_DEV',
    owner:       'payment',
    targets:     ['backend'],
    group:       'payment',
    devOf:       'PAYPAL_CLIENT_SECRET',
    secret:      true,
    required:    false,
    description: "Secret half of the PayPal SANDBOX app — the backend uses it outside production (pair it with the sandbox client id on the local config layer). PayPal credentials carry no live/sandbox marker, so this twin is the only split. Never uploaded by a deploy.",
  },
  {
    name:        'CHARGEBEE_API_KEY',
    owner:       'payment',
    targets:     ['backend'],
    group:       'payment',
    secret:      true,
    required:    false,
    liveShape:   /^live_/,
    description: 'Chargebee API key for the brand site (the site name is public and lives in omega.json5).',
  },
  {
    name:        'CHARGEBEE_API_KEY_DEV',
    owner:       'payment',
    targets:     ['backend'],
    group:       'payment',
    devOf:       'CHARGEBEE_API_KEY',
    secret:      true,
    required:    false,
    description: "Chargebee TEST-site API key (test_…) — the backend uses it instead of CHARGEBEE_API_KEY outside production. Never uploaded by a deploy.",
  },
  {
    name:        'SLAPFORM_SERVICE_ACCOUNT',
    owner:       'forms',
    targets:     [],
    group:       'service-accounts',
    secret:      true,
    required:    false,
    description: 'Path to the Slapform service-account JSON the forms service authenticates with.',
  },
  {
    name:        'CHATSY_SERVICE_ACCOUNT',
    owner:       'chat',
    targets:     [],
    group:       'service-accounts',
    secret:      true,
    required:    false,
    description: 'Path to the Chatsy service-account JSON the chat service authenticates with.',
  },
  {
    name:        'REPLYIFY_SERVICE_ACCOUNT',
    owner:       'email',
    targets:     [],
    group:       'service-accounts',
    secret:      true,
    required:    false,
    description: 'Path to the Replyify service-account JSON the email service authenticates with.',
  },
  {
    name:        'SERVER_SERVICE_ACCOUNT',
    owner:       'server',
    targets:     [],
    group:       'service-accounts',
    secret:      true,
    required:    false,
    description: 'Path to the server service-account JSON the server service authenticates with.',
  },
  {
    name:        'MRLOGO_SERVICE_ACCOUNT',
    owner:       'assets',
    targets:     [],
    group:       'service-accounts',
    secret:      true,
    required:    false,
    description: 'Path to the Mr. Logo service-account JSON the assets service generates brand artwork through.',
  },
  {
    name:        'APPLE_API_ISSUER',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'apple',
    secret:      false,
    required:    false,
    description: 'App Store Connect API issuer id — notarization of the desktop build.',
  },
  {
    name:        'APPLE_API_KEY_ID',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'apple',
    secret:      false,
    required:    false,
    description: 'App Store Connect API key id — also names the .p8 file the certificates service places (AuthKey_<id>.p8).',
  },
  {
    name:        'APPLE_TEAM_ID',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'apple',
    secret:      false,
    required:    false,
    description: 'Apple Developer team id the desktop build signs under.',
  },
  {
    name:        'OMEGA_FONTAWESOME_ROOT',
    owner:       'assets',
    targets:     ['web', 'desktop', 'extension'],
    group:       'fontawesome',
    secret:      false,
    required:    false,
    description: "Filesystem path to the developer's local Font Awesome Pro package — machine-local, so it never travels to CI (the free set is the fallthrough).",
  },

  // ── backend service keys ─────────────────────────────────────────────────
  // ONE key per AI provider ([#639](https://github.com/Omega-JS-Stack/omega/issues/639)):
  // the OMEGA_-prefixed twins are gone. A company-wide key is the COMPANY
  // layer of the .env cascade under the SAME name — never a second key name.
  {
    name:        'OPENAI_API_KEY',
    owner:       'backend',
    targets:     ['backend'],
    group:       'backend-services',
    secret:      true,
    required:    false,
    description: 'The OpenAI key wherever the backend calls OpenAI — the brand .env wins, a company .env serves every brand that sets none.',
  },
  {
    name:        'ANTHROPIC_API_KEY',
    owner:       'backend',
    targets:     ['backend'],
    group:       'backend-services',
    secret:      true,
    required:    false,
    description: 'The Anthropic key wherever the backend calls Anthropic — the brand .env wins, a company .env serves every brand that sets none.',
  },
  {
    name:        'NEVERBOUNCE_API_KEY',
    owner:       'backend',
    targets:     ['backend'],
    group:       'backend-services',
    secret:      true,
    required:    false,
    description: 'NeverBounce API key — the first-choice email-validation provider on signup and marketing sync.',
  },
  {
    name:        'ZEROBOUNCE_API_KEY',
    owner:       'backend',
    targets:     ['backend'],
    group:       'backend-services',
    secret:      true,
    required:    false,
    description: 'ZeroBounce API key — the email-validation provider used when NeverBounce is unset.',
  },

  // ── machine-owned: written by a service on its first real run ────────────
  {
    name:        'ACCOUNT_PASSWORD_SEED',
    owner:       'account',
    targets:     [],
    group:       'machine',
    secret:      true,
    required:    false,
    description: 'Seed the account service derives every brand-owned account password from — generated on the first run that needs one.',
  },
  {
    name:        'CSC_KEY_PASSWORD',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'machine',
    secret:      true,
    required:    false,
    description: "Password of the desktop signing certificate the certificates service created — electron-builder reads it at package time.",
  },
  {
    name:        'VAPID_PRIVATE_KEY',
    owner:       'cloud',
    targets:     [],
    group:       'machine',
    secret:      true,
    required:    false,
    description: 'Private half of the Web Push key pair — the Firebase console shows it once, so the cloud service persists it here (the public half lives in omega.json5).',
  },
  {
    name:        'GOOGLE_ANALYTICS_SECRET_WEB',
    owner:       'analytics',
    targets:     [],
    group:       'machine',
    secret:      true,
    required:    false,
    description: "Measurement Protocol secret of the web target's GA4 stream — disperse composes it into that target as GOOGLE_ANALYTICS_SECRET.",
  },
  {
    name:        'GOOGLE_ANALYTICS_SECRET_BACKEND',
    owner:       'analytics',
    targets:     [],
    group:       'machine',
    secret:      true,
    required:    false,
    description: "Measurement Protocol secret of the backend target's GA4 stream — disperse composes it into that target as GOOGLE_ANALYTICS_SECRET.",
  },
  {
    name:        'GOOGLE_ANALYTICS_SECRET_DESKTOP',
    owner:       'analytics',
    targets:     [],
    group:       'machine',
    secret:      true,
    required:    false,
    description: "Measurement Protocol secret of the desktop target's GA4 stream — disperse composes it into that target as GOOGLE_ANALYTICS_SECRET.",
  },
  {
    name:        'GOOGLE_ANALYTICS_SECRET_EXTENSION',
    owner:       'analytics',
    targets:     [],
    group:       'machine',
    secret:      true,
    required:    false,
    description: "Measurement Protocol secret of the extension target's GA4 stream — disperse composes it into that target as GOOGLE_ANALYTICS_SECRET.",
  },
  {
    name:        'GOOGLE_ANALYTICS_SECRET_MOBILE',
    owner:       'analytics',
    targets:     [],
    group:       'machine',
    secret:      true,
    required:    false,
    description: "Measurement Protocol secret of the mobile target's GA4 stream — disperse composes it into that target as GOOGLE_ANALYTICS_SECRET.",
  },

  // ── runtime-resolved: never hand-written into a brand .env ───────────────
  {
    name:        'GOOGLE_ANALYTICS_SECRET',
    owner:       'analytics',
    targets:     ['web', 'backend', 'desktop', 'extension'],
    group:       'runtime',
    secret:      true,
    required:    false,
    description: "A target's own Measurement Protocol secret — disperse writes it into each target .env from the brand-level GOOGLE_ANALYTICS_SECRET_<TARGET>, so it is never composed from a brand key of the same name.",
  },
  {
    name:        'PAYPAL_CLIENT_ID',
    owner:       'payment',
    targets:     ['backend'],
    group:       'runtime',
    secret:      false,
    required:    false,
    description: 'Public PayPal client id — the backend publishes it into its own env from payment.providers.paypal.clientId at boot.',
  },
  {
    name:        'CHARGEBEE_SITE',
    owner:       'payment',
    targets:     ['backend'],
    group:       'runtime',
    secret:      false,
    required:    false,
    description: 'Public Chargebee site name — the backend publishes it into its own env from payment.providers.chargebee.site at boot.',
  },
  {
    name:        'CLAUDE_CODE_OAUTH_TOKEN',
    owner:       'backend',
    targets:     ['backend'],
    group:       'runtime',
    secret:      true,
    required:    false,
    description: "Developer tooling credential (`claude setup-token`) the claude-code AI provider falls back to — deliberately never composed into a brand's target .env.",
  },
  {
    match:       /^OAUTH2_[A-Z0-9_]+_CLIENT_(ID|SECRET)$/,
    owner:       'backend',
    targets:     ['backend'],
    group:       'runtime',
    secret:      true,
    required:    false,
    description: "Per-provider OAuth2 client credentials for the backend's user-connection routes (OAUTH2_<PROVIDER>_CLIENT_ID / _CLIENT_SECRET) — the provider set is open, so the family is a pattern.",
  },
];

/** The groups that render into a real .env file, in canonical file order. */
function envFileGroups() {
  return ENV_GROUPS.filter((group) => group.file !== false);
}

/**
 * The entry that governs a name — an exact match first, then the dynamic
 * families' patterns. Undefined for a name the schema does not know.
 *
 * @param {string} name - The env var name.
 * @returns {object|undefined} The schema entry.
 */
function envSchemaEntry(name) {
  return ENV_SCHEMA.find((entry) => entry.name === name)
    || ENV_SCHEMA.find((entry) => entry.match instanceof RegExp && entry.match.test(name));
}

/**
 * The keys a target's own .env carries, in schema order — disperse's backend
 * composition. Pattern families and schema-only groups are excluded: neither
 * has a fixed name in a brand .env to compose FROM.
 *
 * @param {string} target - Target name ('backend', 'web', …).
 * @returns {string[]} Env var names.
 */
function envKeysForTarget(target) {
  const fileGroups = new Set(envFileGroups().map((group) => group.id));

  return ENV_SCHEMA
    .filter((entry) => entry.name && fileGroups.has(entry.group) && entry.targets.includes(target))
    .map((entry) => entry.name);
}

/**
 * The keys OMEGA mints for itself: name → the function that produces a value.
 * The manager's onboard stub and its manage-time mint both render from this.
 *
 * @returns {Object<string, function(): string>} Name → generator.
 */
function generatedEnvKeys() {
  return Object.fromEntries(ENV_SCHEMA
    .filter((entry) => typeof entry.generated === 'function')
    .map((entry) => [entry.name, entry.generated]));
}

/**
 * The keys a target refuses to run without — the backend's boot guard.
 *
 * @param {string} target - Target name.
 * @returns {string[]} Env var names.
 */
function requiredEnvKeys(target) {
  return ENV_SCHEMA
    .filter((entry) => entry.name && entry.required && entry.targets.includes(target))
    .map((entry) => entry.name);
}

/**
 * The dev-suffixed keys (#586) — the set a deploy must never upload, and the
 * set the backend reads as absent in production.
 *
 * @returns {string[]} Env var names.
 */
function devEnvKeys() {
  return ENV_SCHEMA
    .filter((entry) => entry.devOf)
    .map((entry) => entry.name);
}

/**
 * Base key → the dev-suffixed twin that overrides it outside production, for
 * every key that declares one. The backend's env reader's lookup.
 *
 * @returns {Object<string, string>} Base name → twin name.
 */
function devEnvKeyMap() {
  return Object.fromEntries(ENV_SCHEMA
    .filter((entry) => entry.devOf)
    .map((entry) => [entry.devOf, entry.name]));
}

/**
 * Group id → its keys in schema order, every declared group present.
 *
 * @returns {Object<string, string[]>} Group id → env var names.
 */
function envKeysByGroup() {
  const byGroup = Object.fromEntries(ENV_GROUPS.map((group) => [group.id, []]));

  for (const entry of ENV_SCHEMA) {
    if (entry.name) byGroup[entry.group].push(entry.name);
  }

  return byGroup;
}

module.exports = {
  ENV_SCHEMA,
  ENV_GROUPS,
  envFileGroups,
  envSchemaEntry,
  envKeysForTarget,
  generatedEnvKeys,
  requiredEnvKeys,
  devEnvKeys,
  devEnvKeyMap,
  envKeysByGroup,
};
