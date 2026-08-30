/**
 * Canonical schema for the .env cascade — pure data, no logic
 * ([#581](https://github.com/Omega-JS-Stack/omega/issues/581)).
 *
 * The omega.json5 sibling of schema.js: ONE place that says which env keys
 * OMEGA needs, who owns each, which targets read it, whether OMEGA mints it
 * or a human pastes it from a third party, whether it is required, and what
 * it does. Everything that used to hand-keep its own list derives from here —
 * the manager's mint lane (the keys with a `generated` function), its
 * canonical .env grouping, the per-verb target delivery (composeTargetEnv in
 * env.js), and the backend's env reader (libraries/env.js), which refuses to
 * boot without a required key.
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
 *     deliverAs:   'GOOGLE_ANALYTICS_SECRET', // the name it lands under in the
 *                                          // target's composed .env (see below)
 *     delivery:    { backend: 'env' },      // HOW it reaches each target
 *     publicAtRest: true,                  // …and, for a bake, that anyone who
 *                                          // unpacks the app may read it
 *     requiredWhen: 'analytics.providers.google.id', // the config path that
 *                                          // makes it mandatory
 *     machineLocal: true,                  // a developer-machine value (a local
 *                                          // path): never published to CI
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
 * `targets:` is the composition domain: composeTargetEnv (env.js) composes a
 * target's own .env from the company/brand layers' keys whose targets include
 * it — the backend's is the ONLY one that ships with a deploy artifact and so
 * cannot walk up to the brand layer at runtime. Every other target reads brand
 * values through the runtime cascade, so their `targets` entries are mostly
 * documentation.
 *
 * `group:` picks the .env section the key renders into. A group with
 * `file: false` never reaches a brand .env at all — the backend resolves those
 * keys some other way (from config at boot, from the target's own .env, from
 * the developer's own shell) — so they are neither rendered as placeholders
 * nor composed from the brand layer.
 *
 * `deliverAs:` is the RENAME on delivery: the key is written into a brand .env
 * under its own name (the per-target GA4 secrets are `GOOGLE_ANALYTICS_SECRET_
 * <TARGET>` there, because one brand holds one per stream) and reaches its
 * target under `deliverAs` (`GOOGLE_ANALYTICS_SECRET` — a target only ever has
 * one stream). applyDeliverAs (env.js) is the one place it happens, on every
 * verb: composed into dist/.env for the backend, loaded into process.env at
 * CLI boot for the others. Absent = delivered under its own name.
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
 *
 * `delivery:` is HOW the key reaches each target it names — the declaration
 * that replaced three unrelated hand-kept lists
 * ([#627](https://github.com/Omega-JS-Stack/omega/issues/627)):
 *
 *   - `'env'`  — read from the composed .env at runtime (the backend, the one
 *                target whose artifact ships an env file).
 *   - `'ci'`   — the generated workflow injects it into the runner env for the
 *                build step.
 *   - `'bake'` — the build writes the value INTO the shipped artifact, because
 *                a packaged app (desktop, extension) runs with no .env. A bake
 *                implies its `'ci'` half: the workflow injects, then the build
 *                bakes. Anyone who unpacks the app can read a baked value, so
 *                a baking entry must declare `publicAtRest: true` — the
 *                renderer REFUSES to bake a `secret: true` entry without it.
 *
 * A target absent from `delivery` gets nothing: no workflow line, no bake, no
 * repo secret. env-delivery.js is the ONE reader — every workflow secrets
 * block, bake list and push-secrets set derives from these declarations, so a
 * new key is one entry here and nothing else.
 *
 * `requiredWhen:` is the CONDITIONAL requirement
 * ([#626](https://github.com/Omega-JS-Stack/omega/issues/626)): a dotted
 * omega.json5 path whose truthy value makes the key mandatory (a GA4
 * Measurement ID with no Measurement Protocol secret ships a build that sends
 * no events, silently). One-directional and PRESENCE ONLY — never a check on
 * the value's shape. checkEnvRules (env-rules.js) is the ONE evaluator of it
 * and of `required`; consumers decide the severity.
 */
const { randomBytes, randomUUID } = require('node:crypto');

