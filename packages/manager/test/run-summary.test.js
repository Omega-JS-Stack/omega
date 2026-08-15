// Tests for src/lib/run-summary.js — focused on the needs-interactive
// aggregate (#32: any handler output sub-object may carry
// `needsInteractive: '<what an interactive run would do>'`) and the blessed
// retry command. Full breakdown rendering is exercised by the manage/company
// integration tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RunSummary } = require('../src/lib/run-summary.js');

/** Print the summary with console.log captured; returns the joined text. */
function captureSummary(summary) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    summary.printSummary();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

test('run-summary: needsInteractive markers aggregate into the ⚑ section with the blessed command', () => {
  const summary = new RunSummary();
  summary.add('brand-a', 'Brand A', 'firebase', {
    status: 'warned',
    output: {
      cloudMessaging: {
        note: 'no VAPID key pair in state (needs an interactive run)',
        needsInteractive: 'paste the VAPID key pair from the Cloud Messaging settings',
      },
      authentication: { needsInteractive: 'confirm the OAuth client origins + redirect URIs' },
      hosting: { domains: 2 }, // no marker — never listed
    },
  });

  const text = captureSummary(summary);

  assert.ok(text.includes('Skipped — needs an interactive run:'));
  assert.ok(text.includes('firebase/cloudMessaging'));
  assert.ok(text.includes('paste the VAPID key pair'));
  assert.ok(text.includes('firebase/authentication'));
  assert.ok(!text.includes('firebase/hosting'));
  assert.ok(text.includes('npm run manage -- --service=firebase'));
  assert.ok(!text.includes('Brand A ·')); // single brand → no prefix noise
});

test('run-summary: no markers → no ⚑ section', () => {
  const summary = new RunSummary();
  summary.add('brand-a', 'Brand A', 'firebase', {
    status: 'success',
    output: { hosting: { domains: 2 } },
  });

  const text = captureSummary(summary);

  assert.ok(!text.includes('needs an interactive run'));
});

test('run-summary: multi-brand aggregate prefixes the brand name', () => {
  const summary = new RunSummary();
  summary.add('brand-a', 'Brand A', 'firebase', {
    status: 'warned',
    output: { cloudMessaging: { needsInteractive: 'paste the VAPID key pair' } },
  });
  summary.add('brand-b', 'Brand B', 'firebase', { status: 'success', output: {} });

  const text = captureSummary(summary);

  assert.ok(text.includes('Brand A · '));
});

test('run-summary: the retry line carries the flags, never a doubled verb (#229)', () => {
  const originalArgv = process.argv;
  process.argv = ['node', 'cli-run.js', 'manage', '--service=payment'];

  let text;
  try {
    const summary = new RunSummary();
    summary.add('brand-a', 'Brand A', 'payment', { status: 'error', error: 'boom' });
    text = captureSummary(summary);
  } finally {
    process.argv = originalArgv;
  }

  assert.ok(text.includes('npm run manage -- --service=payment'), 'the script already IS the verb');
  assert.ok(!text.includes('manage -- manage'), 'a copy-pasted retry must not run `omega manage manage`');
});

test('run-summary: retry command is the blessed npm run manage form, never npx', () => {
  const summary = new RunSummary();
  summary.add('brand-a', 'Brand A', 'update', { status: 'error', error: 'boom' });

  const text = captureSummary(summary);

  assert.ok(text.includes('npm run manage'));
  assert.ok(!text.includes('npx omega-manager'));
});
