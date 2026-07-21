/**
 * `mgr update` — dependency freshness report (npu-outdated semantics):
 * installed/wanted/latest + patch/minor/major per dep, releases younger than
 * --min-age days (default 7) QUARANTINED. `--apply` installs the
 * non-quarantined, non-breaking set (`--major` opts into breaking) through
 * npu when present. The whole verb is the shared devkit implementation;
 * it runs against the APP ROOT's package.json.
 */
const BaseCommand = require('./base-command');
const { runUpdate } = require('@omega.js/devkit/update');

class UpdateCommand extends BaseCommand {
  async execute() {
    const argv = this.argv || {};

    await runUpdate({
      dir: this.firebaseProjectPath,
      apply: argv.apply,
      major: argv.major,
      minAge: argv.minAge ?? argv['min-age'],
      forceFresh: argv.forceFresh || argv['force-fresh'],
      logger: console,
    });
  }
}

module.exports = UpdateCommand;