// The three ways a key reaches a target (#627) — see the header.
const DELIVERY_MODES = ['env', 'ci', 'bake'];

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
  {
    id: 'desktop-publishing',
    comment: 'Windows signing + Snap Store publishing (desktop target) — the Apple half is its own section above',
    notes: [
      'Windows: the EV token PIN, the cert thumbprint path and signtool, read by the',
      'windows-sign CI job. Linux: the snapcraft credentials blob (`snapcraft export-login -`).',
    ],
  },
  {
    id: 'extension-stores',
    comment: 'Extension store publishing (extension target: Chrome Web Store, Firefox Add-ons, Edge Add-ons)',
  },
  { id: 'fontawesome', comment: 'Font Awesome Pro (icons) — path to the local Pro package dir' },
  { id: 'backend-services', comment: 'Backend service keys (composed into targets/backend/dist/.env by the env composer)' },
  {
    id: 'testing',
    comment: 'Test-lane credentials (every target) — optional; a suite that needs one skips without it',
  },
  {
    id: 'machine',
    comment: 'Auto-generated and persisted on the first real run — machine-owned, leave unset',
    notes: [
      'The GA4 Measurement Protocol secrets are per target (the analytics service resolves',
      "one per stream; the composer delivers each target its own GOOGLE_ANALYTICS_SECRET), and the",
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
    targets:     ['backend', 'desktop'],
    group:       'omega',
    generated:   () => randomBytes(32).toString('base64url'),
    secret:      true,
    required:    true,
    delivery:    { backend: 'env' },
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
    delivery:    { backend: 'env' },
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
    delivery:    { backend: 'env' },
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
    delivery:    { backend: 'env' },
    description: 'Signs the unsubscribe link in every email the backend sends, and verifies the signature when a recipient follows one.',
  },

  // ── third-party credentials, by owning service ───────────────────────────
  {
    name:        'GH_TOKEN',
    owner:       'repo',
    targets:     ['web', 'backend', 'desktop'],
    group:       'github',
    secret:      true,
    required:    false,
    delivery:    { web: 'ci', backend: 'env', desktop: 'ci' },
    description: 'GitHub token for repo + seo work and the backend\'s content/admin routes (blog commits, workflow dispatch); the web target publishes CI secrets with it and the desktop target cuts releases and mirrors downloads with it. `gh auth login` serves the manager instead; the deployed backend needs the token.',
  },
  {
    name:        'CLOUDFLARE_TOKEN',
    owner:       'edge',
    targets:     ['backend'],
    group:       'cloudflare',
    secret:      true,
    required:    false,
    delivery:    { backend: 'env' },
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
    delivery:    { web: 'ci' },
    description: "Public half of the brand's classic reCAPTCHA pair — the web target renders it into forms.",
  },
  {
    name:        'RECAPTCHA_SECRET_KEY',
    owner:       'captcha',
    targets:     ['backend'],
    group:       'captcha',
    secret:      true,
    required:    false,
    requiredWhen: 'captcha.providers.recaptcha.siteKey',
    delivery:    { backend: 'env' },
    description: 'Secret half of the reCAPTCHA pair — the backend verifies submitted tokens with it.',
  },
  {
    name:        'HCAPTCHA_SECRET',
    owner:       'captcha',
    targets:     ['backend'],
    group:       'captcha',
    secret:      true,
    required:    false,
    delivery:    { backend: 'env' },
    description: 'hCaptcha secret for brands on hCaptcha instead of reCAPTCHA — the backend verifies form submissions with it.',
  },
  {
    name:        'META_ACCESS_TOKEN',
    owner:       'analytics',
    targets:     ['backend'],
    group:       'pixels',
    secret:      true,
    required:    false,
    delivery:    { backend: 'env' },
    description: 'Business Manager system-user token with ads_management: creates the Meta pixel and signs the conversions the backend sends.',
  },
  {
    name:        'TIKTOK_ACCESS_TOKEN',
    owner:       'analytics',
    targets:     ['backend'],
    group:       'pixels',
    secret:      true,
    required:    false,
    delivery:    { backend: 'env' },
    description: 'TikTok Business token: creates the pixel on the advertiser account and signs the events the backend sends.',
  },
  {
    name:        'SENTRY_AUTH_TOKEN',
    owner:       'monitoring',
    targets:     [],
    group:       'monitoring',
    secret:      true,
    required:    false,
    requiredWhen: 'monitoring.providers.sentry.dsn',
    description: 'Personal Sentry auth token with project+team write scopes — the monitoring service provisions projects and uploads source maps with it.',
  },
  {
    name:        'SENDGRID_API_KEY',
    owner:       'campaigns',
    targets:     ['backend'],
    group:       'email-marketing',
    secret:      true,
    required:    false,
    delivery:    { backend: 'env' },
    description: 'SendGrid API key — every transactional and campaign email the backend sends, and the contact lists the campaigns service reconciles.',
  },
  {
    name:        'BEEHIIV_API_KEY',
    owner:       'newsletter',
    targets:     ['backend'],
    group:       'email-marketing',
    secret:      true,
    required:    false,
    delivery:    { backend: 'env' },
    description: 'Beehiiv API key — newsletter subscriptions and the publication the newsletter service reconciles.',
  },
  {
    name:        'STRIPE_SECRET_KEY',
    owner:       'payment',
    targets:     ['backend'],
    group:       'payment',
    secret:      true,
    required:    false,
    delivery:    { backend: 'env' },
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
    delivery:    { backend: 'env' },
    description: 'Stripe TEST secret key (sk_test_…) — the backend uses it instead of STRIPE_SECRET_KEY outside production, so a local emulator can never charge a real card. Never uploaded by a deploy.',
  },
  {
    name:        'PAYPAL_CLIENT_SECRET',
    owner:       'payment',
    targets:     ['backend'],
    group:       'payment',
    secret:      true,
    required:    false,
    delivery:    { backend: 'env' },
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
    delivery:    { backend: 'env' },
    description: "Secret half of the PayPal SANDBOX app — the backend uses it outside production (pair it with the sandbox client id on the local config layer). PayPal credentials carry no live/sandbox marker, so this twin is the only split. Never uploaded by a deploy.",
  },
  {
    name:        'CHARGEBEE_API_KEY',
    owner:       'payment',
    targets:     ['backend'],
    group:       'payment',
    secret:      true,
    required:    false,
    delivery:    { backend: 'env' },
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
    delivery:    { backend: 'env' },
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
    delivery:    { desktop: 'ci' },
    description: 'App Store Connect API issuer id — notarization of the desktop build.',
  },
  {
    name:        'APPLE_API_KEY_ID',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'apple',
    secret:      false,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'App Store Connect API key id — also names the .p8 file the certificates service places (AuthKey_<id>.p8).',
  },
  {
    name:        'APPLE_TEAM_ID',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'apple',
    secret:      false,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'Apple Developer team id the desktop build signs under.',
  },
  {
    name:        'CSC_LINK',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'apple',
    secret:      false,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'Path to the macOS Developer ID signing certificate (.p12) electron-builder signs with — unset, the build derives it from a delivered config/certs/developer-id-application.p12, then falls back to the Keychain.',
  },
  {
    name:        'APPLE_API_KEY',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'apple',
    secret:      false,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'Path to the App Store Connect API key (.p8) notarization uses — unset, the build derives it from a delivered config/certs/AuthKey_<APPLE_API_KEY_ID>.p8.',
  },

  // ── desktop-publishing — the Windows + Linux halves of a desktop release ──
  {
    name:        'WIN_EV_TOKEN_PATH',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'desktop-publishing',
    secret:      false,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'Thumbprint/path of the EV code-signing certificate on the self-hosted Windows runner (platforms.win.signing.strategy = self-hosted).',
  },
  {
    name:        'WIN_CSC_KEY_PASSWORD',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'desktop-publishing',
    secret:      true,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'SafeNet token PIN the Windows signing job unlocks the EV token with.',
  },
  {
    name:        'SIGNTOOL_PATH',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'desktop-publishing',
    secret:      false,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'Path to signtool.exe on the Windows runner.',
  },
  // The cloud signing providers (platforms.win.signing.strategy = cloud): the
  // windows-sign job injects all three sets and the configured provider is the
  // one that consumes its own ([#627](https://github.com/Omega-JS-Stack/omega/issues/627)).
  {
    name:        'AZURE_TENANT_ID',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'desktop-publishing',
    secret:      true,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'Azure Trusted Signing: the directory (tenant) the signing account lives in.',
  },
  {
    name:        'AZURE_CLIENT_ID',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'desktop-publishing',
    secret:      true,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'Azure Trusted Signing: the app registration the signing job authenticates as.',
  },
  {
    name:        'AZURE_CLIENT_SECRET',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'desktop-publishing',
    secret:      true,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'Azure Trusted Signing: the client secret of AZURE_CLIENT_ID.',
  },
  {
    name:        'AZURE_TRUSTED_SIGNING_ENDPOINT',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'desktop-publishing',
    secret:      true,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'Azure Trusted Signing: the regional endpoint the signing account was created in.',
  },
  {
    name:        'SSLCOM_USERNAME',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'desktop-publishing',
    secret:      true,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'SSL.com eSigner account the cloud signing job authenticates with.',
  },
  {
    name:        'SSLCOM_PASSWORD',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'desktop-publishing',
    secret:      true,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'Password of the SSL.com eSigner account.',
  },
  {
    name:        'SSLCOM_CREDENTIAL_ID',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'desktop-publishing',
    secret:      true,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'SSL.com eSigner credential id naming which certificate in the account signs.',
  },
  {
    name:        'DIGICERT_API_KEY',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'desktop-publishing',
    secret:      true,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'DigiCert KeyLocker API key the cloud signing job authenticates with.',
  },
  {
    name:        'DIGICERT_KEYPAIR_ALIAS',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'desktop-publishing',
    secret:      true,
    required:    false,
    delivery:    { desktop: 'ci' },
    description: 'DigiCert KeyLocker keypair alias naming which certificate in the account signs.',
  },
  {
    name:        'SNAPCRAFT_STORE_CREDENTIALS',
    owner:       'certificates',
    targets:     ['desktop'],
    group:       'desktop-publishing',
    secret:      true,
    required:    false,
    requiredWhen: 'platforms.linux.snap.enabled',
    delivery:    { desktop: 'ci' },
    description: 'Snap Store credentials blob (`snapcraft export-login -`) the Linux publish job uses — required only when platforms.linux.snap.enabled.',
  },

  // ── extension-stores — one credential set per browser store ──────────────
  {
    name:        'CHROME_EXTENSION_ID',
    owner:       'certificates',
    targets:     ['extension'],
    group:       'extension-stores',
    secret:      false,
    required:    false,
    delivery:    { extension: 'ci' },
    description: 'Chrome Web Store item id the publish verb uploads to.',
  },
  {
    name:        'CHROME_CLIENT_ID',
    owner:       'certificates',
    targets:     ['extension'],
    group:       'extension-stores',
    secret:      false,
    required:    false,
    delivery:    { extension: 'ci' },
    description: 'OAuth client id of the Chrome Web Store API credential.',
  },
  {
    name:        'CHROME_CLIENT_SECRET',
    owner:       'certificates',
    targets:     ['extension'],
    group:       'extension-stores',
    secret:      true,
    required:    false,
    delivery:    { extension: 'ci' },
    description: 'OAuth client secret of the Chrome Web Store API credential.',
  },
  {
    name:        'CHROME_REFRESH_TOKEN',
    owner:       'certificates',
    targets:     ['extension'],
    group:       'extension-stores',
    secret:      true,
    required:    false,
    delivery:    { extension: 'ci' },
    description: 'Refresh token the Chrome Web Store API credential mints its access tokens from.',
  },
  {
    name:        'FIREFOX_EXTENSION_ID',
    owner:       'certificates',
    targets:     ['extension'],
    group:       'extension-stores',
    secret:      false,
    required:    false,
    delivery:    { extension: 'ci' },
    description: 'Firefox Add-ons id the publish verb uploads to.',
  },
  {
    name:        'FIREFOX_API_KEY',
    owner:       'certificates',
    targets:     ['extension'],
    group:       'extension-stores',
    secret:      false,
    required:    false,
    delivery:    { extension: 'ci' },
    description: 'Firefox Add-ons API key (JWT issuer) from addons.mozilla.org.',
  },
  {
    name:        'FIREFOX_API_SECRET',
    owner:       'certificates',
    targets:     ['extension'],
    group:       'extension-stores',
    secret:      true,
    required:    false,
    delivery:    { extension: 'ci' },
    description: 'Firefox Add-ons API secret the JWT is signed with.',
  },
  {
    name:        'EDGE_PRODUCT_ID',
    owner:       'certificates',
    targets:     ['extension'],
    group:       'extension-stores',
    secret:      false,
    required:    false,
    delivery:    { extension: 'ci' },
    description: 'Microsoft Edge Add-ons product id the publish verb uploads to.',
  },
  {
    name:        'EDGE_CLIENT_ID',
    owner:       'certificates',
    targets:     ['extension'],
    group:       'extension-stores',
    secret:      false,
    required:    false,
    delivery:    { extension: 'ci' },
    description: 'Edge Add-ons API client id.',
  },
  {
    name:        'EDGE_API_KEY',
    owner:       'certificates',
    targets:     ['extension'],
    group:       'extension-stores',
    secret:      true,
    required:    false,
    delivery:    { extension: 'ci' },
    description: 'Edge Add-ons API key the publish request authenticates with.',
  },

  // ── testing — the credentials an opt-in test lane needs ──────────────────
  {
    name:        'OMEGA_TEST_FIREBASE_ADMIN_KEY',
    owner:       'backend',
    targets:     ['web', 'backend', 'desktop', 'extension'],
    group:       'testing',
    secret:      true,
    required:    false,
    delivery:    { web: 'ci', backend: 'env' },
    description: 'Path to a service-account JSON the extended test lanes mint custom tokens with — absent, those suites skip with a reason (GOOGLE_APPLICATION_CREDENTIALS is the fallthrough).',
  },
  {
    name:        'OMEGA_TEST_USER_UID',
    owner:       'backend',
    targets:     ['web', 'backend', 'desktop', 'extension'],
    group:       'testing',
    secret:      false,
    required:    false,
    delivery:    { web: 'ci', backend: 'env' },
    description: "Uid the extended test lanes sign in as — each framework's suite defaults to its own (`desktop-test-user` and siblings).",
  },
  {
    name:        'OMEGA_FONTAWESOME_ROOT',
    owner:       'assets',
    targets:     ['web', 'desktop', 'extension'],
    group:       'fontawesome',
    secret:      false,
    required:    false,
    delivery:    { web: 'ci', desktop: 'ci', extension: 'ci' },
    machineLocal: true,
    description: "Filesystem path to the developer's local Font Awesome Pro package — machine-local, so it never travels to CI (the free set is the fallthrough).",
  },

  // ── backend service keys ─────────────────────────────────────────────────
  // ONE key per AI provider ([#639](https://github.com/Omega-JS-Stack/omega/issues/639)):
  // the OMEGA_-prefixed twins are gone. A company-wide key is the COMPANY
  // layer of the .env cascade under the SAME name — never a second key name.
  {
    name:        'OPENAI_API_KEY',
    owner:       'backend',
    targets:     ['web', 'backend', 'extension'],
    group:       'backend-services',
    secret:      true,
    required:    false,
    delivery:    { web: 'ci', backend: 'env' },
    description: 'The OpenAI key wherever the backend calls OpenAI, and what the shared translation engine needs when translation.providers names chatgpt (the default "claude" provider needs none) — the brand .env wins, a company .env serves every brand that sets none.',
  },
  {
    name:        'ANTHROPIC_API_KEY',
    owner:       'backend',
    targets:     ['backend'],
    group:       'backend-services',
    secret:      true,
    required:    false,
    delivery:    { backend: 'env' },
    description: 'The Anthropic key wherever the backend calls Anthropic — the brand .env wins, a company .env serves every brand that sets none.',
  },
  {
    name:        'NEVERBOUNCE_API_KEY',
    owner:       'backend',
    targets:     ['backend'],
    group:       'backend-services',
    secret:      true,
    required:    false,
    delivery:    { backend: 'env' },
    description: 'NeverBounce API key — the first-choice email-validation provider on signup and marketing sync.',
  },
  {
    name:        'ZEROBOUNCE_API_KEY',
    owner:       'backend',
    targets:     ['backend'],
    group:       'backend-services',
    secret:      true,
    required:    false,
    delivery:    { backend: 'env' },
    description: 'ZeroBounce API key — the email-validation provider used when NeverBounce is unset.',
  },
  {
    match:       /^OAUTH2_[A-Z0-9_]+_CLIENT_(ID|SECRET)$/,
    owner:       'backend',
    targets:     ['backend'],
    group:       'backend-services',
    secret:      true,
    required:    false,
    delivery:    { backend: 'env' },
    description: "Per-provider OAuth2 client credentials for the backend's user-connection routes (OAUTH2_<PROVIDER>_CLIENT_ID / _CLIENT_SECRET) — pasted into the brand .env from each provider's console; the provider set is open, so the family is a pattern.",
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
    delivery:    { desktop: 'ci' },
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
    targets:     ['web'],
    group:       'machine',
    secret:      true,
    required:    false,
    requiredWhen: 'analytics.providers.google.id',
    delivery:    { web: 'ci' },
    deliverAs:   'GOOGLE_ANALYTICS_SECRET',
    description: "Measurement Protocol secret of the web target's GA4 stream — delivered as GOOGLE_ANALYTICS_SECRET on every verb (composed into dist/.env for backend, loaded into process.env for the others).",
  },
  {
    name:        'GOOGLE_ANALYTICS_SECRET_BACKEND',
    owner:       'analytics',
    targets:     ['backend'],
    group:       'machine',
    secret:      true,
    required:    false,
    requiredWhen: 'analytics.providers.google.id',
    delivery:    { backend: 'env' },
    deliverAs:   'GOOGLE_ANALYTICS_SECRET',
    description: "Measurement Protocol secret of the backend target's GA4 stream — delivered as GOOGLE_ANALYTICS_SECRET on every verb (composed into dist/.env for backend, loaded into process.env for the others).",
  },
  {
    name:        'GOOGLE_ANALYTICS_SECRET_DESKTOP',
    owner:       'analytics',
    targets:     ['desktop'],
    group:       'machine',
    secret:      true,
    publicAtRest: true,
    required:    false,
    requiredWhen: 'analytics.providers.google.id',
    delivery:    { desktop: 'bake' },
    deliverAs:   'GOOGLE_ANALYTICS_SECRET',
    description: "Measurement Protocol secret of the desktop target's GA4 stream — delivered as GOOGLE_ANALYTICS_SECRET on every verb (composed into dist/.env for backend, loaded into process.env for the others).",
  },
  {
    name:        'GOOGLE_ANALYTICS_SECRET_EXTENSION',
    owner:       'analytics',
    targets:     ['extension'],
    group:       'machine',
    secret:      true,
    publicAtRest: true,
    required:    false,
    requiredWhen: 'analytics.providers.google.id',
    delivery:    { extension: 'bake' },
    deliverAs:   'GOOGLE_ANALYTICS_SECRET',
    description: "Measurement Protocol secret of the extension target's GA4 stream — delivered as GOOGLE_ANALYTICS_SECRET on every verb (composed into dist/.env for backend, loaded into process.env for the others).",
  },
  {
    name:        'GOOGLE_ANALYTICS_SECRET_MOBILE',
    owner:       'analytics',
    targets:     ['mobile'],
    group:       'machine',
    secret:      true,
    required:    false,
    // No requiredWhen: MAM is parked (hard rule 4) — nothing mints, delivers or reads this key, so a rule here could only warn forever.
    deliverAs:   'GOOGLE_ANALYTICS_SECRET',
    description: "Measurement Protocol secret of the mobile target's GA4 stream — delivered as GOOGLE_ANALYTICS_SECRET on every verb (composed into dist/.env for backend, loaded into process.env for the others).",
  },

  // ── runtime-resolved: never hand-written into a brand .env ───────────────
  {
    name:        'GOOGLE_ANALYTICS_SECRET',
    owner:       'analytics',
    targets:     ['web', 'backend', 'desktop', 'extension'],
    group:       'runtime',
    secret:      true,
    required:    false,
    description: "A target's own Measurement Protocol secret — the delivery renames the brand-level GOOGLE_ANALYTICS_SECRET_<TARGET> to this name (deliverAs), so it is never composed from a brand key of the same name.",
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
 * Whether a key is a developer-machine value (`machineLocal: true`) that no
 * CI-secrets publisher may send ([#454](https://github.com/Omega-JS-Stack/omega/issues/454)).
 *
 * @param {string} name - The env var name.
 * @returns {boolean}
 */
function isMachineLocal(name) {
  const entry = envSchemaEntry(name);
  return Boolean(entry && entry.machineLocal);
}

/**
 * The NAMED keys a target reads, in schema order — the rendering lane's list
 * (which placeholders a brand .env carries, in which section). Pattern
 * families are excluded because they have no fixed name to render.
 *
 * NOT the delivery filter: composeTargetEnv (env.js) is, and it honors the
 * pattern families and `deliverAs` this list cannot express
 * ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)).
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
  DELIVERY_MODES,
  envFileGroups,
  envSchemaEntry,
  isMachineLocal,
  envKeysForTarget,
  generatedEnvKeys,
  requiredEnvKeys,
  devEnvKeys,
  devEnvKeyMap,
  envKeysByGroup,
};
