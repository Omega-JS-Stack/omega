/**
 * `omega-manager onboard [id]` — create (or converge) a brand monorepo.
 *
 * Flags: --id/--name/--url/--description/--tagline/--targets=web,backend
 * pre-answer the wizard (prompts only fill the gaps in a TTY; non-interactive
 * runs derive the rest from the id). --dry-run prints the file plan without
 * writing or prompting; --manage/--no-manage forces the manage handoff
 * instead of asking.
 */
const { runOnboard } = require('../onboard.js');

module.exports = async (options) => {
  const report = await runOnboard(process.cwd(), {
    id: options.id ?? options._?.[1],
    name: options.name,
    url: options.url,
    description: options.description,
    tagline: options.tagline,
    targets: options.targets,
    dryRun: options.dryRun,
    manage: options.manage,
  });

  if (!report.valid || (report.manageExitCode != null && report.manageExitCode !== 0)) {
    process.exitCode = 1;
  }
};
