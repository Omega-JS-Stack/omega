/**
 * Copy signing artifacts into desktop/mobile targets.
 *
 * The copy itself is devkit's (`@omega.js/devkit/certs`, #678) — the ONE
 * delivery step every verb rides, so a desktop build reaches the same
 * artifacts through the same rules. What lives here is the manage-lane
 * FRAMING: which targets get a pass, the certificates config gate, and the
 * per-rule reporting.
 *
 * Sources are the certificates service's outputs under the signing tree —
 * {companyRoot||brandRoot}/.omega/certificates/apple/ (company-managed
 * brands share the company workspace's material); destinations are each
 * target's certs dir. Optional rules skip silently when the source is
 * missing; required rules warn (the desktop/mobile build would be unsigned).
 * A brand with no Apple artifacts at all (certificates disabled or never run)
 * is a quiet note, not a warning.
 *
 * A miss is warn-only: the dests are documented human drop points, so a dest
 * with no source in the tree is left exactly where the operator put it.
 */
const { join } = require('node:path');
const jetpack = require('fs-jetpack');
const chalk = require('chalk').default;

const { deliverCerts, resolveCertRules, certsSourceDir, CERT_FILE_MAP } = require('@omega.js/devkit/certs');

module.exports = async (context) => {
  const { brandRoot, companyRoot, brandConfig, mappedTargets, options = {} } = context;

  const certConfig = brandConfig.certificates;
  if (certConfig === false || certConfig?.enabled === false) {
    console.log(`      ${chalk.dim('⊘ certificates.enabled = false — no signing artifacts to disperse')}`);
    return { output: { certs: { reason: 'certificates.enabled = false' } } };
  }

  const certTargets = mappedTargets.filter((entry) => CERT_FILE_MAP[entry.target]);
  if (certTargets.length === 0) {
    console.log(`      ${chalk.dim('⊘ no desktop or mobile targets')}`);
    return { output: { certs: { reason: 'no desktop or mobile targets' } } };
  }

  // The certificates service's signing tree — company-shared when the brand
  // is company-managed, brand-local otherwise (the same resolution rule)
  const sourceRoot = companyRoot || brandRoot;
  const appleDir = certsSourceDir(sourceRoot);
  if (!jetpack.exists(appleDir)) {
    console.log(`      ${chalk.dim('⊘ no signing artifacts yet (.omega/certificates/apple is empty — the certificates service produces them)')}`);
    return { output: { certs: { reason: 'no signing artifacts yet' } } };
  }

  const brand = brandConfig.brand;
  let copied = 0;
  let current = 0;
  let skipped = 0;
  let warned = 0;
  let planned = 0;

  for (const entry of certTargets) {
    console.log(`      ${chalk.cyan(entry.dir)}:`);

    const result = deliverCerts({
      sourceRoot,
      targetDir: entry.path,
      target: entry.target,
      brand,
      dryRun: options.dryRun,
    });
    const delivered = new Set(result.copied);
    const unchanged = new Set(result.current);

    // The rules in their declared order — the delivery's own arrays carry the
    // outcome, the rules carry what a miss MEANS (optional vs required)
    for (const rule of resolveCertRules({ target: entry.target, brand })) {
      const destRel = rule.destRel || rule.dest;

      if (unchanged.has(destRel)) {
        console.log(`        ${chalk.dim(`✓ ${destRel} (current)`)}`);
        current++;
        continue;
      }

      if (delivered.has(destRel)) {
        if (options.dryRun) {
          console.log(`        ${chalk.cyan('[DRY RUN]')} Would copy ${chalk.cyan(destRel)}`);
          planned++;
        } else {
          console.log(`        ${chalk.green('✓')} ${chalk.cyan(destRel)}`);
          copied++;
        }
        continue;
      }

      // A miss: an unset env placeholder (the rule has no real path) or a
      // source that isn't there
      const detail = rule.destRel === null
        ? `env placeholder unset in ${rule.source}`
        : `source missing: ${join(appleDir, rule.sourceRel)}`;

      if (rule.optional) {
        console.log(`        ${chalk.dim(`⊘ ${destRel} (${rule.destRel === null ? 'env placeholder unset' : 'source missing'}, optional)`)}`);
        skipped++;
      } else {
        console.log(`        ${chalk.yellow('⚠')} ${chalk.cyan(destRel)} ${chalk.dim(`(${detail})`)}`);
        warned++;
      }
    }
  }

  const summary = { copied, current, skipped, warned, ...(options.dryRun ? { planned } : {}) };
  console.log(`      Summary: ${chalk.bold(copied)} copied, ${current} current, ${chalk.dim(skipped)} skipped, ${warned > 0 ? chalk.yellow(warned) : warned} warnings`);

  return {
    status: warned > 0 ? 'warned' : 'success',
    ...(warned > 0 ? { reason: `${warned} cert file(s) not dispersed` } : {}),
    output: { certs: summary },
  };
};
