/**
 * resolveLicenseVerdict — the deploy-time license check
 * ([#320](https://github.com/Omega-JS-Stack/omega/issues/320)).
 *
 * A published OMEGA install needs a license to enable the payment system and
 * remove the omega attribution. A license is a subscription bought on
 * omegajs.dev and the KEY is that account's API key — opaque, one per account,
 * unlimited brands for now. The verdict is decided SERVER-side: the key plus
 * the brand id go to the omega brand's own backend and the resolved
 * subscription on the answer decides. No offline signing, no local shape check.
 *
 * This module is the "get the verdict" half only. Each target's deploy asks
 * once and bakes the answer into that artifact; runtime never phones home, so
 * a cancelled key holds until the next deploy (accepted, spec call 3).
 *
 * Honesty system, deliberately (spec call 6): plain readable code, no
 * obfuscation and no artifact signing. The legal backing is the package license
 * (Elastic License 2.0), whose terms forbid circumventing license-key
 * functionality and removing notices.
 */

const { isDemoProject } = require('@omega.js/config');
const { resolveSubscription } = require('@omega.js/account');

// The omega brand's own api host, HARDCODED. Every other api base in OMEGA is
// derived from a brand's `brand.url` (api.<host>) because it belongs to that
// brand — this one is the PRODUCT's license server, the same host for every
// brand that installs OMEGA, so config can never name it.
const LICENSE_ENDPOINT = 'https://api.omegajs.dev/omega/user';

const FETCH_TIMEOUT_MS = 30 * 1000;

// The one keyless answer: payments in test mode, attribution shown.
function keyless(reason) {
  return { licensed: false, payments: 'gated', attribution: 'shown', reason };
}

/**
 * Resolve what a deploy is licensed to ship.
 *
 * @param {object} input
 * @param {object} input.config - The resolved omega.json5 (brand.id, cloud.config.projectId).
 * @param {object} [input.env] - The environment holding OMEGA_LICENSE_KEY (default: process.env).
 * @param {function} [input.transport] - The fetch seam (default: global fetch).
 * @returns {Promise<{ licensed: boolean, payments: 'live'|'gated', attribution: 'removed'|'shown', reason: string }>}
 * @throws {Error} A key IS present but the server could not answer for it.
 */
async function resolveLicenseVerdict({ config, env = process.env, transport = fetch } = {}) {
  const projectId = config?.cloud?.config?.projectId;

  // Local dev, the test brands and every demo-* project run keyless forever
  // (spec call 5) — the carve-out comes FIRST, so a developer with a real key
  // in their shell still never spends a check on an emulator-only build.
  if (isDemoProject(projectId)) {
    return keyless(`${projectId} is a demo-* (emulator-only) project — no license check runs`);
  }

  const key = String(env.OMEGA_LICENSE_KEY || '').trim();
  if (!key) {
    return keyless('no OMEGA_LICENSE_KEY in the environment');
  }

  const url = new URL(LICENSE_ENDPOINT);
  url.searchParams.set('apiKey', key);
  // Sent on every check and ignored by the server today: it is what lets a
  // future per-key brand limit be a server-side change alone (spec call 1).
  url.searchParams.set('brandId', String(config?.brand?.id || ''));

  let response;
  try {
    response = await transport(url.toString(), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    // LOUD: a key is present, so the brand believes it is licensed. Shipping a
    // gated artifact because the network blinked would be the worst answer.
    throw new Error(`OMEGA_LICENSE_KEY is set but the license server could not be reached (${LICENSE_ENDPOINT}): ${e.message}`);
  }

  if (!response.ok) {
    throw new Error(`OMEGA_LICENSE_KEY was rejected by the license server (HTTP ${response.status}) — check the key on omegajs.dev`);
  }

  let body;
  try {
    body = await response.json();
  } catch (e) {
    throw new Error(`The license server's answer could not be read as JSON (${LICENSE_ENDPOINT}): ${e.message}`);
  }

  const user = body?.user;
  if (!user) {
    throw new Error(`OMEGA_LICENSE_KEY resolved no account on omegajs.dev — check the key on your account's API page`);
  }

  // The SAME derivation the backend and the client run, so "licensed" means
  // exactly what "subscribed" means everywhere else: `basic` is the reserved
  // free sentinel a cancelled or never-paid account resolves to.
  const { plan } = resolveSubscription(user);
  if (plan === 'basic') {
    return keyless('the OMEGA_LICENSE_KEY account has no active omegajs.dev subscription');
  }

  return {
    licensed: true,
    payments: 'live',
    attribution: 'removed',
    reason: `licensed by the omegajs.dev "${plan}" subscription`,
  };
}

/**
 * The verdict as an ARTIFACT records it: the three decided facts under one
 * shape, shared by every consumer — the website's `site.license` build fact,
 * the desktop/extension build stamp, and the backend's OMEGA_LICENSE_STATUS
 * (its `status` alone, because an env value is a string). The human `reason`
 * is dropped: it names the account's plan, and a shipped bundle is public.
 *
 * @param {object} verdict - A resolveLicenseVerdict answer.
 * @returns {{ status: 'licensed'|'keyless', payments: string, attribution: string }}
 */
function licenseStamp(verdict) {
  return {
    status: verdict.licensed ? 'licensed' : 'keyless',
    payments: verdict.payments,
    attribution: verdict.attribution,
  };
}

// What a build that ran no check at all carries (a dev build, a test, any lane
// that never asks) — the keyless verdict's own stamp, because that is exactly
// what such a build is.
const KEYLESS_STAMP = Object.freeze(licenseStamp(keyless('no license check ran')));

/**
 * The stamp a build bakes: a PRODUCTION build asks the license server once (a
 * key that cannot be answered for throws, gating the deploy); everything else
 * is keyless by definition and never phones home — spec call 5's "no check
 * fires outside deploy" half, with ONE home for all three baking targets.
 *
 * @param {object} input
 * @param {object} input.config - The resolved omega.json5.
 * @param {boolean} input.production - Whether this build ships.
 * @param {object} [input.env] - See resolveLicenseVerdict.
 * @param {function} [input.transport] - See resolveLicenseVerdict.
 * @returns {Promise<{ status: string, payments: string, attribution: string }>}
 */
async function resolveLicenseStamp({ config, production, env, transport }) {
  if (!production) return { ...KEYLESS_STAMP };

  return licenseStamp(await resolveLicenseVerdict({ config, env, transport }));
}

module.exports = { resolveLicenseVerdict, resolveLicenseStamp, licenseStamp, KEYLESS_STAMP, LICENSE_ENDPOINT };
