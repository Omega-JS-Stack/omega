/**
 * core — the ONE place error-reporting policy lives (#380).
 *
 * Pure functions, zero runtime assumptions: no SDK, no `process`, no DOM. The
 * browser bundle imports this file, so an env read here would be a
 * ReferenceError on a web page (esbuild defines only the NODE_ENV key) — every
 * environment signal is passed IN as a gate. `env.js` is the Node/Electron side
 * of that seam.
 *
 * Policy it owns, once for every target:
 *   - config resolution from omega.json5's `monitoring` role section, DSN
 *     presence being the enable signal (no separate `enabled` flag — matches
 *     @omega.js/backend convention: a config block's credentials are its switch)
 *   - the release tag, from the host's own version identity
 *   - user normalization with the email SCRUBBED BY DEFAULT (the uid stays —
 *     it is the join key to the account, and it is not PII on its own)
 *   - the client-side framework-bundle filter: browser events report ONLY when
 *     they come from OUR bundles. User-land page scripts, browser extensions
 *     injecting into the page, and cross-origin "Script error." noise never do.
 *
 * The SDK is never loaded from here. Nothing in this file can turn reporting
 * ON either: it can only say whether a host SHOULD boot one.
 */

const DEFAULTS = {
  dsn:              '',
  environment:      null,   // null = the host's gate decides (production / development)
  sampleRate:       1,      // error events kept, 0..1 — the sampling knob (Sentry-native)
  tracesSampleRate: 0.1,
  attachScreenshot: false,
  scrubEmail:       true,   // PII off by default — set false to opt IN to emails
  // Browser only: the URL fragments that identify OUR bundles. Both @omega.js/web
  // and @omega.js/extension serve every framework bundle (the client runtime
  // included) out of `/assets/js/`, so one default covers both surfaces.
  bundlePatterns:   ['/assets/js/'],
};

// A resolved-but-off result. `options` still comes back so a caller can log what
// it read.
function disabled(options, reason) {
  return { shouldEnable: false, options, reason };
}

/**
 * Resolve the runtime config and decide whether reporting should boot.
 *
 * Reads omega.json5's `monitoring` role section; the `provider` discriminator is
 * stripped so the remaining keys feed the SDK's init directly.
 *
 * @param {object} section - the `monitoring` config block (target-resolved)
 * @param {object} [gates] - the host's environment signals
 * @param {boolean} [gates.killed] - a kill switch tripped (env var, test runner)
 * @param {string} [gates.killedReason] - what tripped it, for the log line
 * @param {boolean} [gates.isProduction] - this run ships telemetry
 * @param {boolean} [gates.allowInDev] - report anyway outside production
 * @returns {{ shouldEnable: boolean, options: object, reason: string|null }}
 */
function resolveConfig(section, gates) {
  gates = gates || {};

  const options = { ...DEFAULTS, ...(section || {}) };
  delete options.provider;

  if (gates.killed) {
    return disabled(options, gates.killedReason || 'disabled by the host');
  }
  if (!options.dsn) {
    return disabled(options, 'no dsn set');
  }
  if (!gates.isProduction && !gates.allowInDev) {
    return disabled(options, 'not a production run (set OMEGA_SENTRY_FORCE=true to override)');
  }

  if (!options.environment) {
    options.environment = gates.isProduction ? 'production' : 'development';
  }

  return { shouldEnable: true, options, reason: null };
}

/**
 * Normalize a @omega.js/client / firebase / admin user into the minimal shape
 * the SDK wants. The email is PII: it rides ONLY when the host explicitly opts
 * in with `monitoring.scrubEmail: false`.
 *
 * @param {object} user - a user-ish object carrying uid/id and maybe email
 * @param {object} [options] - the resolved monitoring options
 * @returns {object|null} { id, email? } — null when there is nothing safe to send
 */
function normalizeUser(user, options) {
  if (!user) return null;

  const scrubEmail = (options || {}).scrubEmail !== false;
  const out = {};

  if (user.uid)     out.id = user.uid;
  else if (user.id) out.id = user.id;
  if (user.email && !scrubEmail) out.email = user.email;

  return Object.keys(out).length === 0 ? null : out;
}

/**
 * Build the release tag from the host's own version identity. ONE format on
 * every target (Ian, 2026-08-20): `<brand.id>@<version>` — a Sentry release is
 * comparable across the backend, the desktop app and the browser bundles only
 * when they spell it the same way. The brand id is required config, so a tag
 * missing one is a config hole, not a second format: no id, no tag.
 *
 * The version is the host's own — @omega.js/backend's functions package
 * version, @omega.js/desktop's app version, the browser blob's app version.
 *
 * @param {object} identity - { id, version }
 * @returns {string|undefined} the tag, or undefined when either half is missing
 */
function releaseTag(identity) {
  const { id, version } = identity || {};
  if (!id || !version) return undefined;
  return `${id}@${version}`;
}

/**
 * Every stack-frame filename an event carries (exception frames first, then the
 * threads a hung-renderer report uses).
 */
function eventFrameFilenames(event) {
  const values = [
    ...((event && event.exception && event.exception.values) || []),
    ...((event && event.threads && event.threads.values) || []),
  ];

  return values.flatMap((value) => ((value.stacktrace && value.stacktrace.frames) || [])
    .map((frame) => frame.filename || frame.abs_path || '')
    .filter(Boolean));
}

/**
 * The client-side doctrine gate (#380): a browser event reports ONLY when our
 * own framework code is on its stack.
 *
 * An event with no matching frame is DROPPED, and that includes an event with no
 * frames at all — a cross-origin `Script error.` is exactly the third-party noise
 * this exists to kill. Deliberate `omega.sentry().captureException(...)` calls
 * are unaffected: they are thrown from page bundles, which ARE our bundles.
 *
 * @param {string[]} [patterns] - URL fragments identifying our bundles
 * @returns {(event: object) => boolean} true when the event may report
 */
function createBundleFilter(patterns) {
  const fragments = (patterns || DEFAULTS.bundlePatterns).filter(Boolean);

  return function isFrameworkEvent(event) {
    const filenames = eventFrameFilenames(event);
    return filenames.some((filename) => fragments.some((fragment) => filename.includes(fragment)));
  };
}

module.exports = {
  DEFAULTS,
  resolveConfig,
  normalizeUser,
  releaseTag,
  eventFrameFilenames,
  createBundleFilter,
};
