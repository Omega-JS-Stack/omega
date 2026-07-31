/**
 * Ensure the brand's Slapform contact form has the correct settings —
 * name matches the brand, form enabled.
 *
 * Diff-synced: the form document is read first and only patched on drift
 * (omega-manager merge-wrote it on every run, with no dry-run guard). A
 * formId that points at no document is an error — the form must be created
 * in the Slapform dashboard first (omega-manager silently created a
 * name-only orphan document in that case).
 */
const chalk = require('chalk').default;

module.exports = async function ensureForm(context) {
  const { brandConfig, db, formId, options } = context;
  const dryRun = options?.dryRun || false;

  const desiredName = `Contact Form - ${brandConfig.brand.name}`;

  const form = await db.getDoc(`forms/${formId}`);

  if (!form) {
    console.log(`      ${chalk.red('✗')} Form ${chalk.cyan(formId)} not found in Slapform — check forms.providers.slapform.formId (forms are created at ${chalk.cyan('https://slapform.com')})`);
    return { status: 'error', error: `form ${formId} not found` };
  }

  const drifted = form.name !== desiredName || form.settings?.enabled !== true;

  if (!drifted) {
    console.log(`      ${chalk.green('✓')} Form ${chalk.dim(formId)} in sync ${chalk.dim(`(${desiredName})`)}`);
    return { state: { formId }, output: { form: { synced: true } } };
  }

  if (dryRun) {
    console.log(`      ${chalk.yellow('[DRY RUN]')} Would update form ${chalk.cyan(formId)} ${chalk.dim(`(name → ${desiredName}, enabled → true)`)}`);
    return { output: { form: { planned: 'update' } } };
  }

  await db.patchDoc(`forms/${formId}`, {
    name: desiredName,
    settings: { enabled: true },
  }, ['name', 'settings.enabled']);

  console.log(`      ${chalk.green('✓')} Form ${chalk.dim(formId)} updated ${chalk.dim(`(${desiredName})`)}`);

  return { state: { formId }, output: { form: { updated: true } } };
};
