/**
 * Test: the testing-mode email capture — the sink that stands in for SendGrid
 * ([#774](https://github.com/Omega-JS-Stack/omega/issues/774)).
 *
 * Outside extended mode nothing proved an email was sent: every caller gated
 * itself on `ctx.isTesting()` and returned before the mailer, so a broken welcome
 * email or a broken order receipt failed no test — the way the signoff crash on
 * [#640](https://github.com/Omega-JS-Stack/omega/issues/640) went unnoticed. The
 * gate now lives in `Transactional.send()`, past `build()`: the brand, the
 * recipients, the template data and the MJML render all run for real and what
 * would have gone to SendGrid is recorded instead.
 *
 * This suite proves the sink itself — the gate, the store, the summary, the
 * append bound — and then the seam, by sending a real email through the runner's
 * own omega and reading it back out of the store.
 *
 * Plain-node (no emulator, no network): the store is a file and the capture path
 * touches no Firestore, which is the whole reason a file was chosen over a
 * test-only collection (see the module header on src/test/utils/email-capture.js).
 *
 * The extended lane is asserted through the GATE only, never through a send: an
 * extended send delivers real mail, and no test may do that.
 *
 * Run: npx omega test framework:email/testing-capture
 */
const expect = require('../../dist/vendor/devkit/test/expect.js');
const os = require('os');
const path = require('path');
const jetpack = require('fs-jetpack');
const capture = require('../../dist/test/utils/email-capture.js');
const { TEMP_DIR_NAME } = require('../../dist/test/utils/test-mode-file.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// A stand-in project root for the store tests, so they never disturb the real
// project's `.temp/` (which the mailer case below uses for real).
const SCRATCH_DIR = path.join(os.tmpdir(), '_test-omega-email-capture');
const scratchOmega = () => ({ cwd: path.join(SCRATCH_DIR, 'dist') });

/** A testing ctx, and its extended twin */
const testingCtx = { isTesting: () => true };
const productionCtx = { isTesting: () => false };

module.exports = defineCases({
  description: 'Testing-mode email capture: the sink that stands in for SendGrid (#774)',
  type: 'group',

  tests: [
    {
      name: 'testing-mode captures, extended mode and production do not',

      run() {
        const wasExtended = process.env.TEST_EXTENDED_MODE;
        delete process.env.TEST_EXTENDED_MODE;

        try {
          expect(capture.isCapturing(testingCtx), 'a testing send is captured').toBe(true);
          expect(capture.isCapturing(productionCtx), 'a production send is delivered').toBe(false);

          // The lane that deliberately sends real mail is untouched by #774.
          process.env.TEST_EXTENDED_MODE = 'true';
          expect(capture.isCapturing(testingCtx), 'extended mode still delivers').toBe(false);

          // Read per call, never cached: the test command flips this on a RUNNING
          // emulator through .temp/test-mode.json.
          delete process.env.TEST_EXTENDED_MODE;
          expect(capture.isCapturing(testingCtx), 'and flips back within the same process').toBe(true);

          // The one direction a fallback must never take: a ctx that cannot answer
          // would read as "not testing", which hands a test's email to SendGrid.
          expect(() => capture.isCapturing({}), 'a ctx that cannot answer fails loudly').toThrow(/no isTesting/);
          expect(() => capture.isCapturing(null), 'and so does no ctx at all').toThrow(/no isTesting/);
        } finally {
          if (wasExtended === undefined) {
            delete process.env.TEST_EXTENDED_MODE;
          } else {
            process.env.TEST_EXTENDED_MODE = wasExtended;
          }
        }
      },
    },

    {
      name: 'the store sits beside the test-mode file, one project up from the staged tree',

      run() {
        const omega = scratchOmega();

        // The emulator's workers and the test runner are different processes with
        // different staged trees; the parent of each is the same project root,
        // which is exactly how the test-mode watcher finds the file it shares.
        expect(capture.resolveProjectDir(omega), 'the project root is the parent of omega.cwd').toBe(SCRATCH_DIR);
        expect(capture.getCaptureFilePath(SCRATCH_DIR), 'and the store lives in the same .temp/ as test-mode.json').toBe(path.join(SCRATCH_DIR, TEMP_DIR_NAME, capture.CAPTURE_FILENAME));

        expect(() => capture.resolveProjectDir({}), 'a omega that never booted fails loudly rather than writing to some other directory').toThrow(/omega\.cwd is unset/);
      },
    },

    {
      name: 'records round-trip through the store, in send order, and clear empties it',

      run() {
        const omega = scratchOmega();

        capture.clearCaptured(omega);
        expect(capture.readCaptured(omega), 'a missing store reads as no emails, never as an error').toEqual([]);

        capture.recordCaptured(omega, {
          to: [{ email: 'first@test.dev', name: 'First' }],
          template: 'card',
          subject: 'Welcome aboard',
          html: '<p>Hello <strong>First</strong></p>',
        });
        capture.recordCaptured(omega, {
          to: [{ email: 'second@test.dev' }, { email: 'cc@test.dev' }],
          template: 'order',
          subject: 'Your order',
          html: '<p>Receipt</p>',
          sendAt: 1900000000,
        });

        const records = capture.readCaptured(omega);

        expect(records.length, 'both sends are recorded').toBe(2);
        expect(records[0].to, 'the record names the recipient by address').toEqual(['first@test.dev']);
        expect(records[0].template).toBe('card');
        expect(records[0].subject).toBe('Welcome aboard');
        expect(records[0].summary, 'and carries the rendered text').toBe('Hello First');
        expect(records[0].sendAt, 'an immediate send is scheduled for nothing').toBe(null);
        expect(records[1].to, 'every recipient of a send lands in one record').toEqual(['second@test.dev', 'cc@test.dev']);
        expect(records[1].sendAt, 'a scheduled send records the second it is due').toBe(1900000000);

        capture.clearCaptured(omega);
        expect(capture.readCaptured(omega), 'clear empties the store, so a test reads only its own act').toEqual([]);
      },
    },

    {
      name: 'a rendered body reduces to the visible text a test asserts against',

      run() {
        const html = `
          <style>.x { color: red; }</style>
          <!-- a comment -->
          <h2>Order&nbsp;confirmed</h2>
          <p><strong>Sandbox Brand&amp;Co Premium</strong><br/><span>Billed monthly</span></p>
          <p>&#128512; &ndash; total</p>
        `;

        expect(capture.summarize(html), 'styles and markup drop out, entities decode, whitespace collapses').toBe('Order confirmed Sandbox Brand&Co Premium Billed monthly 😀 – total');
        expect(capture.summarize(''), 'an empty body summarizes to nothing').toBe('');
        expect(capture.summarize(undefined), 'and so does a missing one').toBe('');
        expect(capture.summarize('x'.repeat(capture.SUMMARY_LIMIT + 500)).length, 'a long body is capped').toBe(capture.SUMMARY_LIMIT);
      },
    },

    {
      name: 'a record stays inside the atomic-append bound, so two processes never tear a line',

      run() {
        const omega = scratchOmega();

        capture.clearCaptured(omega);
        capture.recordCaptured(omega, {
          to: [{ email: 'huge@test.dev' }],
          template: 'card',
          subject: 'A very long email',
          // Every character survives summarize() as itself, so this is the worst case
          html: 'w'.repeat(50000),
        });

        const contents = jetpack.read(capture.getCaptureFilePath(SCRATCH_DIR), 'utf8');
        const lines = contents.split('\n').filter((line) => line.trim());

        expect(lines.length, 'one send is one line').toBe(1);
        expect(lines[0].length <= capture.LINE_LIMIT, `a record must fit the PIPE_BUF bound the appends rely on, got ${lines[0].length}`).toBeTruthy();
        expect(capture.readCaptured(omega).length, 'and it still parses').toBe(1);

        capture.clearCaptured(omega);
        jetpack.remove(SCRATCH_DIR);
      },
    },

    {
      name: 'a record that cannot be trimmed under the bound throws instead of tearing the store',

      run() {
        const omega = scratchOmega();

        capture.clearCaptured(omega);

        // The bound lives on the ENVELOPE too: a recipient list this long fills the
        // line on its own, so there is nothing left for the summary to give back.
        // Appending it would tear a concurrent process's line and lose both records.
        const bulk = Array.from({ length: 200 }, (unused, index) => ({ email: `_test-bulk-${index}@a-fairly-long-domain.example.com` }));

        expect(() => capture.recordCaptured(omega, { to: bulk, template: 'card', subject: 'Bulk', html: '<p>hi</p>' }), 'an unrecordable send fails loudly rather than corrupting the store').toThrow(/nothing left to trim/);
        expect(capture.readCaptured(omega), 'and nothing was written').toEqual([]);

        jetpack.remove(SCRATCH_DIR);
      },
    },

    {
      name: 'the mailer records instead of sending, past a real render',

      async run({ omega, ctx }) {
        // The REAL mailer, the REAL brand, the REAL MJML render — only the delivery
        // is replaced. A template that throws (the #640 signoff crash) fails here.
        capture.clearCaptured(omega);

        const result = await ctx.email.send({
          sender: 'account',
          to: '_test.capture-seam@test.dev',
          subject: 'The seam records this one',
          template: 'card',
          categories: ['account/checkup'],
          copy: false,
          data: {
            content: {
              title: 'Captured',
              message: 'This email was never handed to SendGrid.',
            },
          },
        });

        expect(result.status, 'a testing send reports what happened to it').toBe('captured');
        expect(result.options.content[0].value.includes('<html'), 'and it went through the full render on the way').toBeTruthy();

        const records = capture.readCaptured(omega);

        expect(records.length, `exactly one email was recorded, got ${records.length}`).toBe(1);
        expect(records[0].to).toEqual(['_test.capture-seam@test.dev']);
        expect(records[0].template).toBe('card');
        expect(records[0].subject).toBe('The seam records this one');
        expect(records[0].summary, 'the summary carries the rendered body text').toMatch(/This email was never handed to SendGrid\./);

        capture.clearCaptured(omega);
      },
    },
  ],
});
