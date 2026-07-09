// Tests for src/prompt.js — the TTY-safe wrapper around @inquirer/prompts.
//
// Interactive tests drive the REAL inquirer prompts through fake streams
// (setPromptStreams + isTTY-flagged PassThroughs): keystrokes go in, rendered
// output comes out, no mocks. waitForOutput() guarantees a prompt has rendered
// (and is listening) before keystrokes are written.

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const prompt = require('../src/prompt');

const DOWN_ARROW = '\x1B[B';

/**
 * A fake stream pair. `tty: true` marks the input as a TTY so the wrapper
 * treats the session as interactive; output collects everything rendered.
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
 * Poll until the collected output contains `text` (prompt has rendered).
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

afterEach(() => {
  prompt.setPromptStreams(null);
});

// === Non-interactive (no TTY) ===

test('isInteractive is false for non-TTY streams', () => {
  const streams = makeStreams({ tty: false });
  prompt.setPromptStreams(streams);
  assert.equal(prompt.isInteractive(), false);
});

test('input throws without a TTY', async () => {
  prompt.setPromptStreams(makeStreams({ tty: false }));
  await assert.rejects(
    async () => prompt.input({ message: 'Name:' }),
    /Interactive prompt blocked: no TTY available/,
  );
});

test('select throws without a TTY', async () => {
  prompt.setPromptStreams(makeStreams({ tty: false }));
  await assert.rejects(
    async () => prompt.select({ message: 'Pick:', choices: [{ value: 'a' }] }),
    /Interactive prompt blocked/,
  );
});

test('checkbox throws without a TTY', async () => {
  prompt.setPromptStreams(makeStreams({ tty: false }));
  await assert.rejects(
    async () => prompt.checkbox({ message: 'Pick:', choices: [{ value: 'a' }] }),
    /Interactive prompt blocked/,
  );
});

test('confirm auto-returns its default without a TTY', async () => {
  prompt.setPromptStreams(makeStreams({ tty: false }));
  assert.equal(await prompt.confirm({ message: 'Done?', default: false }), false);
  assert.equal(await prompt.confirm({ message: 'Done?', default: true }), true);
  assert.equal(await prompt.confirm({ message: 'Done?' }), true);
});

test('required confirm throws without a TTY instead of auto-accepting', async () => {
  prompt.setPromptStreams(makeStreams({ tty: false }));
  await assert.rejects(
    async () => prompt.confirm({ message: 'Delete everything?', required: true }),
    /Interactive prompt blocked/,
  );
});

test('setPromptStreams(null) restores process stdio (non-TTY under the test runner)', () => {
  prompt.setPromptStreams(makeStreams({ tty: true }));
  assert.equal(prompt.isInteractive(), true);
  prompt.setPromptStreams(null);
  assert.equal(prompt.isInteractive(), false);
});

// === Interactive (TTY streams, real inquirer) ===

test('isInteractive is true for TTY streams', () => {
  prompt.setPromptStreams(makeStreams({ tty: true }));
  assert.equal(prompt.isInteractive(), true);
});

test('input resolves typed text', async () => {
  const streams = makeStreams({ tty: true });
  prompt.setPromptStreams(streams);

  const answer = prompt.input({ message: 'Brand id:' });
  await waitForOutput(streams, 'Brand id:');
  streams.input.write('acme\r');

  assert.equal(await answer, 'acme');
});

test('input re-prompts on failed validation until the value passes', async () => {
  const streams = makeStreams({ tty: true });
  prompt.setPromptStreams(streams);

  const answer = prompt.input({
    message: 'Key:',
    validate: (value) => (value.trim().length === 4 ? true : 'must be 4 chars'),
  });
  await waitForOutput(streams, 'Key:');
  streams.input.write('nope!\r');
  await waitForOutput(streams, 'must be 4 chars');
  streams.input.write('\x15'); // ctrl-U — clear the rejected line
  streams.input.write('good\r');

  assert.equal(await answer, 'good');
});

test('select resolves the arrowed-to choice', async () => {
  const streams = makeStreams({ tty: true });
  prompt.setPromptStreams(streams);

  const answer = prompt.select({
    message: 'Zone:',
    choices: [{ value: 'first' }, { value: 'second' }],
  });
  await waitForOutput(streams, 'Zone:');
  streams.input.write(DOWN_ARROW);
  streams.input.write('\r');

  assert.equal(await answer, 'second');
});

test('checkbox resolves toggled choices', async () => {
  const streams = makeStreams({ tty: true });
  prompt.setPromptStreams(streams);

  const answer = prompt.checkbox({
    message: 'Targets:',
    choices: [{ value: 'web' }, { value: 'backend' }],
  });
  await waitForOutput(streams, 'Targets:');
  streams.input.write(' '); // toggle "web"
  streams.input.write(DOWN_ARROW);
  streams.input.write(' '); // toggle "backend"
  streams.input.write('\r');

  assert.deepEqual(await answer, ['web', 'backend']);
});

test('confirm resolves y / n keystrokes', async () => {
  const yes = makeStreams({ tty: true });
  prompt.setPromptStreams(yes);
  const yesAnswer = prompt.confirm({ message: 'Ship it?', default: false });
  await waitForOutput(yes, 'Ship it?');
  yes.input.write('y\r');
  assert.equal(await yesAnswer, true);

  const no = makeStreams({ tty: true });
  prompt.setPromptStreams(no);
  const noAnswer = prompt.confirm({ message: 'Ship it?', default: true });
  await waitForOutput(no, 'Ship it?');
  no.input.write('n\r');
  assert.equal(await noAnswer, false);
});

test('confirm bare enter takes the default', async () => {
  const streams = makeStreams({ tty: true });
  prompt.setPromptStreams(streams);

  const answer = prompt.confirm({ message: 'Proceed?', default: false });
  await waitForOutput(streams, 'Proceed?');
  streams.input.write('\r');

  assert.equal(await answer, false);
});

test('sequential prompts on one stream pair all render and resolve', async () => {
  const streams = makeStreams({ tty: true });
  prompt.setPromptStreams(streams);

  const first = prompt.input({ message: 'First:' });
  await waitForOutput(streams, 'First:');
  streams.input.write('one\r');
  assert.equal(await first, 'one');

  const second = prompt.input({ message: 'Second:' });
  await waitForOutput(streams, 'Second:');
  streams.input.write('two\r');
  assert.equal(await second, 'two');

  const third = prompt.confirm({ message: 'Third?', default: false });
  await waitForOutput(streams, 'Third?');
  streams.input.write('y\r');
  assert.equal(await third, true);
});
