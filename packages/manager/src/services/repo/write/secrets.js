/**
 * Every target's composed `.env` set, published as the SOURCE repo's Actions
 * secrets ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)).
 *
 * The push is a deploy PRECHECK first: a deploy is when a runner needs them,
 * and that is where it must never be forgotten. But it "could happen elsewhere
 * like manage too" (Ian, 2026-09-12), so the walk that owns the brand's repos
 * owns this too, and a brand can be brought current without deploying anything.
 *
 * The function is devkit's, the same one every deploy precheck calls
 * (`@omega.js/devkit/target-secrets`): the key set is @omega.js/config's ONE
 * delivery primitive, read off the env schema's declarations AND the composed
 * values (so a `match` family member and a key of the consumer's own travel
 * too, #876/#835), the values come from that same composed cascade (company
 * then brand then target, FILES only), and the target's own seams reshape what
 * needs reshaping. Nothing about the transport lives here; what lives here is the
 * manage-lane framing, which targets get a pass and how a refusal reads.
 *
 * A REFUSAL (a key this brand's config requires that the cascade cannot value)
 * is this operation's `status: 'error'`, so the run summary names it. Half a
 * signing set on a runner is a green build nobody can install, so the publisher
 * sends nothing on that path and the walk says which key and what fixes it.
 */
const chalk = require('chalk').default;
const { publishTargetSecrets } = require('@omega.js/devkit/target-secrets');

module.exports = async function ensureSecrets(context) {
  const { targets = [], options = {} } = context;

  // The same mapping every target-shaped operation uses: a dir the brand maps
  // to a framework. A CUSTOM target has no schema delivery set, so it has no
  // secrets to compose.
  const mapped = targets.filter((entry) => entry.target);

  if (mapped.length === 0) {
    console.log(`      ${chalk.dim('⊘ no target-mapped dirs')}`);
    return { status: 'success', output: { secrets: { skipped: 'no target-mapped dirs' } } };
  }

  const logger = {
    log: (line) => console.log(`        ${line}`),
    warn: (line) => console.log(`        ${chalk.yellow(line)}`),
    error: (line) => console.log(`        ${chalk.red(line)}`),
  };

  const results = {};
  const failures = [];

  for (const entry of mapped) {
    console.log(`      ${chalk.cyan(entry.dir)}:`);

    try {
      results[entry.name] = publishTargetSecrets({
        targetDir: entry.path,
        target: entry.target,
        logger,
        dryRun: options.dryRun,
        ...(context.execFn ? { execFn: context.execFn } : {}),
      });
    } catch (error) {
      console.log(`      ${chalk.red('✗')} ${entry.dir}${chalk.dim(`: ${error.message}`)}`);
      failures.push(`${entry.dir}: ${error.message}`);
    }
  }

  return {
    status: failures.length > 0 ? 'error' : 'success',
    ...(failures.length > 0 ? { error: failures.join(' ') } : {}),
    output: { secrets: results },
  };
};
