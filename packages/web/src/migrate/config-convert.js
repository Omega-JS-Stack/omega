/**
 * config-convert.js — legacy UJM config → omega.json5.
 *
 * Reads `src/_config.yml` + `config/ultimate-jekyll-manager.json` and
 * produces ONE omega.json5 object per the mapping table in docs/config.md:
 *
 * - Shared sections to the TOP LEVEL with unified spellings:
 *   `brand` (+ merged `url`), `theme`, `oauth2`,
 *   `web_manager.firebase.app.config` → `firebaseConfig`,
 *   `web_manager.payment` → `payment`,
 *   flat `analytics.{google,meta,tiktok}` → `analytics.providers.<p>.id`.
 * - Everything web-only under `targets.web`: presentation sections (meta,
 *   socials, download, extension, favicon, manifest, icons, recaptcha,
 *   cloudflare, translation), blog/engine config (permalink, pagination,
 *   collections, defaults, generators — codemod rule 8's home), the
 *   remaining `web_manager` client-settings blob, and the UJM-json build
 *   settings (distribute, purgecss, imagemin, workflows).
 * - Dropped with notes: Jekyll machinery keys, `webpack` (esbuild now),
 *   `gems` (Ruby is gone), secret-shaped keys (they belong in .env).
 *
 * The engine composes the runtime shape back together (firebaseConfig →
 * web_manager.firebase.app.config, payment → web_manager.payment) in
 * engine.js, so templates and the client keep their contract.
 */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const JSON5 = require('json5');
const { findSecretKeys } = require('@omegajs/config');

// _config.yml sections that were Jekyll/UJM machinery — gone with Jekyll
const DROPPED_JEKYLL_KEYS = [
  'exclude', 'include', 'plugins', 'plugins_dir', 'markdown', 'highlighter',
  'sass', 'compress_html', 'timezone', 'encoding', 'incremental', 'profile',
  'liquid', 'kramdown', 'destination', 'source', 'safe', 'keep_files',
];

// _config.yml sections that stay web-scoped (targets.web), in output order
const WEB_SECTION_ORDER = [
  'meta', 'socials', 'download', 'extension', 'favicon', 'manifest', 'icons',
  'recaptcha', 'cloudflare', 'translation', 'permalink', 'pagination',
  'collections', 'defaults', 'generators', 'web_manager',
];

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

  // ---- theme (verbatim — templates read theme.nav.enabled etc.)
  const theme = take('theme');
  if (!isEmpty(theme)) omega.theme = theme;

  // ---- web_manager: extract the shared sections, keep the client blob
  const webManager = take('web_manager') || {};
  const firebaseConfig = webManager.firebase && webManager.firebase.app && webManager.firebase.app.config;
  if (!isEmpty(firebaseConfig)) {
    omega.firebaseConfig = firebaseConfig;
    delete webManager.firebase.app.config;
    if (isEmpty(webManager.firebase.app)) delete webManager.firebase.app;
    if (isEmpty(webManager.firebase)) delete webManager.firebase;
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

  if (!isEmpty(webManager.payment)) {
    omega.payment = webManager.payment;
    delete webManager.payment;

    // Legacy "disabled" idiom: credential keys set to `false` (somiibo ships
    // `stripe.publishableKey: false`). The schema types them as strings —
    // absent means not configured, so drop the false-valued keys.
    for (const processor of Object.values(omega.payment.processors || {})) {
      for (const [key, value] of Object.entries(processor)) {
        if (value === false && key !== 'enabled') {
          delete processor[key];
          notes.push(`payment credential \`${key}: false\` dropped (absent = not configured)`);
        }
      }
    }
  }

  const oauth2 = take('oauth2');
  if (!isEmpty(oauth2)) omega.oauth2 = oauth2;

  // ---- web-scoped sections from _config.yml
  for (const key of WEB_SECTION_ORDER) {
    if (key === 'web_manager') {
      if (!isEmpty(webManager)) web.web_manager = webManager;
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
    '// config/ultimate-jekyll-manager.json. Mapping: docs/config.md.',
    '// Comments and trailing commas are welcome (JSON5).',
  ].join('\n');
  return `${header}\n${JSON5.stringify(omega, null, 2)}\n`;
}

module.exports = { convertConfig, readLegacyConfigs, serializeOmega };
