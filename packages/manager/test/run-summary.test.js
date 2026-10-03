// Tests for src/lib/run-summary.js — focused on the needs-interactive
// aggregate (#32: any handler output sub-object may carry
// `needsInteractive: '<what an interactive run would do>'`) and the blessed
// retry command. Full breakdown rendering is exercised by the manage/company
// integration tests.

const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'run-summary',
  tests: [
    {
      name: 'run-summary: needsInteractive markers aggregate into the ⚑ section with the blessed command',
      run: (ctx) => {
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

        ctx.expect(text.includes('Skipped — needs an interactive run:')).toBeTruthy();
        ctx.expect(text.includes('firebase/cloudMessaging')).toBeTruthy();
        ctx.expect(text.includes('paste the VAPID key pair')).toBeTruthy();
        ctx.expect(text.includes('firebase/authentication')).toBeTruthy();
        ctx.expect(!text.includes('firebase/hosting')).toBeTruthy();
        ctx.expect(text.includes('npm run manage -- --service=firebase')).toBeTruthy();
        ctx.expect(!text.includes('Brand A ·')).toBeTruthy(); // single brand → no prefix noise
      },
    },

    {
      name: 'run-summary: no markers → no ⚑ section',
      run: (ctx) => {
        const summary = new RunSummary();
        summary.add('brand-a', 'Brand A', 'firebase', {
          status: 'success',
          output: { hosting: { domains: 2 } },
        });

        const text = captureSummary(summary);

        ctx.expect(!text.includes('needs an interactive run')).toBeTruthy();
      },
    },

    {
      name: 'run-summary: multi-brand aggregate prefixes the brand name',
      run: (ctx) => {
        const summary = new RunSummary();
        summary.add('brand-a', 'Brand A', 'firebase', {
          status: 'warned',
          output: { cloudMessaging: { needsInteractive: 'paste the VAPID key pair' } },
        });
        summary.add('brand-b', 'Brand B', 'firebase', { status: 'success', output: {} });

        const text = captureSummary(summary);

        ctx.expect(text.includes('Brand A · ')).toBeTruthy();
      },
    },

    {
      name: 'run-summary: the retry line carries the flags, never a doubled verb (#229)',
      run: (ctx) => {
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

        ctx.expect(text.includes('npm run manage -- --service=payment'), 'the script already IS the verb').toBeTruthy();
        ctx.expect(!text.includes('manage -- manage'), 'a copy-pasted retry must not run `omega manage manage`').toBeTruthy();
      },
    },

    {
      name: 'run-summary: retry command is the blessed npm run manage form, never npx',
      run: (ctx) => {
        const summary = new RunSummary();
        summary.add('brand-a', 'Brand A', 'update', { status: 'error', error: 'boom' });

        const text = captureSummary(summary);

        ctx.expect(text.includes('npm run manage')).toBeTruthy();
        ctx.expect(!text.includes('npx omega-manager')).toBeTruthy();
      },
    },

    {
      name: 'run-summary: the warned breakdown names every recorded operation and its reason (#643)',
      run: (ctx) => {
        const summary = new RunSummary();
        summary.add('brand-a', 'Brand A', 'search', {
          status: 'warned',
          warned: [
            { operation: 'property', reason: 'no Cloudflare zone yet' },
            { operation: 'gaLink', reason: 'link the property in the Analytics console' },
          ],
        });

        const text = captureSummary(summary);

        ctx.expect(text.includes('property')).toBeTruthy();
        ctx.expect(text.includes('no Cloudflare zone yet')).toBeTruthy();
        ctx.expect(text.includes('gaLink')).toBeTruthy();
        ctx.expect(text.includes('link the property in the Analytics console')).toBeTruthy();
        ctx.expect(!text.includes('some operations had issues')).toBeTruthy();
      },
    },

    {
      name: 'run-summary: a warned operation with no reason still names the operation (#643)',
      run: (ctx) => {
        const summary = new RunSummary();
        summary.add('brand-a', 'Brand A', 'edge', {
          status: 'warned',
          warned: [{ operation: 'rulesets', reason: null }],
        });

        const text = captureSummary(summary);

        ctx.expect(text.includes('rulesets')).toBeTruthy();
        ctx.expect(!text.includes('some operations had issues')).toBeTruthy();
      },
    },

    {
      name: 'run-summary: the error breakdown names every recorded failed operation and its reason (#643)',
      run: (ctx) => {
        const summary = new RunSummary();
        summary.add('brand-a', 'Brand A', 'edge', {
          status: 'error',
          failed: [
            { operation: 'x', reason: 'kaput' },
            { operation: 'zzop', reason: null },
          ],
        });

        const text = captureSummary(summary);

        ctx.expect(text.includes('x')).toBeTruthy();
        ctx.expect(text.includes('kaput')).toBeTruthy();
        ctx.expect(text.includes('zzop')).toBeTruthy();
      },
    },

    {
      name: 'run-summary: an error with no failed[] still renders the generic service line (#643)',
      run: (ctx) => {
        const summary = new RunSummary();
        summary.add('brand-a', 'Brand A', 'edge', {
          status: 'error',
          error: 'the zone request was refused',
        });

        const text = captureSummary(summary);

        ctx.expect(text.includes('edge: the zone request was refused')).toBeTruthy();
      },
    },
  ],
});
