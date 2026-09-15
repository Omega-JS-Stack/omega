/**
 * Repo service: every repo the brand owns on GitHub, in the two ROLES a brand
 * has ([#883](https://github.com/Omega-JS-Stack/omega/issues/883)).
 *
 *   source  `<brand.id>-omega`   the monorepo the brand is written in
 *   website `<brand.id>-<name>`  one per GitHub-hosted web target, built site only
 *
 * Config is ONE block, `repo: { provider: 'github', org }`, and its PRESENCE
 * is the switch (the same rule targets follow): no block, no repo service.
 * Nothing else is declared, because nothing else can be: every repo name
 * derives from `<brand.id>-<role>` and visibility is the brand root's
 * package.json `private` field.
 *
 * The org profile reconcile is gone with the `shared` switch that guarded it:
 * one org hosts as many brands as it likes, so no brand rewrites an org's
 * name, email or description (2026-09-11).
 */
const chalk = require('chalk').default;
const { repoBlock, sourceRepo, brandVisibility } = require('@omega.js/config');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { createGitHub } = require('./lib/github.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: (context) => {
    const block = repoBlock(context.brandConfig);

    if (!block) {
      return { skip: true, reason: 'no repo.org configured (set repo: { org } in config/omega.json5)' };
    }

    // A brand that declares an org but no `brand.id` has half an address, and
    // half an address addresses nothing: every repo name derives from the id.
    const source = sourceRepo(context.brandConfig);
    if (!source) {
      throw new Error(`repo.org is ${block.org} but the config names no brand.id: every repo derives from <brand.id>-<role>, so there is no repo to ensure`);
    }

    const visibility = brandVisibility(context.brandRoot);
    console.log(`    Repo: ${chalk.cyan(source.slug)} ${chalk.dim(`(${visibility})`)}`);

    // Tests inject a fake client via context.githubApi; the real one verifies
    // gh is installed + authenticated at construction
    const github = context.githubApi || createGitHub();

    // ONE plan read per walk (#883): the plan is the ORG's, not a target's, so
    // a brand with three web targets still asks GitHub once. Lazy, so a brand
    // with no website role never asks at all.
    let plan = null;
    const orgPlan = () => {
      if (plan === null) plan = github.ownerPlan(block.org);
      return plan;
    };

    return { githubApi: github, repoOrg: block, sourceRepoInfo: source, brandVisibility: visibility, orgPlan };
  },
});
