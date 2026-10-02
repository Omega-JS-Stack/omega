/**
 * The .env sections, in canonical file order: the manager's canonical-order
 * lane renders a brand .env from this list, and every ENV_SCHEMA entry names
 * its section by `group`. `comment` is the boxed header, `notes` the plain
 * comment lines under it, and `file: false` marks a section that never
 * reaches a brand .env (env-schema.js's header says why).
 */

const ENV_GROUPS = [
  // The license leads the file: it is the one key a human pastes before anything
  // else runs, so it is the first line a brand owner reads.
  {
    id: 'license',
    comment: 'OMEGA license: your omegajs.dev account API key; a keyless brand runs with payments gated and omega attribution shown',
  },
  {
    id: 'omega',
    comment: 'Omega keys (auto-generated: minted at scaffold, and by manage when absent; rotate by replacing the value)',
    notes: [
      'Admin key: grants admin on your backend. Webhook key: authenticates third-party',
      'webhook deliveries. Namespace: the brand UUID namespace for deterministic ids.',
      'Unsubscribe key: signs the unsubscribe link in every email the backend sends.',
    ],
  },
  { id: 'github', comment: 'GitHub (repo + seo services): `gh auth login` works instead of a token' },
  { id: 'cloudflare', comment: 'Cloudflare (edge service + every DNS-writing flow): API token with Zone edit' },
  { id: 'namecheap', comment: 'Namecheap registrar (domain service)' },
  { id: 'google-oauth', comment: 'Google OAuth client (cloud, analytics, search, advertising services)' },
  { id: 'captcha', comment: "Classic reCAPTCHA SECRET key - the brand's own, from its GCP reCAPTCHA console (captcha service); the public site key is config, captcha.providers.recaptcha.siteKey" },
  {
    id: 'pixels',
    comment: 'Pixel access tokens (analytics service; the names @omega.js/backend reads)',
    notes: [
      'One token per platform: it CREATES the pixel on the ad account',
      '(analytics.providers.{meta,tiktok}.accountId) and signs the conversions it sends.',
      'Meta: a Business Manager system-user token with ads_management; an interactive',
      '`omega manage` walks you to the page, pastes it in here, and discovers the ad',
      'account itself. TikTok: set its advertiser id in config first.',
    ],
  },
  { id: 'monitoring', comment: 'Error monitoring (monitoring service, Sentry provider): a personal auth token with project+team write scopes' },
  { id: 'email-marketing', comment: 'Email marketing (campaigns + newsletter services: SendGrid + Beehiiv)' },
  { id: 'payment', comment: 'Payment providers (payment service; public halves live in omega.json5)' },
  { id: 'service-accounts', comment: 'Operator service accounts (forms/chat/email/server/assets services): paths to service-account JSON files' },
  { id: 'apple', comment: 'Apple signing (certificates service; desktop/mobile targets)' },
  {
    id: 'desktop-publishing',
    comment: 'Windows signing + Snap Store publishing (desktop target); the Apple half is its own section above',
    notes: [
      'Windows: the EV token PIN, the cert thumbprint path and signtool, read by the',
      'windows-sign CI job. Linux: the snapcraft credentials blob (`snapcraft export-login -`).',
    ],
  },
  {
    id: 'extension-stores',
    comment: 'Extension store API credentials (extension target: Chrome Web Store, Firefox Add-ons, Edge Add-ons); each store\'s own listing id is config, targets.<name>.listings.<browser>.id',
  },
  { id: 'fontawesome', comment: 'Font Awesome Pro (icons): path to the local Pro package dir' },
  { id: 'backend-services', comment: 'Backend service keys (composed into targets/backend/dist/.env by the env composer)' },
  // No `testing` group: a suite signs in as a persona the backend emulator
  // seeds, so it asks a brand for no key.
  {
    id: 'machine',
    comment: 'Auto-generated and persisted on the first real run; machine-owned, leave unset',
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

/** The groups that render into a real .env file, in canonical file order. */
function envFileGroups() {
  return ENV_GROUPS.filter((group) => group.file !== false);
}

module.exports = { ENV_GROUPS, envFileGroups };
