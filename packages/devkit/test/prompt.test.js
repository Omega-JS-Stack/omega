// Tests for src/prompt.js — the TTY-safe wrapper around @inquirer/prompts.
//
// Interactive tests drive the REAL inquirer prompts through fake streams
// (setPromptStreams + the src/test/prompt-streams harness): keystrokes go
// in, rendered output comes out, no mocks. waitForOutput() guarantees a
// prompt has rendered (and is listening) before keystrokes are written.

const defineCases = require('@omega.js/devkit/test/define-cases');
const prompt = require('../src/prompt');
const { makeStreams, waitForOutput, DOWN_ARROW } = require('../src/test/prompt-streams');

const afterEachHook = () => {
  prompt.setPromptStreams(null);
};

module.exports = defineCases({
  type: 'group',
  description: 'prompt',
  tests: [
    // === Non-interactive (no TTY) ===

    {
      name: 'isInteractive is false for non-TTY streams',
      run: (ctx) => {
        ctx.after(afterEachHook);
        const streams = makeStreams({ tty: false });
        prompt.setPromptStreams(streams);
        ctx.expect(prompt.isInteractive()).toBe(false);
      },
    },

    {
      name: 'OMEGA_NON_INTERACTIVE=1 forces isInteractive false even on TTY streams',
      run: (ctx) => {
        ctx.after(afterEachHook);
        prompt.setPromptStreams(makeStreams({ tty: true }));
        ctx.expect(prompt.isInteractive(), 'TTY baseline').toBe(true);
        process.env.OMEGA_NON_INTERACTIVE = '1';
        try {
          ctx.expect(prompt.isInteractive()).toBe(false);
        } finally {
          delete process.env.OMEGA_NON_INTERACTIVE;
        }
        ctx.expect(prompt.isInteractive(), 'restored after env cleared').toBe(true);
      },
    },

    {
      name: 'input throws without a TTY',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        prompt.setPromptStreams(makeStreams({ tty: false }));
        await ctx.expect((async () => prompt.input({ message: 'Name:' }))()).rejects.toThrow(/Interactive prompt blocked: no TTY available/);
      },
    },

    {
      name: 'select throws without a TTY',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        prompt.setPromptStreams(makeStreams({ tty: false }));
        await ctx.expect((async () => prompt.select({ message: 'Pick:', choices: [{ value: 'a' }] }))()).rejects.toThrow(/Interactive prompt blocked/);
      },
    },

    {
      name: 'checkbox throws without a TTY',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        prompt.setPromptStreams(makeStreams({ tty: false }));
        await ctx.expect((async () => prompt.checkbox({ message: 'Pick:', choices: [{ value: 'a' }] }))()).rejects.toThrow(/Interactive prompt blocked/);
      },
    },

    {
      name: 'confirm auto-returns its default without a TTY',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        prompt.setPromptStreams(makeStreams({ tty: false }));
        ctx.expect(await prompt.confirm({ message: 'Done?', default: false })).toBe(false);
        ctx.expect(await prompt.confirm({ message: 'Done?', default: true })).toBe(true);
        ctx.expect(await prompt.confirm({ message: 'Done?' })).toBe(true);
      },
    },

    {
      name: 'required confirm throws without a TTY instead of auto-accepting',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        prompt.setPromptStreams(makeStreams({ tty: false }));
        await ctx.expect((async () => prompt.confirm({ message: 'Delete everything?', required: true }))()).rejects.toThrow(/Interactive prompt blocked/);
      },
    },

    {
      name: 'setPromptStreams(null) restores process stdio (non-TTY under the test runner)',
      run: (ctx) => {
        ctx.after(afterEachHook);
        prompt.setPromptStreams(makeStreams({ tty: true }));
        ctx.expect(prompt.isInteractive()).toBe(true);
        prompt.setPromptStreams(null);
        ctx.expect(prompt.isInteractive()).toBe(false);
      },
    },

    // === Interactive (TTY streams, real inquirer) ===

    {
      name: 'isInteractive is true for TTY streams',
      run: (ctx) => {
        ctx.after(afterEachHook);
        prompt.setPromptStreams(makeStreams({ tty: true }));
        ctx.expect(prompt.isInteractive()).toBe(true);
      },
    },

    {
      name: 'input resolves typed text',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const streams = makeStreams({ tty: true });
        prompt.setPromptStreams(streams);

        const answer = prompt.input({ message: 'Brand id:' });
        await waitForOutput(streams, 'Brand id:');
        streams.input.write('acme\r');

        ctx.expect(await answer).toBe('acme');
      },
    },

    {
      name: 'input re-prompts on failed validation until the value passes',
      run: async (ctx) => {
        ctx.after(afterEachHook);
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

        ctx.expect(await answer).toBe('good');
      },
    },

    {
      name: 'select resolves the arrowed-to choice',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const streams = makeStreams({ tty: true });
        prompt.setPromptStreams(streams);

        const answer = prompt.select({
          message: 'Zone:',
          choices: [{ value: 'first' }, { value: 'second' }],
        });
        await waitForOutput(streams, 'Zone:');
        streams.input.write(DOWN_ARROW);
        streams.input.write('\r');

        ctx.expect(await answer).toBe('second');
      },
    },

    {
      name: 'checkbox resolves toggled choices',
      run: async (ctx) => {
        ctx.after(afterEachHook);
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

        ctx.expect(await answer).toEqual(['web', 'backend']);
      },
    },

    {
      name: 'confirm resolves y / n keystrokes',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const yes = makeStreams({ tty: true });
        prompt.setPromptStreams(yes);
        const yesAnswer = prompt.confirm({ message: 'Ship it?', default: false });
        await waitForOutput(yes, 'Ship it?');
        yes.input.write('y\r');
        ctx.expect(await yesAnswer).toBe(true);

        const no = makeStreams({ tty: true });
        prompt.setPromptStreams(no);
        const noAnswer = prompt.confirm({ message: 'Ship it?', default: true });
        await waitForOutput(no, 'Ship it?');
        no.input.write('n\r');
        ctx.expect(await noAnswer).toBe(false);
      },
    },

    {
      name: 'confirm bare enter takes the default',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const streams = makeStreams({ tty: true });
        prompt.setPromptStreams(streams);

        const answer = prompt.confirm({ message: 'Proceed?', default: false });
        await waitForOutput(streams, 'Proceed?');
        streams.input.write('\r');

        ctx.expect(await answer).toBe(false);
      },
    },

    {
      name: 'sequential prompts on one stream pair all render and resolve',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const streams = makeStreams({ tty: true });
        prompt.setPromptStreams(streams);

        const first = prompt.input({ message: 'First:' });
        await waitForOutput(streams, 'First:');
        streams.input.write('one\r');
        ctx.expect(await first).toBe('one');

        const second = prompt.input({ message: 'Second:' });
        await waitForOutput(streams, 'Second:');
        streams.input.write('two\r');
        ctx.expect(await second).toBe('two');

        const third = prompt.confirm({ message: 'Third?', default: false });
        await waitForOutput(streams, 'Third?');
        streams.input.write('y\r');
        ctx.expect(await third).toBe(true);
      },
    },

    {
      name: 'pressEnterToOpen: non-TTY prints the URL and returns false (no browser)',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const streams = makeStreams({ tty: false });
        prompt.setPromptStreams(streams);

        const opened = await prompt.pressEnterToOpen('https://example.com/console', 'the console');
        ctx.expect(opened).toBe(false);
        ctx.expect(streams.getRendered().includes('https://example.com/console'), 'URL printed as the fallback').toBeTruthy();
        ctx.expect(!streams.getRendered().includes('Press Enter'), 'no prompt without a TTY').toBeTruthy();
      },
    },

    {
      name: 'pressEnterToOpen: interactive waits for Enter, then launches the browser',
      run: async (ctx) => {
        ctx.after(afterEachHook);
        const streams = makeStreams({ tty: true });
        prompt.setPromptStreams(streams);

        const opened = [];
        const realOpen = prompt.openInBrowser;
        prompt.openInBrowser = (url) => { opened.push(url); return true; };

        try {
          const pending = prompt.pressEnterToOpen('https://example.com/console', 'the console');
          await waitForOutput(streams, 'Press Enter to open the console');
          streams.input.write('\r');
          ctx.expect(await pending).toBe(true);
          ctx.expect(opened, 'launch happens only after Enter').toEqual(['https://example.com/console']);
        } finally {
          prompt.openInBrowser = realOpen;
        }
      },
    },

    {
      name: 'openCommand maps the current platform to its opener',
      run: (ctx) => {
        ctx.after(afterEachHook);
        const expected = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        ctx.expect(prompt.openCommand()).toBe(expected);
      },
    },
  ],
});
