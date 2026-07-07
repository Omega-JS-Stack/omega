/**
 * Manager registry — SERVICE_ORDER, per-service OPERATIONS, and the manager
 * defaults layer. This is omega-manager's config.js reborn for the brand-
 * monorepo world: the brand's config/omega.json5 is the single source of
 * user choices (no .brands/ mirror), durable derived data lives in
 * .omega/state.json, and per-run transients in .omega/runs/{ts}.json.
 *
 * Services port over from omega-manager in stages. The full provisioning
 * order there is:
 *
 *   github → cloudflare → domain → firebase → recaptcha → analytics →
 *   search-console → adsense → sendgrid → beehiiv → payment → slapform →
 *   chatsy → replyify → server → assets → certificates → seo → disperse →
 *   update → account → migrations → bookmark → testing
 *
 * Ported so far: the local trio that makes a brand monorepo itself work —
 * workspace (structure/config health), update (install + build every app),
 * testing (per-target health checks). External-API services join this list
 * one at a time, keeping their omega-manager names and operation granularity.
 */

// =============================================================================
// APP DIRECTORY CONVENTIONS
// =============================================================================
// apps/<dir> → target mapping when the app doesn't declare its target in its
// own omega.json5. Exact match or `<name>-*` prefix (apps/website-docs → web).
const APP_DIR_TARGETS = {
  website: 'web',
  backend: 'backend',
  desktop: 'desktop',
  extension: 'extension',
  mobile: 'mobile',
};

// Inverse: canonical app dir name to suggest when an enabled target has no app
const TARGET_APP_DIRS = Object.fromEntries(
  Object.entries(APP_DIR_TARGETS).map(([dir, target]) => [target, dir]),
);

// =============================================================================
// DEFAULT SETTINGS - The manager defaults layer under every brand config
// =============================================================================
// Deliberately minimal: omega-manager's giant DEFAULTS block is service-owned
// data — each section moves here WITH its service port (cloudflare settings
// arrive with the cloudflare service, etc.). Never park defaults for services
// that don't exist here yet.
const DEFAULTS = {
  // Whether the brand is active (disabled brands are skipped)
  enabled: true,
};

// =============================================================================
// SERVICE ORDER - Services run in this order due to dependencies
// =============================================================================
const SERVICE_ORDER = [
  'workspace',  // brand monorepo structure + config health — everything depends on a sane workspace
  'update',     // installs deps + builds every app
  'testing',    // health checks after everything else ran
];

// =============================================================================
// OPERATIONS CONFIG - What operations to run for each service
// =============================================================================
const OPERATIONS = {
  workspace: [
    { name: 'structure', ensure: true },  // Root workspaces + an app per enabled target
    { name: 'config', ensure: true },     // omega.json5 loads + validates (brand and per-app)
    { name: 'gitignore', ensure: true },  // .omega/ is gitignored (state never gets committed)
  ],

  update: [
    { name: 'targets', write: true },     // Installs deps, builds every app
  ],

  testing: [
    { name: 'target-checks', ensure: true }, // Per-target health checks (build output, backend files)
  ],
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Replace `{ key }` placeholders (spaces allowed) in every string of an
 * object tree — omega-manager's templateObject, minus the node-powertools
 * dependency. Unknown keys are left untouched.
 *
 * @param {*} obj - Any value; strings are templated, objects/arrays recursed
 * @param {Object} data - Placeholder values (e.g. { domain: 'somiibo.com' })
 * @returns {*} - Same shape with placeholders substituted
 */
function templateObject(obj, data) {
  if (typeof obj === 'string') {
    return obj.replace(/\{\s*([\w.]+)\s*\}/g, (match, key) => {
      return key in data ? data[key] : match;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => templateObject(item, data));
  }

  if (obj !== null && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = templateObject(value, data);
    }
    return result;
  }

  return obj;
}

module.exports = {
  APP_DIR_TARGETS,
  TARGET_APP_DIRS,
  DEFAULTS,
  SERVICE_ORDER,
  OPERATIONS,
  templateObject,
};
