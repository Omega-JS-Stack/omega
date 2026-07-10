/**
 * Fake-TTY stream harness for testing interactive prompts and flows.
 * Pairs with prompt.js's setPromptStreams seam: tests drive the REAL
 * inquirer prompts / flow keypress loops through PassThrough streams —
 * keystrokes go in, rendered output comes out, no mocks anywhere.
 *
 * Used by devkit's own prompt/flows tests and by consumers testing code
 * built on @omega.js/devkit/prompt (e.g. the manager's onboarding flows).
 */
const { PassThrough } = require('node:stream');

// Arrow-key escape codes for driving select/checkbox prompts
const DOWN_ARROW = '\x1B[B';
const UP_ARROW = '\x1B[A';

/**
 * A fake stream pair. `tty: true` marks the input as a TTY so the prompt
 * wrapper treats the session as interactive; output collects everything
 * rendered (read it back via getRendered()).
 */
function makeStreams({ tty }) {
  const input = new PassThrough();
  const output = new PassThrough();
  if (tty) {
    input.isTTY = true;
    output.isTTY = true;
  }
  // Inquirer pipes an internal stream into `output` and ends it when each
  // prompt completes; real TTY streams ignore end(), so the fake must too —
  // otherwise the second prompt on the same pair renders nothing.
  output.end = () => {};
  let rendered = '';
  output.on('data', (chunk) => { rendered += chunk.toString(); });
  return { input, output, getRendered: () => rendered };
}

/**
 * Poll until the collected output contains `text` (the prompt has rendered
 * and is listening) — write keystrokes only after this resolves.
 */
async function waitForOutput(streams, text, timeoutMs = 2000) {
  const start = Date.now();
  while (!streams.getRendered().includes(text)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for output containing ${JSON.stringify(text)}. Got: ${JSON.stringify(streams.getRendered())}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

module.exports = { makeStreams, waitForOutput, DOWN_ARROW, UP_ARROW };
