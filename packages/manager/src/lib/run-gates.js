/**
 * Run-mode gates — the standard "may this step do X?" checks and the
 * standard step-asides when it can't.
 *
 * Three primitives every ensure-handler shares:
 * - canPrompt(options) — interactive TTY and not a dry run: the only two
 *   conditions that ever gate a prompt. Use it instead of hand-composing
 *   isInteractive() with options.dryRun (three spellings of that compound
 *   had drifted into the tree before this module existed).
 * - dryRunPlan(message, result) — the canonical dry-run line
 *   (`⊘ Dry run — would <message>`) with an optional pass-through return,
 *   so the modal gate is one statement:
 *   `if (options.dryRun) return dryRunPlan('create it', { output: … });`
 *   Loop bodies call it bare and continue.
 * - needsInteractiveSkip(key, action, note) — the warned step-aside return
 *   carrying the #32 `needsInteractive` marker that the run summary
 *   aggregates into its ⚑ section with a per-service rerun hint.
 */
const chalk = require('chalk').default;
const { isInteractive } = require('@omega.js/devkit/prompt');

/**
 * Whether a step may prompt: the input stream is a TTY and this is not a
 * dry run.
 *
 * @param {object} [options] - The run options (may carry `dryRun`).
 * @returns {boolean} True when prompts are allowed.
 */
function canPrompt(options) {
  return isInteractive() && !options?.dryRun;
}

/**
 * Print the canonical dry-run line and pass `result` back so the modal
 * gate reads `return dryRunPlan('create 3 records', { output: … })`.
 *
 * @param {string} message - What the real run would do ("create list …").
 * @param {*} [result] - Returned verbatim (a handler return, usually).
 * @returns {*} The `result` argument.
 */
function dryRunPlan(message, result) {
  console.log(`      ${chalk.dim(`⊘ Dry run — would ${message}`)}`);
  return result;
}

/**
 * The standard warned return for a step that needs a TTY (#32): `action`
 * states what an interactive run would do — the run summary collects it
 * into the ⚑ "needs an interactive run" section, and the `reason` names the
 * step-aside in the summary's warned breakdown (#643).
 *
 * @param {string} key - The operation's output key (e.g. 'cloudMessaging').
 * @param {string} action - What an interactive run would do.
 * @param {string} [note] - Optional per-operation output note.
 * @returns {object} A `{ status: 'warned', reason, output }` handler return.
 */
function needsInteractiveSkip(key, action, note) {
  return {
    status: 'warned',
    reason: 'needs an interactive run',
    output: {
      [key]: {
        ...(note ? { note } : {}),
        needsInteractive: action,
      },
    },
  };
}

module.exports = { canPrompt, dryRunPlan, needsInteractiveSkip };
