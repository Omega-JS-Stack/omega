/**
 * `omega audit` — NOT PORTED YET. The audit subsystem (Lighthouse + page
 * checks over a production build) rides a later B-phase checkpoint; the
 * command exists so the CLI surface is complete and the failure is explicit
 * rather than a missing command.
 */
const Logger = require('@omega.js/devkit/logger');

const logger = new Logger('omega:audit');

module.exports = async function (options) {
  logger.error('`omega audit` is not ported yet — the audit subsystem arrives with a later B-phase checkpoint (see PROGRESS.md Task 2.7 follow-ups).');
  process.exitCode = 1;
};
