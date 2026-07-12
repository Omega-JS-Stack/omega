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

/**
 * The effective { input, output } streams prompts run on (the test seam
 * when set, process stdio otherwise). Flow helpers (flows.js) read
 * keypresses and draw spinners on these so the same fake-stream harness
 * drives them.
 */
function getPromptStreams() {
  return {
    input: effectiveInput(),
    output: _streams?.output || process.stdout,
  };
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

/**
 * Launch the OS browser for a URL. Dependency-free `open`: darwin `open`,
 * win32 `start`, else `xdg-open`. Fire-and-forget; failures are the
 * caller's printed-URL fallback. Exposed for tests (openCommand).
 */
function openCommand() {
  if (process.platform === 'darwin') {
    return 'open';
  }
  if (process.platform === 'win32') {
    return 'start';
  }
  return 'xdg-open';
}

function openInBrowser(url) {
  const { spawn } = require('node:child_process');
  try {
    const child = spawn(openCommand(), [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
    child.unref();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * The onboarding walkthrough pattern (omega-manager convention): "Press
 * Enter to open <label> in your browser". Interactive: waits for Enter,
 * opens the URL, returns true. Non-interactive: prints the URL and returns
 * false so callers know the human never saw a browser. The URL is always
 * printed either way — terminals with link support stay clickable.
 */
async function pressEnterToOpen(url, label = 'this page') {
  const output = _streams?.output || process.stdout;
  output.write(`      → ${url}\n`);

  if (!isInteractive()) {
    return false;
  }

  await _input({ message: `Press Enter to open ${label} in your browser...` }, _streams || undefined);
  // Via module.exports so tests can stub the actual browser launch
  module.exports.openInBrowser(url);
  return true;
}

module.exports = {
  isInteractive,
  getPromptStreams,
  input,
  select,
  checkbox,
  confirm,
  setPromptStreams,
  pressEnterToOpen,
  openInBrowser,
  openCommand,
};
