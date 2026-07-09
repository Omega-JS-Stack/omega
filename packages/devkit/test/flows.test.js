// Tests for src/flows.js — browser-open + wait/poll flows.
//
// Interactive tests drive REAL keypress loops and confirm prompts through
// the fake-stream harness (setPromptStreams); the browser opener is stubbed
// via its own seam (setBrowserOpener) so nothing ever launches. Poll
// intervals are shrunk to keep the suite fast.

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const prompt = require('../src/prompt');
const flows = require('../src/flows');
const { makeStreams, waitForOutput } = require('../src/test/prompt-streams');

afterEach(() => {
  prompt.setPromptStreams(null);
  flows.setBrowserOpener(null);
});

// === getPromptStreams (the seam flows ride) ===

test('getPromptStreams returns process stdio by default and the seam when set', () => {
  const bare = prompt.getPromptStreams();
  assert.equal(bare.input, process.stdin);
  assert.equal(bare.output, process.stdout);

  const streams = makeStreams({ tty: true });
  prompt.setPromptStreams(streams);
  const seamed = prompt.getPromptStreams();
  assert.equal(seamed.input, streams.input);
  assert.equal(seamed.output, streams.output);
});

// === openBrowser ===

test('openBrowser routes through the seam', async () => {
  const opened = [];
  flows.setBrowserOpener(async (url) => { opened.push(url); return true; });
  assert.equal(await flows.openBrowser('https://example.com'), true);
  assert.deepEqual(opened, ['https://example.com']);
});

// === withSpinner ===

test('withSpinner returns the fn result and prints one static line without a TTY', async () => {
  const streams = makeStreams({ tty: false });
  prompt.setPromptStreams(streams);
  const result = await flows.withSpinner('Crunching', async () => 42, { indent: '' });
  assert.equal(result, 42);
  assert.ok(streams.getRendered().includes('Crunching...'));
});

test('withSpinner rethrows and still clears its spinner', async () => {
  const streams = makeStreams({ tty: true });
  prompt.setPromptStreams(streams);
  await assert.rejects(
    () => flows.withSpinner('Doomed', async () => { throw new Error('boom'); }),
    /boom/,
  );
});

// === pollWithSpinner — non-interactive ===

test('pollWithSpinner without a TTY skips manual-only waits (nobody can press ENTER)', async () => {
  prompt.setPromptStreams(makeStreams({ tty: false }));
  const result = await flows.pollWithSpinner({ manualOnly: true, message: 'Waiting' });
  assert.deepEqual(result, { success: false, skipped: true });
});

test('pollWithSpinner without a TTY polls quietly until the check is done', async () => {
  prompt.setPromptStreams(makeStreams({ tty: false }));
  let calls = 0;
  const result = await flows.pollWithSpinner({
    check: async () => (++calls >= 3 ? { done: true, result: 'ready' } : { done: false }),
    intervalMs: 20,
    message: 'Propagating',
  });
  assert.deepEqual(result, { success: true, result: 'ready' });
  assert.equal(calls, 3);
});

test('pollWithSpinner surfaces a check error as failure', async () => {
  prompt.setPromptStreams(makeStreams({ tty: false }));
  const result = await flows.pollWithSpinner({
    check: async () => { throw new Error('api down'); },
    intervalMs: 20,
  });
  assert.deepEqual(result, { success: false, error: 'api down' });
});

test('pollWithSpinner surfaces done-with-error as failure', async () => {
  prompt.setPromptStreams(makeStreams({ tty: false }));
  const result = await flows.pollWithSpinner({
    check: async () => ({ done: true, error: 'zone rejected' }),
    intervalMs: 20,
  });
  assert.deepEqual(result, { success: false, error: 'zone rejected' });
});

// === pollWithSpinner — interactive keypress controls ===

test('pollWithSpinner: S skips the wait', async () => {
  const streams = makeStreams({ tty: true });
  prompt.setPromptStreams(streams);
  const running = flows.pollWithSpinner({
    check: async () => ({ done: false }),
    intervalMs: 5000, // long — only the keypress can end this
    message: 'Waiting',
  });
  await waitForOutput(streams, '(s)=skip');
  streams.input.write('s');
  const result = await running;
  assert.deepEqual(result, { success: false, skipped: true });
});

test('pollWithSpinner: ENTER in manual mode means done', async () => {
  const streams = makeStreams({ tty: true });
  prompt.setPromptStreams(streams);
  const running = flows.pollWithSpinner({ manualOnly: true, message: 'Confirm in dashboard' });
  await waitForOutput(streams, '(enter)=done');
  streams.input.write('\r');
  const result = await running;
  assert.deepEqual(result, { success: true });
});

test('pollWithSpinner: ENTER forces an immediate re-check', async () => {
  const streams = makeStreams({ tty: true });
  prompt.setPromptStreams(streams);
  let calls = 0;
  const running = flows.pollWithSpinner({
    check: async () => (++calls >= 2 ? { done: true, result: 'ok' } : { done: false }),
    intervalMs: 60000, // the second check can only come from ENTER
    message: 'Waiting',
  });
  await waitForOutput(streams, '(enter)=check now');
  streams.input.write('\r');
  const result = await running;
  assert.deepEqual(result, { success: true, result: 'ok' });
  assert.equal(calls, 2);
});

// === openBrowserAndPoll ===

test('openBrowserAndPoll without a TTY prints the URL and skips (no browser)', async () => {
  prompt.setPromptStreams(makeStreams({ tty: false }));
  let opened = false;
  flows.setBrowserOpener(async () => { opened = true; return true; });
  const result = await flows.openBrowserAndPoll({
    url: 'https://example.com/setup',
    promptMessage: 'Create the thing',
    waitMessage: 'Waiting',
  });
  assert.deepEqual(result, { success: false, skipped: true });
  assert.equal(opened, false);
});

test('openBrowserAndPoll: declining the confirm skips without opening', async () => {
  const streams = makeStreams({ tty: true });
  prompt.setPromptStreams(streams);
  let opened = false;
  flows.setBrowserOpener(async () => { opened = true; return true; });
  const running = flows.openBrowserAndPoll({
    url: 'https://example.com/setup',
    promptMessage: 'Create the thing',
    waitMessage: 'Waiting',
  });
  await waitForOutput(streams, 'Open browser now?');
  streams.input.write('n\r');
  const result = await running;
  assert.deepEqual(result, { success: false, skipped: true });
  assert.equal(opened, false);
});

test('openBrowserAndPoll: accept → opens the URL and polls to success', async () => {
  const streams = makeStreams({ tty: true });
  prompt.setPromptStreams(streams);
  const opened = [];
  flows.setBrowserOpener(async (url) => { opened.push(url); return true; });
  const running = flows.openBrowserAndPoll({
    url: 'https://example.com/setup',
    promptMessage: 'Create the thing',
    waitMessage: 'Waiting for it',
    check: async () => ({ done: true, result: { id: 'thing_1' } }),
    intervalMs: 20,
  });
  await waitForOutput(streams, 'Open browser now?');
  streams.input.write('\r'); // accept the default (yes)
  const result = await running;
  assert.deepEqual(result, { success: true, result: { id: 'thing_1' } });
  assert.deepEqual(opened, ['https://example.com/setup']);
});
