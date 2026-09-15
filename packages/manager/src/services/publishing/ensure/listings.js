/**
 * The per-listing store ids ([#893](https://github.com/Omega-JS-Stack/omega/issues/893)).
 *
 * A store assigns the id when a HUMAN creates the listing, so no API here can
 * mint one and no publish can guess it: the walk opens the store's console
 * Enter-gated and takes the paste, landing it in config/omega.json5 where it
 * belongs (it is the id in the listing URL every user sees, so it is public by
 * design and never a `.env` key).
 *
 * "Not yet" is a first-class answer (Ian 2026-09-10): the gate's Skip leaves
 * the config untouched and the next run asks again, and the run that cannot
 * ask at all gets the same manual step the publish prints when it has to leave
 * a store behind. Nothing is left to a hint line in a CI log.
 *
 * Firefox is absent by construction: its id IS the manifest gecko id, so the
 * format table gives that store no listing to collect and the first publish
 * writes the id back itself.
 */
const chalk = require('chalk').default;
const { listingManualStep } = require('@omega.js/devkit/ship-plan');

const { resolveConfigValue } = require('../../../lib/config-flow.js');

module.exports = async (context) => {
  const collected = [];
  const pending = [];

  for (const target of context.shipping) {
    for (const format of target.formats) {
      for (const listingPath of format.listing) {
        const path = `targets.${target.name}.${listingPath}`;

        const id = await resolveConfigValue(context, {
          path,
          label: `${format.label} listing id`,
          // Disable means this brand does not ship to that store at all, so it
          // lands on the DECLARATION: one `false` stops the ask, the key ask
          // and the publish alike.
          disablePath: `targets.${target.name}.${format.path}`,
          instructions: [
            `Create the listing in the ${format.label} dashboard (a first upload can be this zip, from the releases repo),`,
            'then paste the id it gives you. Answer "Skip for now" if the listing does not exist yet.',
          ],
          entry: {
            url: format.console,
            message: `${format.label} listing id:`,
          },
        });

        if (id) {
          collected.push(path);
          continue;
        }

        console.log(`      ${chalk.yellow('⚠')} ${listingManualStep({ label: format.label, console: format.console, path })}`);
        pending.push(path);
      }
    }
  }

  if (pending.length > 0) {
    return {
      status: 'warned',
      reason: `no listing id yet for ${pending.join(', ')}`,
      output: { listings: { collected, pending } },
    };
  }

  if (collected.length > 0) {
    console.log(`      ${chalk.green('✓')} Listing ids: ${chalk.cyan(collected.join(', '))}`);
  }

  return { output: { listings: { collected, pending } } };
};
