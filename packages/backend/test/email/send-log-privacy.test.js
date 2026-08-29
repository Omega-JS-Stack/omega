/**
 * Email.send() log-privacy test — a log line names its recipient, never the document.
 *
 * A caller may hand `to` a whole user document (the order and welcome senders do),
 * and that document carries api.privateKey, consent, IP and attribution. The
 * `Email.send():` line used to JSON.stringify whatever it was handed straight into
 * Cloud Logging, where it stays for the retention window
 * ([#632](https://github.com/Omega-JS-Stack/omega/issues/632)).
 *
 * Plain-node unit test (no emulator, no network): the line is written before send()
 * reaches SendGrid, so the send is allowed to reject at that seam and the assertions
 * read the captured ctx output.
 */
const assert = require('node:assert');

const Transactional = require('../../src/manager/libraries/email/transactional/index.js');

// The leak fixture: a user document shaped the way a sender hands it to Email.send().
const LEAKED_KEY = 'sk_test_fake_leak';
const USER_DOC = {
  auth: { uid: 'user-632', email: 'recipient@test.dev' },
  personal: { name: { first: 'Rec' } },
  api: { clientId: 'client-632', privateKey: LEAKED_KEY },
  consent: { marketing: { status: 'granted', ip: '203.0.113.7' } },
  attribution: { source: 'newsletter' },
};

async function captureSend(to) {
  process.env.UNSUBSCRIBE_HMAC_KEY = process.env.UNSUBSCRIBE_HMAC_KEY || 'test-key';

  const Manager = {
    config: {
      brand: { id: 'testbrand', name: 'Test Brand', url: 'https://test.dev', contact: { email: 'hello@test.dev' }, images: {} },
    },
    project: { websiteUrl: 'https://test.dev' },
    libraries: { admin: {} },
    User: () => ({ properties: {} }),
  };

  const captured = [];
  const record = (...args) => captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  const ctx = { Manager, log: record, warn: record, error: record };

  // There is no SendGrid in a unit test — the send rejects at that seam, long after
  // the line under test was written. The assertions are on the log, not the result.
  await new Transactional(ctx).send({ to, subject: 'Your order', template: 'order' }).catch(() => {});

  return captured;
}

let userDocSend;
const sendWithUserDoc = () => (userDocSend = userDocSend || captureSend(USER_DOC));

module.exports = {
  description: 'Email.send() log privacy (recipient named by address/uid, never serialized)',
  type: 'group',
  tests: [
    {
      name: 'send() line names the recipient by address',

      async run() {
        const captured = await sendWithUserDoc();
        const line = captured.find((l) => l.includes('Email.send():'));

        assert.ok(line, `no Email.send() line was logged: ${JSON.stringify(captured)}`);
        assert.ok(line.includes('recipient@test.dev'), `line does not name the recipient: ${line}`);
        assert.ok(line.includes('subject=Your order'), `line lost the subject: ${line}`);
        assert.ok(line.includes('template=order'), `line lost the template: ${line}`);
      },
    },

    {
      name: 'send() line never serializes the user document it was handed',

      async run() {
        const captured = await sendWithUserDoc();
        const line = captured.find((l) => l.includes('Email.send():'));

        assert.ok(!line.includes('privateKey'), `user document serialized into the log line: ${line}`);
        assert.ok(!line.includes(LEAKED_KEY), `private key written to the log line: ${line}`);
      },
    },

    {
      name: 'no line of the whole send carries the private key',

      async run() {
        const captured = await sendWithUserDoc();
        const leaking = captured.filter((l) => l.includes(LEAKED_KEY) || l.includes('privateKey'));

        assert.deepEqual(leaking, [], `private key reached the log: ${JSON.stringify(leaking)}`);
      },
    },

    {
      name: 'a uid-only recipient is named by uid',

      async run() {
        const captured = await captureSend('user-632');
        const line = captured.find((l) => l.includes('Email.send():'));

        assert.ok(line.includes('uid:user-632'), `line does not name the uid: ${line}`);
      },
    },
  ],
};
