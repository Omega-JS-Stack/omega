/**
 * `omega onboard [id]`: create (or converge) a brand monorepo.
 *
 * Flags pre-answer the wizard: --id/--name/--url/--description/--tagline,
 * --contactName (plus --contactImage/--contactUrl), --targets=web,backend (or
 * `none`), --org=<GitHub owner>, --company=<company brand id>,
 * --admins=a@x.com,b@x.com. Prompts fill the gaps in a TTY; without one
 * the rest derives. --dry-run prints the file plan without writing or
 * prompting; --manage/--no-manage forces the manage handoff, and --no-dev
 * stops a first run before its install and dev stack.
 */
const { runOnboard } = require('../onboard.js');

module.exports = async (options) => {
  const report = await runOnboard(process.cwd(), {
    id: options.id ?? options._?.[1],
    name: options.name,
    url: options.url,
    description: options.description,
    tagline: options.tagline,
    contactName: options.contactName,
    contactImage: options.contactImage,
    contactUrl: options.contactUrl,
    targets: options.targets,
    org: options.org,
    company: options.company,
    admins: options.admins,
    dryRun: options.dryRun,
    manage: options.manage,
    dev: options.dev,
  });

  const failed = (code) => code != null && code !== 0;
  if (!report.valid || report.installed === false || failed(report.manageExitCode) || failed(report.devExitCode)) {
    process.exitCode = 1;
  }
};
