/**
 * The developer keys this brand's declared formats cannot ship without.
 *
 * The setup gate already collected what an interactive run could, so by here
 * the environment IS the answer. What is still missing is a publish that will
 * die on a runner with a half-finished store, which is why this refuses rather
 * than warns: the refusal carries the same line shape push-secrets prints
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)), naming the key,
 * the declaration that requires it, and the walk that collects it.
 *
 * Names only: a value never reaches the log.
 */
const chalk = require('chalk').default;
const { missingShipKeys, shipKeyRefusal } = require('@omega.js/devkit/ship-plan');

module.exports = (context) => {
  const plan = context.shipping.flatMap((target) => target.formats);
  const missing = missingShipKeys(plan);

  if (missing.length > 0) {
    return {
      status: 'error',
      error: shipKeyRefusal(missing),
      output: { keys: { missing: missing.map((entry) => entry.key) } },
    };
  }

  const configured = [...new Set(plan.flatMap((entry) => entry.requires))];

  if (configured.length === 0) {
    // The sanctioned answer for a brand that ships only release assets: the
    // dmg, the deb, the AppImage and the zips need no credential at all.
    console.log(`      ${chalk.green('✓')} No ship credentials needed ${chalk.dim('(every declared format ships to the releases repo)')}`);
    return { output: { keys: { configured } } };
  }

  console.log(`      ${chalk.green('✓')} Ship credentials: ${chalk.cyan(configured.join(', '))}`);

  return { output: { keys: { configured } } };
};
