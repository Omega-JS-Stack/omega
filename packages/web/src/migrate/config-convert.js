/**
 * config-convert.js — legacy UJM config → omega.json5.
 *
 * Reads `src/_config.yml` + `config/ultimate-jekyll-manager.json` and
 * produces ONE omega.json5 object per the mapping table in docs/shared/config.md:
 *
 * - Shared sections to the TOP LEVEL with unified spellings:
 *   `brand` (+ merged `url`), `socials` (#483), `translation` (#526), `theme`, `oauth2`,
 *   `web_manager.firebase.app.config` → `cloud.{provider,config}`,
 *   `web_manager.payment` → `payment` (`processors` → `providers` — #425),
 *   `web_manager.sentry` → `monitoring.providers.sentry` (#485),
 *   flat `analytics.{google,meta,tiktok}` → `analytics.providers.<p>.id`,
 *   flat `advertising.<provider>` → `advertising.providers.<provider>`
 *   (`google-adsense` → `adsense` + camelCase slots — #23),
 *   `recaptcha` → `captcha.providers.recaptcha` (camelCase sub-keys),
 *   `cloudflare` → `edge.providers.cloudflare`.
 * - `meta` to the TOP LEVEL (#607 — a real shared section now, the site's
 *   default page meta; a page overrides it bare in frontmatter).
 * - Everything web-only under `targets.web`: presentation sections (favicon,
 *   manifest, icons),
 *   blog/engine config (permalink, pagination,
 *   collections, defaults, generators — codemod rule 8's home), the
 *   remaining `web_manager` client-settings blob (renamed `client` on the way
 *   out — #1: WebManager is not an OMEGA concept), and the UJM-json build
 *   settings (distribute, purgecss, imagemin, workflows).
 * - Dropped with notes: Jekyll machinery keys, the legacy `download` /
 *   `extension` page maps (#610 — derived from targets.desktop.releases and
 *   targets.extension.listings now), `webpack` (esbuild now), `gems` (Ruby is
 *   gone), secret-shaped keys (they belong in .env).
 *
 * The engine composes the runtime shape back together (cloud.config →
 * client.firebase.app.config, payment → client.payment) in
 * engine.js, so templates and the client keep their contract.
 */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const JSON5 = require('json5');
const { findSecretKeys } = require('@omega.js/config');

// _config.yml sections that were Jekyll/UJM machinery — gone with Jekyll
const DROPPED_JEKYLL_KEYS = [
  'exclude', 'include', 'plugins', 'plugins_dir', 'markdown', 'highlighter',
  'sass', 'compress_html', 'timezone', 'encoding', 'incremental', 'profile',
  'liquid', 'kramdown', 'destination', 'source', 'safe', 'keep_files',
];

// _config.yml sections that stay web-scoped (targets.web), in output order
const WEB_SECTION_ORDER = [
  'favicon', 'manifest', 'icons',
  'permalink', 'pagination',
  'collections', 'defaults', 'generators', 'client',
];

// _config.yml sections that land at the TOP level: `meta` is a real shared
// config section since #607 (the site's default page meta), not a web-only
// presentation block.
const SHARED_SECTION_ORDER = ['meta'];

// The UJM page maps #610 retired: the /download page, the /extension page and
// their shortlinks derive from `targets.desktop.releases` and
// `targets.extension.listings`, so carrying these would be a second home for
// the same links — and the validator refuses them.
const RETIRED_PAGE_MAPS = {
  download: 'targets.desktop.releases (curated onto site.targets.desktop.releasesUrl)',
  extension: 'targets.extension.listings',
};

// Legacy kebab-case sub-keys → the camelCase names every OMEGA config key uses (#23)
const ADSENSE_SLOT_KEYS = {
  'display-slot': 'displaySlot',
  'in-article-slot': 'inArticleSlot',
  'in-feed-slot': 'inFeedSlot',
  'multiplex-slot': 'multiplexSlot',
};
const RECAPTCHA_KEYS = { 'site-key': 'siteKey' };

/**
 * Copy an object with the named keys renamed, order preserved.
 * @param {object} object - source object
 * @param {Record<string, string>} map - old key → new key
 * @returns {object}
 */
function renameKeys(object, map) {
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    out[map[key] || key] = value;
  }
  return out;
}

/**
 * True for values that carry no information (null/undefined/{}/[]).
 */
