/**
 * Ensure omega.json5 health. The brand file is the manager's input — a brand
 * config that fails to load (parse error, secret-shaped keys, legacy targets
 * array) or fails schema validation is an ERROR: there is nothing sound to
 * reconcile services against. App-level findings are warnings — each
 * framework's own setup/audit is the hard gate for its surface.
 */
const chalk = require('chalk').default;

const { loadConfig, hasOmegaConfig } = require('@omegajs/config');

module.exports = async ({ brand, apps }) => {
  // Brand config failed to LOAD (thrown by @omegajs/config — secrets, parse, targets array)
  if (brand.configError) {
    console.log(`      ${chalk.red('✗')} ${brand.configError}`);
    return { status: 'error', error: brand.configError };
  }

  // Brand config loaded but has schema findings
  if (brand.configErrors.length > 0) {
    for (const error of brand.configErrors) {
      console.log(`      ${chalk.red('✗')} brand: ${error}`);
    }
    return { status: 'error', error: `brand config invalid: ${brand.configErrors.join('; ')}` };
  }

  console.log(`      ${chalk.green('✓')} brand config valid ${chalk.dim(`(${brand.files?.app || 'config/omega.json5'})`)}`);

  // Per-app validation for apps that carry their own config and map to a target
  const findings = [];
  for (const app of apps) {
    if (!app.target || !hasOmegaConfig(app.path)) continue;

    try {
      const { errors } = loadConfig(app.path, app.target);
      for (const error of errors) {
        findings.push(`${app.name}: ${error}`);
      }
    } catch (error) {
      // App config that cannot load at all (secrets, parse) is still a hard stop
      console.log(`      ${chalk.red('✗')} ${app.name}: ${error.message}`);
      return { status: 'error', error: `${app.name}: ${error.message}` };
    }
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      console.log(`      ${chalk.yellow('⚠')} ${finding}`);
    }
    return { status: 'warned', output: { findings } };
  }

  return null;
};
