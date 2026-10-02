/**
 * Root `npm run test:journey` — the standing wizard-journey e2e, and the
 * tail of root `npm test` (Ian 2026-07-17: part of the greater sequence so
 * it gets regular coverage).
 *
 * Births a four-target brand OUTSIDE the monorepo from a real clone of the
 * brand template, set up by the real onboard wizard, links it, boots web +
 * backend, probes the homepage, and finishes with a headless creds-scrubbed
 * manage. Mechanics: @omega.js/devkit/test/journey-harness.
 *
 * Knobs:
 *   OMEGA_SKIP_JOURNEY=1    skip entirely (offline work, quick sequences)
 *   OMEGA_JOURNEY_KEEP=1    keep the temp brand after a green run
 *   OMEGA_JOURNEY_STRICT=1  unmet preconditions (network/java) fail, not skip
 */
const path = require('node:path');

const { runJourney } = require('@omega.js/devkit/test/journey-harness');

const MONOREPO_ROOT = path.join(__dirname, '..');

// The full consumer shape: every framework target, classy defaults. The .invalid
// URL (RFC 2606) keeps the live probe off anyone's real domain. No service may error
// on a virgin brand but the allowed set: `publishing` refuses a declared store format
// whose keys a headless run cannot collect, and `repo` (below).
const SPEC = {
  id: 'journey-brand',
  origin: 'https://github.com/journey-org/journey-brand-omega.git',
  url: 'https://journey-brand.invalid',
  targets: ['web', 'backend', 'desktop', 'extension'],
  expect: { brandName: 'Journey Brand', themeId: 'classy' },
  // The runtime legs run gh signed out on purpose, and the repo service
  // reports a signed-out gh as an error today (to become a skip, like a missing key).
  allowedServiceErrors: ['publishing', 'repo'],
};

async function main() {
  if (process.env.OMEGA_SKIP_JOURNEY === '1') {
    console.log('\nWizard journey — SKIPPED (OMEGA_SKIP_JOURNEY=1)\n');
    return;
  }

  const result = await runJourney({
    monorepoRoot: MONOREPO_ROOT,
    spec: SPEC,
    logDir: path.join(MONOREPO_ROOT, '.temp', 'journey'),
    keep: process.env.OMEGA_JOURNEY_KEEP === '1',
    strict: process.env.OMEGA_JOURNEY_STRICT === '1',
  });

  if (result.status === 'failed') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`\nWizard journey crashed: ${error.stack}\n`);
  process.exitCode = 1;
});