function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * Convert the legacy configs of a consumer into an omega.json5 object.
 * @param {object} sources
 * @param {object|null} sources.jekyll - parsed _config.yml (or null)
 * @param {object|null} sources.ujm - parsed ultimate-jekyll-manager.json (or null)
 * @returns {{ omega: object, notes: string[] }}
 */
function convertConfig({ jekyll, ujm }) {
  const config = { ...(jekyll || {}) };
  const notes = [];
  const omega = {};
  const web = {};

  const take = (key) => {
    const value = config[key];
    delete config[key];
    return value;
  };

  // ---- brand (+ url folded in — site.url derives from brand.url)
  const brand = take('brand') || {};
  const url = take('url');
  if (url && !brand.url) brand.url = url;
  omega.brand = brand;

  const baseurl = take('baseurl');
  if (!isEmpty(baseurl) && baseurl !== '') omega.baseurl = baseurl;

  // ---- socials: a SHARED_SCHEMA key, so the TOP LEVEL is its home (#483).
  // A web load resolves `targets.web.socials` identically, but the handles are
  // brand identity — the scaffold emits them at the root and every surface
  // beyond the website reads them there.
  const socials = take('socials');
  if (!isEmpty(socials)) omega.socials = socials;

  // ---- translation: a SHARED_SECTIONS key, so the TOP LEVEL is its home (#526).
  // Legacy UJM translation was website-only and a web load resolves
  // `targets.web.translation` identically, but disperse copies the SHARED
  // sections — left in the target, the engine config is invisible to every
  // other target that translates (the extension's `_locales`).
  const translation = take('translation');
  if (!isEmpty(translation)) omega.translation = translation;

  // ---- theme (verbatim — templates read theme.nav.enabled etc.)
  const theme = take('theme');
  if (!isEmpty(theme)) omega.theme = theme;

  // ---- web_manager: extract the shared sections, keep the client blob
  // (legacyWebManager = the LEGACY config blob being migrated — the identifier
  // deliberately keeps the old product name; `omega` is the OUTPUT object.)
  const legacyWebManager = take('web_manager') || {};
  const firebaseConfig = legacyWebManager.firebase && legacyWebManager.firebase.app && legacyWebManager.firebase.app.config;
  if (!isEmpty(firebaseConfig)) {
    omega.cloud = { provider: 'firebase', config: firebaseConfig };
    delete legacyWebManager.firebase.app.config;
    if (isEmpty(legacyWebManager.firebase.app)) delete legacyWebManager.firebase.app;
    if (isEmpty(legacyWebManager.firebase)) delete legacyWebManager.firebase;
  }

  // ---- analytics: flat scalars → providers shape
  const analytics = take('analytics');
  if (!isEmpty(analytics)) {
    const providers = {};
    for (const [provider, id] of Object.entries(analytics)) {
      if (isEmpty(id) || id === '') continue;
      if (typeof id === 'object') providers[provider] = id; // already structured
      else providers[provider] = { id: String(id) };
    }
    if (!isEmpty(providers)) omega.analytics = { providers };
  }

  // ---- advertising: legacy flat providers → role-keyed providers shape.
  // The provider id drops its vendor prefix and every slot key goes camelCase
  // (#23) — the legacy world spelled both the other way.
  const advertising = take('advertising');
  if (!isEmpty(advertising)) {
    const providers = advertising.providers ? { ...advertising.providers } : { ...advertising };
    if (providers['google-adsense']) {
      providers.adsense = providers['google-adsense'];
      delete providers['google-adsense'];
    }
    if (providers.adsense) {
      providers.adsense = renameKeys(providers.adsense, ADSENSE_SLOT_KEYS);
    }
    omega.advertising = { ...(advertising.providers ? advertising : {}), providers };
  }

  // ---- recaptcha → captcha.providers.recaptcha (camelCase sub-keys, #23)
  const recaptcha = take('recaptcha');
  if (!isEmpty(recaptcha)) {
    omega.captcha = { providers: { recaptcha: renameKeys(recaptcha, RECAPTCHA_KEYS) } };
  }

  // ---- cloudflare → edge.providers.cloudflare (#23)
  const cloudflare = take('cloudflare');
  if (!isEmpty(cloudflare)) {
    omega.edge = { providers: { cloudflare } };
  }

  // ---- web_manager.payment → payment, with `processors` → `providers` (#425:
  // every role names its vendors under `providers`, payment included)
  if (!isEmpty(legacyWebManager.payment)) {
    omega.payment = legacyWebManager.payment;
    delete legacyWebManager.payment;

    if (!isEmpty(omega.payment.processors)) {
      omega.payment = renameKeys(omega.payment, { processors: 'providers' });
      notes.push('`payment.processors` renamed to `payment.providers` (#425 — one provider shape per role)');
    }

    // Legacy "disabled" idiom: credential keys set to `false` (somiibo ships
    // `stripe.publishableKey: false`). The schema types them as strings —
    // absent means not configured, so drop the false-valued keys.
    for (const provider of Object.values(omega.payment.providers || {})) {
      for (const [key, value] of Object.entries(provider)) {
        if (value === false && key !== 'enabled') {
          delete provider[key];
          notes.push(`payment credential \`${key}: false\` dropped (absent = not configured)`);
        }
      }
    }
  }

  // ---- web_manager.sentry → monitoring.providers.sentry (#485). The schema
  // picked the home: the manager's monitoring service reads that block's
  // presence as the brand's pick of Sentry, so a converted brand that left the
  // settings in the client blob had NO `monitoring` key and never provisioned a
  // project. The legacy shape is a client-module toggle — `{ enabled, config }`
  // — and the SDK knobs inside `config` are exactly the provider block.
  if (!isEmpty(legacyWebManager.sentry)) {
    const legacySentry = legacyWebManager.sentry;
    delete legacyWebManager.sentry;

    const monitoring = {};
    if (typeof legacySentry.enabled === 'boolean') monitoring.enabled = legacySentry.enabled;
    monitoring.providers = { sentry: legacySentry.config || {} };

    omega.monitoring = monitoring;
    notes.push('`web_manager.sentry` → `monitoring.providers.sentry` (#485) — the one error-reporting contract\'s config seam, which the manager\'s monitoring service reconciles');

    // The two `enabled` flags do NOT mean the same thing: the legacy one gated
    // the client module, while `monitoring.enabled` is only the manager's skip
    // switch — at runtime, DSN presence IS the signal. So a legacy-disabled
    // block that still carries a DSN starts reporting after the migration.
    if (legacySentry.enabled === false && monitoring.providers.sentry.dsn) {
      notes.push('`web_manager.sentry.enabled: false` carried a DSN — `monitoring.enabled: false` only skips the manager\'s provisioning service; DSN presence is the RUNTIME switch, so remove the dsn to keep reporting off');
    }
  }

  // ---- cookieConsent → consent (#383). The banner became a real gate, so the
  // block was renamed and most of its settings stopped existing: `palette` and
  // `theme` (the panel paints from the --omega-* tokens, which is the only way
  // it is right in both color modes), `type` (the visitor's region picks opt-in
  // vs opt-out — never a config key), and the copy, whose buttons no longer
  // mean what they meant ("I Understand" is not an Accept). `enabled` and
  // `position` are the two that survive unchanged. Carrying the old name would
  // emit a config that fails validation on the retired-key guard.
  if (!isEmpty(legacyWebManager.cookieConsent)) {
    const legacyConsent = legacyWebManager.cookieConsent;
    delete legacyWebManager.cookieConsent;

    const consent = {};
    if (typeof legacyConsent.enabled === 'boolean') consent.enabled = legacyConsent.enabled;

    const position = legacyConsent.config && legacyConsent.config.position;
    if (!isEmpty(position)) consent.config = { position };

    if (!isEmpty(consent)) legacyWebManager.consent = consent;
    notes.push('`web_manager.cookieConsent` → `client.consent` (#383); palette/theme/type and the banner copy are gone — the panel paints from tokens and the visitor\'s region picks opt-in vs opt-out');
  }

  const oauth2 = take('oauth2');
  if (!isEmpty(oauth2)) omega.oauth2 = oauth2;

  // ---- the UJM page maps #610 retired — dropped with the block that replaced them
  for (const [key, replacement] of Object.entries(RETIRED_PAGE_MAPS)) {
    const value = take(key);
    if (isEmpty(value)) continue;
    notes.push(`_config.yml \`${key}\` dropped (#610) — the page and its shortlinks derive from \`${replacement}\`; declare the target and delete the hand-written links`);
  }

  // ---- shared sections from _config.yml
  for (const key of SHARED_SECTION_ORDER) {
    const value = take(key);
    if (!isEmpty(value)) omega[key] = value;
  }

  // ---- web-scoped sections from _config.yml
  for (const key of WEB_SECTION_ORDER) {
    if (key === 'client') {
      if (!isEmpty(legacyWebManager)) web.client = legacyWebManager;
      continue;
    }
    const value = take(key);
    if (!isEmpty(value)) web[key] = value;
  }

  // ---- leftovers: Jekyll machinery dropped, unknown keys carried web-scoped
  for (const [key, value] of Object.entries(config)) {
    if (DROPPED_JEKYLL_KEYS.includes(key)) {
      notes.push(`_config.yml \`${key}\` dropped (Jekyll machinery)`);
      continue;
    }
    if (isEmpty(value)) continue;
    web[key] = value;
    notes.push(`_config.yml \`${key}\` carried to targets.web.${key} (unrecognized section — verify)`);
  }

  if (web.collections) notes.push('custom collections carried to targets.web.collections — engine-level custom collections land with the consumer-theme migrations (verify before deploy)');
  if (web.generators) notes.push('dynamic-page generators carried to targets.web.generators — verify engine coverage');
  if (web.defaults) notes.push('Jekyll per-collection defaults carried to targets.web.defaults (codemod rule 8)');

  // ---- ultimate-jekyll-manager.json → build settings
  if (ujm) {
    if (!isEmpty(ujm.distribute)) web.distribute = ujm.distribute;
    if (ujm.sass && !isEmpty(ujm.sass.purgecss)) web.purgecss = ujm.sass.purgecss;
    if (!isEmpty(ujm.imagemin)) web.imagemin = ujm.imagemin;
    if (ujm.github && !isEmpty(ujm.github.workflows)) web.workflows = ujm.github.workflows;
    if (ujm.webpack && ujm.webpack.target && ujm.webpack.target !== 'default') {
      notes.push(`ultimate-jekyll-manager.json \`webpack.target: ${ujm.webpack.target}\` dropped (esbuild pipeline has no target override)`);
    }
    if (Array.isArray(ujm.gems) && ujm.gems.length > 0) {
      notes.push(`ultimate-jekyll-manager.json \`gems\` dropped (${ujm.gems.join(', ')}) — Ruby is gone; port the gem's behavior if still needed`);
    }
  }

  omega.targets = { web };

  // ---- secrets never land in omega.json5
  const secretPaths = findSecretKeys(omega);
  for (const dotPath of secretPaths) {
    const segments = dotPath.split('.');
    const key = segments.pop();
    let node = omega;
    for (const segment of segments) node = node && node[segment];
    if (node) delete node[key];
    notes.push(`secret-shaped key \`${dotPath}\` dropped — move the value to .env`);
  }

  return { omega, notes };
}

