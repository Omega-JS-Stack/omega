const chalk = require('chalk').default;
const BaseCommand = require('./base-command');
const { collectBareRequires } = require('@omega.js/devkit/bare-requires');

/**
 * `omega migrate` on a backend target: the ported-project report
 * ([#600](https://github.com/Omega-JS-Stack/omega/issues/600)).
 *
 * Today it carries ONE finding class, the dependency-resolution scan. Under the
 * legacy FLAT BEM install every framework dependency sat in the consumer's own
 * `node_modules`, so a ported route could `require('fs-jetpack')` and be right.
 * Under OMEGA the framework is a package with its own tree and that require
 * resolves only by HOISTING, which holds on one install and not on the next.
 * The requires that carried it were LAZY, inside the handler, so the module
 * loads fine and the route 500s the first time a request reaches it.
 *
 * REPORT ONLY. Which package version a brand wants is the brand's call, so the
 * verb names the file, the line and the fix and stops. The scan is devkit's
 * (`src/bare-requires.js`), the SAME one @omega.js/web's `omega migrate` runs,
 * so the two frameworks cannot answer the question differently. A backend has
 * no bundler and therefore no aliases to exclude: every bare specifier is a
 * real dependency or a built-in.
 *
 * The one-time CONVERSIONS stay their own run-alone verbs (`migrate:rules`,
 * `migrate:markers`): those change what the project enforces, and this one
 * changes nothing.
 */
class MigrateCommand extends BaseCommand {
  /**
   * @returns {Promise<Array<{ file: string, line: number, module: string, fix: string }>>}
   *   The findings, so a caller can act on the same list the report printed.
   */
  async execute() {
    const projectDir = this.main.firebaseProjectPath;

    this.ui.header('Backend migration report', { subtitle: projectDir, subtitleColor: chalk.dim });

    const bareRequires = collectBareRequires(projectDir);

    if (bareRequires.length === 0) {
      this.ui.status('pass', 'Every package this target requires is declared in its package.json.');

      return bareRequires;
    }

    this.ui.status('warn', `${bareRequires.length} bare ${bareRequires.length === 1 ? 'require' : 'requires'} of ${chalk.bold('undeclared')} packages:`);

    for (const entry of bareRequires) {
      this.ui.status('warn', `${entry.file}:${entry.line} \`${entry.module}\`: ${entry.fix}`, { level: 2 });
    }

    this.ui.blank();
    this.ui.status('running', `Nothing was installed: declare each one, then run ${chalk.bold('npx omega test')}.`);

    return bareRequires;
  }
}

module.exports = MigrateCommand;
