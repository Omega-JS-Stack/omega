/**
 * Interactive-prompt test harness — routes @omega.js/devkit/prompt through
 * fake TTY streams so tests drive the REAL inquirer prompts with keystrokes
 * (no mocks; the devkit module treats an isTTY input stream as interactive).
 *
 * Usage:
 *   const tty = openTtyPrompt();
 *   try {
 *     const run = handler(context);                    // hits a prompt
 *     await tty.answer('Radar rules added', 'y\r');    // wait for render, type
 *     const result = await run;
 *   } finally {
 *     tty.close();                                     // restore process stdio
 *   }
 */
const { PassThrough } = require('node:stream');
const { setPromptStreams } = require('@omega.js/devkit/prompt');

function openTtyPrompt() {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  output.isTTY = true;
  // Inquirer pipes an internal stream into `output` and ends it when each
  // prompt completes; real TTY streams ignore end(), so the fake must too —
  // otherwise the second prompt on this pair renders nothing.
  output.end = () => {};

  let rendered = '';
  output.on('data', (chunk) => { rendered += chunk.toString(); });

  setPromptStreams({ input, output });

  return {
    /**
     * Wait until `match` has rendered, then type `keys` (include '\r' to
     * submit). Rendered output accumulates, so sequential prompts are
     * answered by matching each prompt's unique text in order.
     */
    async answer(match, keys, timeoutMs = 2000) {
      const start = Date.now();
      while (!rendered.includes(match)) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(`Timed out waiting for a prompt containing ${JSON.stringify(match)}. Rendered: ${JSON.stringify(rendered)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      input.write(keys);
    },

    /** Restore prompts to process stdio. */
    close() {
      setPromptStreams(null);
    },
  };
}

module.exports = { openTtyPrompt };
