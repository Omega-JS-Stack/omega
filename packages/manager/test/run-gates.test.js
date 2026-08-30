// Tests for src/lib/run-gates.js — the standardized run-mode gates:
// canPrompt (TTY + not-dry-run compound), dryRunPlan (canonical ⊘ line +
// pass-through), needsInteractiveSkip (#32 warned step-aside shape).

const { test } = require('node:test');
const assert = require('node:assert/strict');
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

test('canPrompt: true on a TTY without dryRun, false with dryRun, false off-TTY', () => {
  withStreams(true, () => {
    assert.equal(canPrompt({}), true);
    assert.equal(canPrompt(undefined), true);
    assert.equal(canPrompt({ dryRun: true }), false);
  });
  withStreams(false, () => {
    assert.equal(canPrompt({}), false);
    assert.equal(canPrompt({ dryRun: true }), false);
  });
});

test('canPrompt: OMEGA_NON_INTERACTIVE=1 forces false on a TTY — the one headless switch (#228)', () => {
  withStreams(true, () => {
    assert.equal(canPrompt({}), true, 'TTY baseline');
    process.env.OMEGA_NON_INTERACTIVE = '1';
    try {
      assert.equal(canPrompt({}), false);
    } finally {
      delete process.env.OMEGA_NON_INTERACTIVE;
    }
    assert.equal(canPrompt({}), true, 'restored after env cleared');
  });
});

test('dryRunPlan: prints the canonical line and passes the result through', () => {
  const planned = { output: { list: { planned: 'create' } } };
  const { result, text } = captureLog(() => dryRunPlan('create list "News"', planned));
  assert.equal(result, planned);
  assert.match(text, /⊘ Dry run — would create list "News"/);

  const bare = captureLog(() => dryRunPlan('enable email routing'));
  assert.equal(bare.result, undefined);
  assert.match(bare.text, /⊘ Dry run — would enable email routing/);
});

test('needsInteractiveSkip: warned return with the #32 marker under the operation key', () => {
  const withNote = needsInteractiveSkip('billing', 'pick a billing account', 'nothing configured');
  assert.deepEqual(withNote, {
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
  assert.deepEqual(withoutNote, {
    status: 'warned',
    reason: 'needs an interactive run',
    output: {
      cloudMessaging: {
        needsInteractive: 'paste the VAPID keys',
      },
    },
  });
});
