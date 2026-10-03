// Tests for src/flows.js — browser-open + wait/poll flows.
//
// Interactive tests drive REAL keypress loops and confirm prompts through
// the fake-stream harness (setPromptStreams); the browser opener is stubbed
// via its own seam (setBrowserOpener) so nothing ever launches. Poll
// intervals are shrunk to keep the suite fast.

const defineCases = require('@omega.js/devkit/test/define-cases');
const prompt = require('../src/prompt');
const flows = require('../src/flows');
const { makeStreams, waitForOutput } = require('../src/test/prompt-streams');

const afterEachHook = () => {
  prompt.setPromptStreams(null);
  flows.setBrowserOpener(null);
};

module.exports = defineCases({
  type: 'group',
  description: 'flows',
  tests: [
    // === getPromptStreams (the seam flows ride) ===

    {
      name: 'getPromptStreams returns process stdio by default and the seam when set',
      run: (ctx) => {
        ctx.after(afterEachHook);
        const bare = prompt.getPromptStreams();
        ctx.expect(bare.input).toBe(process.stdin);
        ctx.expect(bare.output).toBe(process.stdout);

        const streams = makeStreams({ tty: true });
        prompt.setPromptStreams(streams);
        const seamed = prompt.getPromptStreams();
        ctx.expect(seamed.input).toBe(streams.input);
        ctx.expect(seamed.output).toBe(streams.output);
      },
    },

    // === openBrowser ===

    {
      name: 'openBrowser routes through the seam',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const opened = [];
        flows.setBrowserOpener(async (url) => { opened.push(url); return true; });
        ctx.expect(await flows.openBrowser('https://example.com')).toBe(true);
        ctx.expect(opened).toEqual(['https://example.com']);
      },
    },

    // === withSpinner ===

    {
      name: 'withSpinner returns the fn result and prints one static line without a TTY',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const streams = makeStreams({ tty: false });
        prompt.setPromptStreams(streams);
        const result = await flows.withSpinner('Crunching', async () => 42, { indent: '' });
        ctx.expect(result).toBe(42);
        ctx.expect(streams.getRendered().includes('Crunching...')).toBeTruthy();
      },
    },

    {
      name: 'withSpinner rethrows and still clears its spinner',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const streams = makeStreams({ tty: true });
        prompt.setPromptStreams(streams);
        await ctx.expect((() => flows.withSpinner('Doomed', async () => { throw new Error('boom'); }))()).rejects.toThrow(/boom/);
      },
    },

    // === pollWithSpinner — non-interactive ===

    {
      name: 'pollWithSpinner without a TTY skips manual-only waits (nobody can press ENTER)',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        prompt.setPromptStreams(makeStreams({ tty: false }));
        const result = await flows.pollWithSpinner({ manualOnly: true, message: 'Waiting' });
        ctx.expect(result).toEqual({ success: false, skipped: true });
      },
    },

    {
      name: 'pollWithSpinner without a TTY polls quietly until the check is done',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        prompt.setPromptStreams(makeStreams({ tty: false }));
        let calls = 0;
        const result = await flows.pollWithSpinner({
          check: async () => (++calls >= 3 ? { done: true, result: 'ready' } : { done: false }),
          intervalMs: 20,
          message: 'Propagating',
        });
        ctx.expect(result).toEqual({ success: true, result: 'ready' });
        ctx.expect(calls).toBe(3);
      },
    },

    {
      name: 'pollWithSpinner surfaces a check error as failure',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        prompt.setPromptStreams(makeStreams({ tty: false }));
        const result = await flows.pollWithSpinner({
          check: async () => { throw new Error('api down'); },
          intervalMs: 20,
        });
        ctx.expect(result).toEqual({ success: false, error: 'api down' });
      },
    },

    {
      name: 'pollWithSpinner surfaces done-with-error as failure',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        prompt.setPromptStreams(makeStreams({ tty: false }));
        const result = await flows.pollWithSpinner({
          check: async () => ({ done: true, error: 'zone rejected' }),
          intervalMs: 20,
        });
        ctx.expect(result).toEqual({ success: false, error: 'zone rejected' });
      },
    },

    // === pollWithSpinner — interactive keypress controls ===

    {
      name: 'pollWithSpinner: S skips the wait',
      run: async (ctx) => {
        ctx.after(afterEachHook);
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
        ctx.expect(result).toEqual({ success: false, skipped: true });
      },
    },

    {
      name: 'pollWithSpinner: ENTER in manual mode means done',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const streams = makeStreams({ tty: true });
        prompt.setPromptStreams(streams);
        const running = flows.pollWithSpinner({ manualOnly: true, message: 'Confirm in dashboard' });
        await waitForOutput(streams, '(enter)=done');
        streams.input.write('\r');
        const result = await running;
        ctx.expect(result).toEqual({ success: true });
      },
    },

    {
      name: 'pollWithSpinner: ENTER forces an immediate re-check',
      run: async (ctx) => {
        ctx.after(afterEachHook);
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
        ctx.expect(result).toEqual({ success: true, result: 'ok' });
        ctx.expect(calls).toBe(2);
      },
    },

    // === openBrowserAndPoll ===

    {
      name: 'openBrowserAndPoll without a TTY prints the URL and skips (no browser)',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        prompt.setPromptStreams(makeStreams({ tty: false }));
        let opened = false;
        flows.setBrowserOpener(async () => { opened = true; return true; });
        const result = await flows.openBrowserAndPoll({
          url: 'https://example.com/setup',
          promptMessage: 'Create the thing',
          waitMessage: 'Waiting',
        });
        ctx.expect(result).toEqual({ success: false, skipped: true });
        ctx.expect(opened).toBe(false);
      },
    },

    {
      name: 'openBrowserAndPoll: Enter opens the URL (synonymous gate); (s) at the poll skips',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const streams = makeStreams({ tty: true });
        prompt.setPromptStreams(streams);
        const opened = [];
        flows.setBrowserOpener(async (url) => { opened.push(url); return true; });
        const running = flows.openBrowserAndPoll({
          url: 'https://example.com/setup',
          promptMessage: 'Create the thing',
          label: 'the setup page',
          waitMessage: 'Waiting',
          check: async () => ({ done: false }),
          intervalMs: 60000, // only a key can end the wait
        });
        await waitForOutput(streams, 'Press Enter to open the setup page');
        streams.input.write('\r');
        await waitForOutput(streams, '(enter)=check now');
        streams.input.write('s');
        const result = await running;
        ctx.expect(result).toEqual({ success: false, skipped: true });
        ctx.expect(opened, 'Enter opened the URL before the poll').toEqual(['https://example.com/setup']);
      },
    },

    {
      name: 'openBrowserAndPoll: Enter → opens the URL and polls to success',
      run: async (ctx) => {
        ctx.after(afterEachHook);
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
        await waitForOutput(streams, 'Press Enter to open this page'); // default label
        streams.input.write('\r');
        const result = await running;
        ctx.expect(result).toEqual({ success: true, result: { id: 'thing_1' } });
        ctx.expect(opened).toEqual(['https://example.com/setup']);
      },
    },
  ],
});
