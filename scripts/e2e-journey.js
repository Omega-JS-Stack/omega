/**
 * Root `npm run test:journey` — the standing wizard-journey e2e, and the
 * tail of root `npm test` (Ian 2026-07-17: part of the greater sequence so
 * it gets regular coverage).
 *
 * Births a four-target brand OUTSIDE the monorepo through the real onboard
 * wizard, links it, runs every setup, boots web + backend, probes the
 * homepage, and finishes with a headless creds-scrubbed manage — the cp194
 * rehearsal as a repeatable lane. Mechanics: @omega.js/devkit/test/journey-harness.
 *
 * Knobs:
 *   OMEGA_SKIP_JOURNEY=1    skip entirely (offline work, quick sequences)
 *   OMEGA_JOURNEY_KEEP=1    keep the temp brand after a green run
 *   OMEGA_JOURNEY_STRICT=1  unmet preconditions (network/java) fail, not skip
 */
const path = require('node:path');

const { runJourney } = require('@omega.js/devkit/test/journey-harness');

const MONOREPO_ROOT = path.join(__dirname, '..');

// The full consumer shape: every framework target, classy defaults. The
// .invalid URL (RFC 2606) guarantees the never-deployed live probe can never
// false-pass on someone else's real domain. allowedServiceErrors is EMPTY
// since cp196: a never-deployed brand's live checks nudge (warn), so NO
// service may error on a virgin brand.
const SPEC = {
  id: 'journey-brand',
  url: 'https://journey-brand.invalid',
  targets: ['web', 'backend', 'desktop', 'extension'],
  expect: { brandName: 'Journey Brand', themeId: 'classy' },
  allowedServiceErrors: [],
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
