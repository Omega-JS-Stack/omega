/**
 * Schema rules for the keys the manager's services (and the backend's content
 * generators) read or write back: the brand switch, service switches, and the
 * Stripe, GA4, devlog, blog, SEO and account engine data. The zero-data
 * switches default ON here and are materialized into brand files. What stays
 * in the manager's MANAGER_DEFAULTS is data no schema default can carry; its
 * table says why.
 */

const MANAGER_RULES = [
  {
    path:        'enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: 'Whether the brand is active. `false` makes the manager skip it: a company run stamps it but never spawns its walk.',
  },
  {
    path:        'server.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: "false (or `server: false`) skips the manager's server service, which registers this brand in the company server's brands collection.",
  },
  {
    path:        'assets.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: "false (or `assets: false`) skips the manager's assets service, which derives the brand's visual collateral from its logo sources.",
  },
  {
    path:        'payment.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: "false skips the manager's payment service: no provider account, product, webhook or Radar reconciliation for this brand.",
  },
  {
    path:        'certificates.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: "false (or `certificates: false`) skips the manager's certificates service: no bundle ids, no signing certificates, no provisioning profiles for this brand. A brand with no desktop or mobile target is skipped either way.",
  },
  {
    path:        'account.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: "false (or `account: false`) skips the manager's account service: no managed accounts are created or converged in the brand's Firebase Auth.",
  },
  {
    path:        'account.admins',
    type:        'array',
    required:    false,
    default:     [{ email: 'support@{domain}', account: true, marketing: true }],
    materialize: false,
    description: "The accounts the account service keeps in the brand's Firebase Auth ([{ email, account, marketing }], '{domain}' templating to the brand domain): `account: true` ensures the user with its derived password, roles.admin and the top plan, `marketing: true` pushes the contact to the marketing providers, and any other user holding roles.admin fails the service. Resolved, never written into a brand file, so a list the company config sets once still wins.",
  },
  {
    path:        'payment.providers.stripe.updateAccountInfo',
    type:        'boolean',
    required:    false,
    description: "false leaves the Stripe account's business profile alone instead of diffing it to the brand's name, url and support email.",
  },
  {
    path:        'payment.providers.stripe.radar',
    type:        'array',
    required:    false,
    description: "The Radar fraud rules ([{ action, predicate, description }]) the payment service prints as guidance: Radar has no API, so a human applies them in the Dashboard.",
  },
  {
    path:        'payment.providers.stripe.radarConfirmed',
    type:        'boolean',
    required:    false,
    description: 'Machine-written: the Radar rules were applied by hand in the Dashboard. The confirmation is the record, because nothing can read them back.',
  },
  {
    path:        'payment.providers.stripe.disputesConfirmed',
    type:        'boolean',
    required:    false,
    description: 'Machine-written: Enhanced Dispute Protection was switched on by hand in the Dashboard. The confirmation is the record, because nothing can read it back.',
  },
  {
    path:        'analytics.providers.google.timeZone',
    type:        'string',
    required:    false,
    description: 'The GA4 property reporting time zone the analytics service uses when it creates the property.',
  },
  {
    path:        'analytics.providers.google.currency',
    type:        'string',
    required:    false,
    description: 'The GA4 property reporting currency the analytics service uses when it creates the property.',
  },
  {
    path:        'analytics.providers.google.enhancedMeasurement',
    type:        'object',
    required:    false,
    description: "The GA4 web streams' Enhanced Measurement switches ({ scrollsEnabled, siteSearchEnabled, … }) the analytics service diffs every stream to.",
  },
  {
    path:        'devlog.providers.ghostii',
    type:        'object',
    required:    false,
    description: 'The devlog writer and its settings (orgs, lookbackDays, excludeRepos, excludeCommits, excludeTopics, includePrivate, postPath, destinations, overrides): the manager\'s devlog pipeline reads them here.',
  },
  {
    path:        'blog.enabled',
    type:        'boolean',
    required:    false,
    description: "true lets the backend's daily blog auto-publisher run; absent or false, it skips.",
  },
  {
    path:        'blog.providers',
    type:        'object',
    required:    false,
    description: 'The blog writer, a KEY under `providers` (ghostii when none is picked).',
  },
  {
    path:        'blog.content',
    type:        'object|array',
    required:    false,
    description: 'The blog pipeline entries ({ sources, categories, links, postPath, … }), one object or a list.',
  },
  {
    path:        'seo.enabled',
    type:        'boolean',
    required:    false,
    default:     true,
    description: "false (or `seo: false`) skips the manager's seo service.",
  },
  {
    path:        'seo.github',
    type:        'object',
    required:    false,
    description: "The parasite-SEO content repos (`seo.github.content[]`) the seo service reconciles; a `config/seo.json5` sidecar merges over it.",
  },
];

module.exports = { MANAGER_RULES };
