/**
 * Root `npm run test:journey`, the tail of root `npm test`: births a four-target
 * brand OUTSIDE the monorepo from a real clone of the brand template, set up by
 * the real onboard wizard, links it, boots web + backend, probes the homepage,
 * and ends on a headless creds-scrubbed manage. Mechanics: devkit's journey-harness.
 * Knobs:
 *   OMEGA_SKIP_JOURNEY=1    skip entirely (offline work, quick sequences)
 *   OMEGA_JOURNEY_KEEP=1    keep the temp brand after a green run
 *   OMEGA_JOURNEY_STRICT=1  unmet preconditions (network/java) fail, not skip
 */
const path = require('node:path');

const defineCases = require('@omega.js/devkit/test/define-cases');
const { JourneyRun, TIMEOUTS, checkPreconditions } = require('@omega.js/devkit/test/journey-harness');
const { TEMPLATE_URL } = require('../../packages/manager/src/lib/template-marker.js');

const MONOREPO_ROOT = path.join(__dirname, '..', '..');

// The full consumer shape: every framework target, classy defaults. The .invalid
// URL (RFC 2606) keeps the live probe off anyone's real domain. No service may error
// on a virgin brand but `publishing`, which refuses a declared store format whose keys
// a headless run cannot collect.
const SPEC = {
  id: 'journey-brand',
  origin: 'https://github.com/journey-org/journey-brand-omega.git',
  url: 'https://journey-brand.invalid',
  targets: ['web', 'backend', 'desktop', 'extension'],
  expect: { brandName: 'Journey Brand', themeId: 'classy' },
  // The runtime legs run gh signed out on purpose: the headless walk skips the
  // repo service for it, like a missing key.
  allowedServiceErrors: ['publishing'],
};

// The harness's own ceiling rejects first, naming the stage log; the case timeout is the backstop.
const MARGIN = 60000;

/** One case per stage: the method runs against the shared run, its detail line printed. */
function stage(name, method, timeout) {
  return {
    name,
    timeout,
    run: async ({ state }) => {
      const detail = await state.run[method]();
      state.run.log(`    ${detail}`);
    },
  };
}

module.exports = defineCases({
  type: 'suite',
  description: 'wizard journey',
  timeout: 900000,

  async setup(ctx) {
    if (process.env.OMEGA_SKIP_JOURNEY === '1') ctx.skip('OMEGA_SKIP_JOURNEY=1');

    const preconditions = await checkPreconditions(TEMPLATE_URL);
    if (!preconditions.ok) {
      const reason = `preconditions unmet: ${preconditions.missing.join('; ')}`;
      if (process.env.OMEGA_JOURNEY_STRICT === '1') throw new Error(`${reason} (OMEGA_JOURNEY_STRICT=1)`);
      ctx.skip(reason);
    }

    ctx.state.run = new JourneyRun({
      monorepoRoot: MONOREPO_ROOT,
      spec: SPEC,
      logDir: path.join(MONOREPO_ROOT, '.temp', 'journey'),
      keep: process.env.OMEGA_JOURNEY_KEEP === '1',
    });
    ctx.state.run.log(`\nWizard journey: brand ${SPEC.id} (${SPEC.targets.join(', ')}) OUTSIDE the monorepo, logs in ${ctx.state.run.logDir}\n`);
  },

  async cleanup(ctx) {
    // A skipped setup built no run
    if (ctx.state.run) await ctx.state.run.finish();
  },

  tests: [
    stage('the brand template clones as a "Use this template" copy', 'clone'),
    stage(`onboard replaces the template with ${SPEC.id}`, 'onboard'),
    stage('`omega i local` links every framework + the manager (one tree install)', 'link', TIMEOUTS.link + MARGIN),
    stage('`omega dev` boots web + backend emulator', 'bootDev'),
    stage('homepage renders branded + themed', 'homepage'),
    stage('sample content materialized (gitignored tree, rolling dates)', 'sampleContent'),
    stage('dev stack shuts down cleanly, leaving no orphaned emulator', 'shutdown'),
    stage('headless manage: update builds every target; no service errors beyond the allowed set', 'manage', TIMEOUTS.manage + MARGIN),
  ],
});
