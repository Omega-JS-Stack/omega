/**
 * Schema rules for the keys the manager's services (and the backend's content
 * generators) read or write back: the brand switch, service switches, and the
 * Stripe, GA4, devlog, blog and SEO engine data. The four zero-data switches
 * default ON here and are materialized into brand files; the engine data's
 * defaults stay in the manager's config.js.
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
