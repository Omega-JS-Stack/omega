/**
 * Service gate for .env secrets (cp114, Ian: "check that it asks for
 * them") — the ONE way a service declares the env vars its APIs need.
 *
 * All present → proceed. Missing + interactive → walk the user to the
 * exact page that mints the value (the Enter-gated browser open — Ian
 * 2026-07-14: every secret ask is a guide, not a demand), then ask for it
 * (masked paste), persist it to the brand .env (writeEnvValue), export it
 * for THIS run, proceed — a fresh brand configures itself mid-run.
 * Missing + non-interactive → skip with a machine-readable `missingEnv`
 * list, which the run summary aggregates into the 🔑 section so a
 * `--parallel` or CI run says exactly which keys to add where.
 */
const chalk = require('chalk').default;
const { canPrompt } = require('./run-gates.js');
const { writeEnvValue } = require('./env-secret.js');

/**
 * Ensure the named secrets exist in the environment, asking when possible.
 *
 * @param {object} context - Service context ({ brandRoot, options }).
 * @param {Array<{ name: string, label?: string, url?: string, hint?: string }>} secrets -
 *   Required env vars — label for the ask, url = where to mint one,
 *   hint = what exactly to create there (scopes, token type).
 * @param {object} [deps] - Test seam: { prompt } replaces devkit/prompt.
 * @returns {Promise<object|null>} null to proceed, or the setup skip shape
 *   ({ skip, reason, missingEnv }).
 */
async function ensureEnvSecrets(context, secrets, deps = {}) {
  const missing = secrets.filter((secret) => !process.env[secret.name]);
  if (missing.length === 0) {
    return null;
  }

  const names = missing.map((secret) => secret.name);

  if (!canPrompt(context.options)) {
    return {
      skip: true,
      reason: `missing ${names.join(', ')} — add to the brand .env, or rerun interactively to paste`,
      missingEnv: names,
    };
  }

  const prompt = deps.prompt || require('@omega.js/devkit/prompt');

  for (const secret of missing) {
    const label = secret.label || secret.name;
    console.log(`    ${chalk.yellow('🔑')} ${label} is not in the brand .env yet`);
    if (secret.hint) {
      console.log(`      ${chalk.dim(secret.hint)}`);
    }

    // The exact-page guide: Enter opens the page that mints the value
    // (pressEnterToOpen always prints the URL, so it stays clickable when
    // the user would rather not open a browser).
    if (secret.url && prompt.pressEnterToOpen) {
      await prompt.pressEnterToOpen(secret.url, `the ${label} page`);
    }

    const value = (await prompt.password({ message: `Paste ${secret.name}:` }) || '').trim();
    if (!value) {
      return {
        skip: true,
        reason: `missing ${secret.name} (nothing entered)`,
        missingEnv: names,
      };
    }

    writeEnvValue(context.brandRoot, secret.name, value);
    process.env[secret.name] = value;
    console.log(`    ${chalk.green('✓')} ${secret.name} saved to the brand .env`);
  }

  return null;
}

module.exports = { ensureEnvSecrets };
