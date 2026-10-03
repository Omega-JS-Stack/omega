// Tests for src/lib/run-gates.js — the standardized run-mode gates:
// canPrompt (TTY + not-dry-run compound), dryRunPlan (canonical ⊘ line +
// pass-through), needsInteractiveSkip (#32 warned step-aside shape).

const defineCases = require('@omega.js/devkit/test/define-cases');
const { PassThrough } = require('node:stream');
const { setPromptStreams } = require('@omega.js/devkit/prompt');
const { canPrompt, dryRunPlan, needsInteractiveSkip } = require('../src/lib/run-gates.js');

/** Route prompts through a fake TTY (or non-TTY) input for one callback. */
function withStreams(isTTY, fn) {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = isTTY;
  output.isTTY = isTTY;
  setPromptStreams({ input, output });
  try {
    return fn();
  } finally {
    setPromptStreams(null);
  }
}

/** Run fn with console.log captured; returns { result, text }. */
function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    return { result: fn(), text: lines.join('\n') };
  } finally {
    console.log = original;
  }
}

module.exports = defineCases({
  type: 'group',
  description: 'run-gates',
  tests: [
    {
      name: 'canPrompt: true on a TTY without dryRun, false with dryRun, false off-TTY',
      run: (ctx) => {
        withStreams(true, () => {
          ctx.expect(canPrompt({})).toBe(true);
          ctx.expect(canPrompt(undefined)).toBe(true);
          ctx.expect(canPrompt({ dryRun: true })).toBe(false);
        });
        withStreams(false, () => {
          ctx.expect(canPrompt({})).toBe(false);
          ctx.expect(canPrompt({ dryRun: true })).toBe(false);
        });
      },
    },

    {
      name: 'canPrompt: OMEGA_NON_INTERACTIVE=1 forces false on a TTY — the one headless switch (#228)',
      run: (ctx) => {
        withStreams(true, () => {
          ctx.expect(canPrompt({}), 'TTY baseline').toBe(true);
          process.env.OMEGA_NON_INTERACTIVE = '1';
          try {
            ctx.expect(canPrompt({})).toBe(false);
          } finally {
            delete process.env.OMEGA_NON_INTERACTIVE;
          }
          ctx.expect(canPrompt({}), 'restored after env cleared').toBe(true);
        });
      },
    },

    {
      name: 'dryRunPlan: prints the canonical line and passes the result through',
      run: (ctx) => {
        const planned = { output: { list: { planned: 'create' } } };
        const { result, text } = captureLog(() => dryRunPlan('create list "News"', planned));
        ctx.expect(result).toBe(planned);
        ctx.expect(text).toMatch(/⊘ Dry run — would create list "News"/);

        const bare = captureLog(() => dryRunPlan('enable email routing'));
        ctx.expect(bare.result).toBe(undefined);
        ctx.expect(bare.text).toMatch(/⊘ Dry run — would enable email routing/);
      },
    },

    {
      name: 'needsInteractiveSkip: warned return with the #32 marker under the operation key',
      run: (ctx) => {
        const withNote = needsInteractiveSkip('billing', 'pick a billing account', 'nothing configured');
        ctx.expect(withNote).toEqual({
          status: 'warned',
          reason: 'needs an interactive run',
          output: {
            billing: {
              note: 'nothing configured',
              needsInteractive: 'pick a billing account',
            },
          },
        });

        const withoutNote = needsInteractiveSkip('cloudMessaging', 'paste the VAPID keys');
        ctx.expect(withoutNote).toEqual({
          status: 'warned',
          reason: 'needs an interactive run',
          output: {
            cloudMessaging: {
              needsInteractive: 'paste the VAPID keys',
            },
          },
        });
      },
    },
  ],
});
