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
    description: "The parasite-SEO content repos (`seo.github.content[]`) the seo service reconciles; a `config/seo.json5` sidecar is read by the config loader as the `seo` section, merged and checked like the base file.",
  },
  {
    path:        'seo.github.content',
    type:        'array',
    required:    false,
    description: 'The parasite-SEO content items, one public repo `<owner>/<name>` each, which the seo service creates and keeps matching its template.',
  },
  {
    path:        'seo.github.content.name',
    type:        'string',
    required:    false,
    description: "The item's repo name: the repo is `<owner>/<name>`, and an item with no name is skipped as an error.",
  },
  {
    path:        'seo.github.content.owner',
    type:        'string',
    required:    false,
    description: "The GitHub user or org the item's repo lives under (default: `repo.owner`).",
  },
  {
    path:        'seo.github.content.template',
    type:        'string',
    required:    false,
    description: "The seo template the item's repo is generated from (default: `developer-tool`).",
  },
  {
    path:        'seo.github.content.title',
    type:        'string',
    required:    false,
    description: "The README heading and the generated package.json description's lead.",
  },
  {
    path:        'seo.github.content.description',
    type:        'string',
    required:    false,
    description: "The repo description, the README's lead sentence and the generated package.json description.",
  },
  {
    path:        'seo.github.content.features',
    type:        'array',
    required:    false,
    description: "The README's Features list, one string per bullet.",
  },
  {
    path:        'seo.github.content.custom',
    type:        'string',
    required:    false,
    description: 'Markdown the README carries after its Features list.',
  },
  {
    path:        'seo.github.content.topics',
    type:        'array',
    required:    false,
    description: "The repo's topics, also the generated package.json keywords.",
  },
  {
    path:        'seo.github.content.cta',
    type:        'object',
    required:    false,
    description: "The item's links ({ platform, url }); each falls back to `brand.url`.",
  },
  {
    path:        'seo.github.content.cta.platform',
    type:        'string',
    required:    false,
    description: "The website link: the repo homepage and the README's website buttons (falls back to `cta.url`).",
  },
  {
    path:        'seo.github.content.cta.url',
    type:        'string',
    required:    false,
    description: "The download link the README's download buttons point at.",
  },
  {
    path:        'seo.github.content.author',
    type:        'object',
    required:    false,
    description: "The item's own GitHub identity ({ tokenEnv, git }), for a repo owned by a separate account.",
  },
  {
    path:        'seo.github.content.author.tokenEnv',
    type:        'string',
    required:    false,
    description: "The NAME of a `.env` variable holding a GitHub token for this item's API calls (a parasite repo owned by another account); the walk reads it from the environment and fails the item when it is unset.",
  },
  {
    path:        'seo.github.content.author.git',
    type:        'object',
    required:    false,
    description: "The { name, email } the item's Contents API commits carry as author and committer.",
  },
];

module.exports = { MANAGER_RULES };
