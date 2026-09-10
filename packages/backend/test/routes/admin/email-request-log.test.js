/**
 * Test: POST /admin/email — the request log line carries metadata only
 *
 * The handler used to log the whole settings object, so every recipient address and
 * the full body landed in Cloud Logging and outlived the send. #127 trimmed it to
 * non-content metadata (recipient count, template id, subject), matching the #90
 * rejection line beside it, which logs field names only.
 *
 * The handler runs for real; the only stand-ins are the ctx it is handed (a recorder)
 * and `Manager.Email`, whose `send()` would hit SendGrid.
 *
 * Run: npx omega test backend:routes/admin/email-request-log
 */
const handler = require('../../../dist/manager/routes/admin/email/post.js');
const defineCases = require('../../../dist/vendor/devkit/test/define-cases.js');

const ADMIN = { authenticated: true, roles: { admin: true } };

// Run the handler against a recording ctx and return every log line it emitted.
async function logLinesFor(settings) {
  const lines = [];
  const ctx = {
    log: (...args) => lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')),
    respond: (body) => body,
    Manager: { Email: () => ({ send: async () => ({ status: 'sent' }) }) },
  };

  const previousKey = process.env.SENDGRID_API_KEY;

  process.env.SENDGRID_API_KEY = 'test-key';

  try {
    await handler({ ctx, user: ADMIN, settings });
  } finally {
    if (previousKey === undefined) {
      delete process.env.SENDGRID_API_KEY;
    } else {
      process.env.SENDGRID_API_KEY = previousKey;
    }
  }

  return lines;
}

const SETTINGS = {
  to: [{ email: 'first@private.dev' }, { email: 'second@private.dev' }],
  bcc: 'third@private.dev',
  subject: 'Your receipt',
  template: 'card',
  data: { content: { message: 'Account number 4111 1111 1111 1111 is now active.' } },
};

module.exports = defineCases({
  description: 'Admin send email — the request log carries no addresses and no body (#127)',
  type: 'group',

  tests: [
    {
      name: 'request-log-omits-recipient-addresses-and-body',
      async run({ assert }) {
        const lines = await logLinesFor(SETTINGS);
        const joined = lines.join('\n');

        assert.equal(joined.includes('first@private.dev'), false, `A recipient address reached the log: ${joined}`);
        assert.equal(joined.includes('second@private.dev'), false, `A recipient address reached the log: ${joined}`);
        assert.equal(joined.includes('third@private.dev'), false, `A bcc address reached the log: ${joined}`);
        assert.equal(joined.includes('4111'), false, `The body content reached the log: ${joined}`);
      },
    },

    {
      name: 'request-log-keeps-the-metadata',
      async run({ assert }) {
        const lines = await logLinesFor(SETTINGS);
        const request = lines.find((line) => line.startsWith('Request:'));

        assert.ok(request, `No request log line was emitted: ${lines.join('\n')}`);

        // Three recipients across to (2) and bcc (1) — the count, never the addresses.
        assert.ok(request.includes('recipients=3'), `Recipient count missing or wrong: ${request}`);
        assert.ok(request.includes('template=card'), `Template id missing: ${request}`);
        assert.ok(request.includes('subject=Your receipt'), `Subject missing: ${request}`);
      },
    },
  ],
});
