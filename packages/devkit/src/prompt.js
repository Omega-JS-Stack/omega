/**
 * TTY-safe interactive prompts — the one wrapper every OMEGA package uses
 * instead of importing @inquirer/prompts directly.
 *
 * Semantics:
 * - No TTY (CI, cron, `node --test`, company-mode child processes — always
 *   piped): input/select/checkbox THROW immediately instead of hanging
 *   forever; confirm auto-returns its default (`default ?? true`) unless
 *   the call passes { required: true } — destructive or critical
 *   confirmations must never be auto-accepted.
 * - omega-manager's setParallelMode() global is gone by construction:
 *   parallel execution is company mode, which runs each brand as a child
 *   process with piped stdio, so the TTY check already covers it.
 * - Callers that have a non-prompting fallback (print instructions + warn)
 *   gate on isInteractive() instead of catching the throw.
 *
 * Test seam: setPromptStreams({ input, output }) routes the REAL inquirer
 * prompts through the given streams (@inquirer's context argument) — tests
 * drive actual keystrokes, no mocks. An input stream with isTTY = true
 * counts as interactive.
 */
const { input: _input, select: _select, checkbox: _checkbox, confirm: _confirm } = require('@inquirer/prompts');

let _streams = null;

/**
 * Route prompts through the given { input, output } streams (test seam).
 * Pass null to restore process stdio.
 */
function setPromptStreams(streams) {
  _streams = streams || null;
}

function effectiveInput() {
  return _streams?.input || process.stdin;
}

/**
 * Whether prompts can run: the effective input stream is a TTY.
 */
function isInteractive() {
  return Boolean(effectiveInput().isTTY);
}

function assertInteractive() {
  if (!isInteractive()) {
    throw new Error(
      'Interactive prompt blocked: no TTY available. '
      + 'Run in an interactive terminal to fill in missing config.',
    );
  }
}

/**
 * Text input. Throws without a TTY.
 */
function input(opts) {
  assertInteractive();
  return _input(opts, _streams || undefined);
}

/**
 * Single-choice list. Throws without a TTY.
 */
function select(opts) {
  assertInteractive();
  return _select(opts, _streams || undefined);
}

/**
 * Multi-choice list. Throws without a TTY.
 */
function checkbox(opts) {
  assertInteractive();
  return _checkbox(opts, _streams || undefined);
}

/**
 * Yes/no confirmation. Without a TTY, non-required confirms auto-return
 * their default value; pass { required: true } for confirmations that must
 * never be auto-accepted (those throw instead).
 */
function confirm(opts) {
  if (!isInteractive() && !opts?.required) {
    return Promise.resolve(opts?.default ?? true);
  }

  assertInteractive();
  return _confirm(opts, _streams || undefined);
}

module.exports = {
  isInteractive,
  input,
  select,
  checkbox,
  confirm,
  setPromptStreams,
};
