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
 *     CAPTURED, so a broken template fails right here; each signs off as the
 *     brand's team, since the route passes no signoff of its own,
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

      async run({ http, expect, accounts, admin, omega }) {
        const account = accounts[ACCOUNT];

        // Clear first, so everything read back below is this signup's own.
        capture.clearCaptured(omega);

        const response = await http.as(ACCOUNT).post('omega/user/signup', {});

        expect(response, 'Signup should succeed').toBeSuccess();

        // --- The two that go out now ---
        // Addressed to THIS persona: the store is one file per project, and a
        // fire-and-forget send another suite left in flight would otherwise land in
        // the middle of this count.
        const captured = capture.readCaptured(omega).filter((record) => record.to.includes(account.email));

        expect(captured.length, `Signup owes two immediate emails, got ${captured.length}: ${captured.map((r) => r.subject).join(' | ')}`).toBe(2);

        for (const record of captured) {
          expect(record.to, 'Every onboarding email goes to the new account, and to nobody else').toEqual([account.email]);
          expect(record.template, 'Both ride the card template').toBe('card');
        }

        const brandName = omega.config.brand.name;
        const welcome = captured.find((record) => record.subject === `Welcome to ${brandName}!`);

        expect(welcome, `The welcome email is sent, got: ${captured.map((r) => r.subject).join(' | ')}`).toBeTruthy();
        expect(welcome.sendAt, 'The welcome email goes out immediately').toBe(null);
        expect(welcome.summary, `Its body is the rendered welcome, got: ${welcome.summary}`).toMatch(new RegExp(`Welcome to ${brandName}`));

        const nudge = captured.find((record) => record !== welcome);

        expect(nudge.subject, `The discount nudge is scheduled, got: ${nudge.subject}`).toMatch(/something for you/);
        expect(nudge.sendAt > 0, 'The nudge carries a send time rather than going out now').toBeTruthy();
        expect(nudge.sendAt - Math.floor(Date.now() / 1000), 'The nudge is due about 24 hours out').toBeGreaterThanOrEqual(23 * 3600);
        expect(nudge.sendAt - Math.floor(Date.now() / 1000), 'The nudge is due about 24 hours out').toBeLessThanOrEqual(25 * 3600);

        // --- The two the mailer queues, being past its scheduling limit ---
        const queued = await queuedFor(admin, account.uid);

        expect(queued.length, `Two follow-ups are queued, got ${queued.length}`).toBe(2);

        const checkup = queued.find((data) => data.settings.categories?.includes('account/checkup'));
        const feedback = queued.find((data) => data.settings.categories?.includes('engagement/feedback'));

        expect(checkup, `The checkup is queued, got: ${queued.map((d) => (d.settings.categories || []).join('+')).join(' | ')}`).toBeTruthy();
        expect(feedback, 'The feedback request is queued').toBeTruthy();
        expect(feedback.settings.template, 'The feedback request rides its own template').toBe('feedback');
        expect(checkup.sendAt > Math.floor(Date.now() / 1000), 'Both carry the second they are due').toBeTruthy();
        expect(feedback.sendAt > checkup.sendAt, 'And the feedback request comes after the checkup').toBeTruthy();

        capture.clearCaptured(omega);
      },
    },
  ],
});
