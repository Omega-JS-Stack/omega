/**
 * Test: signup actually sends its onboarding emails
 * ([#774](https://github.com/Omega-JS-Stack/omega/issues/774)).
 *
 * The route used to gate itself — `shouldSend = !ctx.isTesting() || TEST_EXTENDED_MODE`
 * — and returned before the mailer, so every offline run proved nothing about the
 * four emails a new account is owed. That gate moved into `Transactional.send()`,
 * which now RECORDS a testing send instead of delivering it, so the route runs its
 * real sends here and this suite reads them back.
 *
 * The four split two ways, by the mailer's own scheduling limit (`SEND_AT_LIMIT`,
 * 71 hours):
 *   - welcome (immediate) and the 24-hour discount nudge are built, rendered and
 *     CAPTURED — a broken template or an unconfigured signoff fails right here,
 *     which is exactly how the [#640](https://github.com/Omega-JS-Stack/omega/issues/640)
 *     signoff crash reached production unnoticed,
 *   - the 5-day checkup and the 10-day feedback request are past the limit, so they
 *     land in `emails-queue` for the frequent cron to send later.
 *
 * Emulator-backed: the route is real, the user doc it emails is real, and the queue
 * is real Firestore.
 *
 * Run: npx omega test framework:routes/user/signup-emails
 */
const capture = require('../../../dist/test/utils/email-capture.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const ACCOUNT = 'signup-emails';

/**
 * The queued emails addressed to one uid.
 *
 * @param {object} admin - The admin SDK handle
 * @param {string} uid - The recipient
 * @returns {Promise<object[]>} The queue documents' data
 */
async function queuedFor(admin, uid) {
  const snapshot = await admin.firestore().collection('emails-queue').get();

  return snapshot.docs
    .map((doc) => doc.data())
    .filter((data) => data?.settings?.to === uid);
}

module.exports = defineCases({
  description: 'Signup sends the welcome email and schedules the follow-ups (#774)',
  type: 'suite',
  timeout: 60000,

  tests: [
    {
      name: 'signup-captures-the-welcome-and-the-nudge-and-queues-the-follow-ups',

      async run({ http, assert, accounts, admin, Manager }) {
        const account = accounts[ACCOUNT];

        // Clear first, so everything read back below is this signup's own.
        capture.clearCaptured(Manager);

        const response = await http.as(ACCOUNT).post('backend-manager/user/signup', {});

        assert.isSuccess(response, 'Signup should succeed');

        // --- The two that go out now ---
        // Addressed to THIS persona: the store is one file per project, and a
        // fire-and-forget send another suite left in flight would otherwise land in
        // the middle of this count.
        const captured = capture.readCaptured(Manager).filter((record) => record.to.includes(account.email));

        assert.equal(captured.length, 2, `Signup owes two immediate emails, got ${captured.length}: ${captured.map((r) => r.subject).join(' | ')}`);

        for (const record of captured) {
          assert.deepEqual(record.to, [account.email], 'Every onboarding email goes to the new account, and to nobody else');
          assert.equal(record.template, 'card', 'Both ride the card template');
        }

        const brandName = Manager.config.brand.name;
        const welcome = captured.find((record) => record.subject === `Welcome to ${brandName}!`);

        assert.ok(welcome, `The welcome email is sent, got: ${captured.map((r) => r.subject).join(' | ')}`);
        assert.equal(welcome.sendAt, null, 'The welcome email goes out immediately');
        assert.match(welcome.summary, new RegExp(`Welcome to ${brandName}`), `Its body is the rendered welcome, got: ${welcome.summary}`);

        const nudge = captured.find((record) => record !== welcome);

        assert.match(nudge.subject, /something for you/, `The discount nudge is scheduled, got: ${nudge.subject}`);
        assert.ok(nudge.sendAt > 0, 'The nudge carries a send time rather than going out now');
        assert.inRange(
          nudge.sendAt - Math.floor(Date.now() / 1000),
          23 * 3600,
          25 * 3600,
          'The nudge is due about 24 hours out',
        );

        // --- The two the mailer queues, being past its scheduling limit ---
        const queued = await queuedFor(admin, account.uid);

        assert.equal(queued.length, 2, `Two follow-ups are queued, got ${queued.length}`);

        const checkup = queued.find((data) => data.settings.categories?.includes('account/checkup'));
        const feedback = queued.find((data) => data.settings.categories?.includes('engagement/feedback'));

        assert.ok(checkup, `The checkup is queued, got: ${queued.map((d) => (d.settings.categories || []).join('+')).join(' | ')}`);
        assert.ok(feedback, 'The feedback request is queued');
        assert.equal(feedback.settings.template, 'feedback', 'The feedback request rides its own template');
        assert.ok(checkup.sendAt > Math.floor(Date.now() / 1000), 'Both carry the second they are due');
        assert.ok(feedback.sendAt > checkup.sendAt, 'And the feedback request comes after the checkup');

        capture.clearCaptured(Manager);
      },
    },
  ],
});
