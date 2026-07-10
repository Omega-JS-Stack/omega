/**
 * `omega translate` — NOT PORTED YET. The translation subsystem (AI
 * translation + the cache-uj-translation branch flow) rides a later B-phase
 * checkpoint; the command exists so the CLI surface is complete and the
 * failure is explicit rather than a missing command.
 */
const Logger = require('@omega.js/devkit/logger');

const logger = new Logger('omega:translate');

module.exports = async function (options) {
  logger.error('`omega translate` is not ported yet — the translation subsystem arrives with a later B-phase checkpoint (see PROGRESS.md Task 2.7 follow-ups).');
  process.exitCode = 1;
};