/**
 * Read + parse the legacy config files of a consumer.
 * @param {string} root - consumer project root
 * @returns {{ jekyll: object|null, ujm: object|null, files: string[] }}
 */
function readLegacyConfigs(root) {
  const files = [];
  let jekyll = null;
  let ujm = null;

  const jekyllPath = path.join(root, 'src', '_config.yml');
  if (fs.existsSync(jekyllPath)) {
    jekyll = yaml.load(fs.readFileSync(jekyllPath, 'utf8')) || {};
    files.push(jekyllPath);
  }

  const ujmPath = path.join(root, 'config', 'ultimate-jekyll-manager.json');
  if (fs.existsSync(ujmPath)) {
    ujm = JSON5.parse(fs.readFileSync(ujmPath, 'utf8'));
    files.push(ujmPath);
  }

  return { jekyll, ujm, files };
}

/**
 * Serialize an omega config object to JSON5 text with the migration header.
 * @param {object} omega
 * @returns {string}
 */
function serializeOmega(omega) {
  const header = [
    '// omega.json5 — generated by `omega migrate` from src/_config.yml +',
    '// config/ultimate-jekyll-manager.json. Mapping: docs/shared/config.md.',
    '// Comments and trailing commas are welcome (JSON5).',
  ].join('\n');
  return `${header}\n${JSON5.stringify(omega, null, 2)}\n`;
}

module.exports = { convertConfig, readLegacyConfigs, serializeOmega };
