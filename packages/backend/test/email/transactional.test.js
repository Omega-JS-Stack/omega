/**
 * Test: Email library (libraries/email.js)
 * Library-level tests: validation edge cases, recipient formats, deduplication, features
 *
 * These tests exercise the email library through the admin/email route to get a real
 * SendGrid integration. Route-level tests (auth, permissions) are in test/routes/admin/email.js.
 */

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Email library',
  type: 'group',
  skip: !process.env.TEST_EXTENDED_MODE ? 'TEST_EXTENDED_MODE env var not set (skipping email tests)' : false,
  tests: [
    // --- Validation / Rejection ---

    {
      name: 'empty-to-array-rejected',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - Empty To',
          to: [],
          copy: false,
        });

        expect(response, 'Empty to array should return 400').toBeError(400);
      },
    },

    {
      name: 'object-recipient-without-email-rejected',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - Bad Object',
          to: [{ name: 'No Email' }],
          copy: false,
        });

        expect(response, 'Object without email should return 400').toBeError(400);
      },
    },

    {
      name: 'default-template-used-when-omitted',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - Default Template',
          to: [{ email: `_test-receiver@${config.domain}` }],
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - Default Template',
            },
            content: {
              message: 'Testing that default template is used when not specified.',
            },
          },
        });

        expect(response, 'Should succeed with default template').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
        expect(response.data.options.content?.[0]?.value?.includes('<html'), 'Should have rendered HTML content (MJML pipeline)').toBeTruthy();
      },
    },

    {
      name: 'nonexistent-uid-rejected',
      auth: 'admin',
      timeout: 15000,

      async run({ http, expect }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - Bad UID',
          to: 'nonexistent_uid_12345',
          copy: false,
        });

        expect(response, 'Nonexistent UID should return 400').toBeError(400);
      },
    },

    // --- Subject Fallback ---

    {
      name: 'subject-from-data-fallback',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/email', {
          to: [{ email: `_test-receiver@${config.domain}` }],
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - Fallback Subject',
            },
            content: {
              message: 'Testing subject fallback from data.email.subject.',
            },
          },
        });

        expect(response, 'Should use subject from data.email.subject').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
      },
    },

    // --- Recipient Formats ---

    {
      name: 'string-email-recipient',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - String Email',
          to: `_test-receiver@${config.domain}`,
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - String Email',
            },
            content: {
              message: 'Testing string email format.',
            },
          },
        });

        expect(response, 'Should send email to string address').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
      },
    },

    {
      name: 'uid-recipient',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, accounts }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - UID Recipient',
          to: accounts.admin.uid,
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - UID Recipient',
            },
            content: {
              message: 'Testing UID resolution.',
            },
          },
        });

        expect(response, 'Should send email to UID').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
      },
    },

    {
      name: 'mixed-recipients',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, accounts, config }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - Mixed Recipients',
          to: [
            `_test-receiver@${config.domain}`,
            { email: `_test-receiver-2@${config.domain}`, name: 'Receiver 2' },
            accounts.admin.uid,
          ],
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - Mixed Recipients',
            },
            content: {
              message: 'Testing mixed recipient formats.',
            },
          },
        });

        expect(response, 'Should send email to mixed recipients').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
      },
    },

    {
      name: 'object-recipient-with-name',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - Object Recipient',
          to: { email: `_test-receiver@${config.domain}`, name: 'Named Recipient' },
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - Object Recipient',
            },
            content: {
              message: 'Testing single object recipient with name.',
            },
          },
        });

        expect(response, 'Should send email to object recipient').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
      },
    },

    {
      name: 'cc-bcc-recipients-accepted',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - CC/BCC',
          to: `_test-receiver@${config.domain}`,
          cc: `_test-cc@${config.domain}`,
          bcc: { email: `_test-bcc@${config.domain}`, name: 'BCC Receiver' },
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - CC/BCC',
            },
            content: {
              message: 'Testing cc and bcc recipients.',
            },
          },
        });

        expect(response, 'Should send email with cc and bcc').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
      },
    },

    // --- Deduplication ---

    {
      name: 'dedup-same-email-in-to',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const email = `_test-dedup@${config.domain}`;

        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - Dedup To',
          to: [email, email],
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - Dedup To',
            },
            content: {
              message: 'Testing deduplication of same email in to.',
            },
          },
        });

        expect(response, 'Should send despite duplicate to').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
        expect(response.data.options.to.length, 'Duplicate should be removed from to').toBe(1);
      },
    },

    {
      name: 'dedup-to-removes-from-cc',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const email = `_test-dedup-cc@${config.domain}`;

        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - Dedup CC',
          to: email,
          cc: email,
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - Dedup CC',
            },
            content: {
              message: 'Testing cross-list dedup (to removes from cc).',
            },
          },
        });

        expect(response, 'Should send despite duplicate in cc').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
        expect(response.data.options.cc.length, 'Email in to should be removed from cc').toBe(0);
      },
    },

    {
      name: 'dedup-case-insensitive',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - Case Dedup',
          to: [`_TEST-DEDUP@${config.domain}`, `_test-dedup@${config.domain}`],
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - Case Dedup',
            },
            content: {
              message: 'Testing case-insensitive deduplication.',
            },
          },
        });

        expect(response, 'Should send despite case-different duplicates').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
        expect(response.data.options.to.length, 'Case-insensitive duplicate should be removed').toBe(1);
      },
    },

    // --- Features ---

    {
      name: 'copy-false-no-carbon-copies',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - No Copy',
          to: `_test-receiver@${config.domain}`,
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - No Copy',
            },
            content: {
              message: 'Testing that copy:false produces no cc/bcc.',
            },
          },
        });

        expect(response, 'Should send email without carbon copies').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
        expect(response.data.options.cc.length, 'cc should be empty with copy:false').toBe(0);
        expect(response.data.options.bcc.length, 'bcc should be empty with copy:false').toBe(0);
      },
    },

    {
      name: 'html-override-replaces-template',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - HTML Override',
          to: `_test-receiver@${config.domain}`,
          html: '<p>This is raw HTML content.</p>',
          copy: false,
        });

        expect(response, 'Should send email with HTML override').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
        expect(response.data.options.content?.[0]?.value?.includes('raw HTML content'), 'HTML override should be in content').toBeTruthy();
      },
    },

    {
      name: 'svg-images-converted-to-png',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - SVG to PNG',
          to: `_test-receiver@${config.domain}`,
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - SVG to PNG',
            },
            content: {
              message: 'Testing that SVG images are converted to PNG for email.',
            },
          },
        });

        expect(response, 'Should send email').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');

        // The rendered HTML should not contain any SVG image URLs
        const html = response.data.options.content?.[0]?.value || '';
        expect(!html.includes('-x.svg'), 'Rendered HTML should not contain SVG image URLs (sanitized to PNG)').toBeTruthy();
      },
    },

    // --- Sender Resolution ---

    {
      name: 'sender-orders-resolves-from-and-asm',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - Sender Orders',
          to: `_test-receiver@${config.domain}`,
          sender: 'orders',
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - Sender Orders',
            },
            content: {
              message: 'Testing sender resolution for orders.',
            },
          },
        });

        expect(response, 'Should send email with orders sender').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
        expect(response.data.options.from.email.startsWith('orders@'), 'From email should start with orders@').toBeTruthy();
        expect(response.data.options.from.name.includes('Orders'), 'From name should include Orders').toBeTruthy();
        expect(response.data.options.asm, 'Should have ASM group').toBeTruthy();
        expect(response.data.options.replyTo.startsWith('orders@'), 'replyTo should match from address').toBeTruthy();
      },
    },

    {
      name: 'sender-security-resolves-from-asm-and-unsubscribe',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - Sender Security',
          to: `_test-receiver@${config.domain}`,
          sender: 'security',
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - Sender Security',
            },
            content: {
              message: 'Testing that security sender resolves correctly.',
            },
          },
        });

        expect(response, 'Should send email with security sender').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
        expect(response.data.options.from.email.startsWith('security@'), 'From email should start with security@').toBeTruthy();
        expect(response.data.options.asm, 'Should have ASM group').toBeTruthy();
        expect(response.data.options.headers['List-Unsubscribe'], 'Should have List-Unsubscribe header').toBeTruthy();
      },
    },

    {
      name: 'sender-explicit-from-overrides-sender',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const customFrom = { email: `custom@${config.domain}`, name: 'Custom Sender' };

        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - From Override',
          to: `_test-receiver@${config.domain}`,
          sender: 'orders',
          from: customFrom,
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - From Override',
            },
            content: {
              message: 'Testing that explicit from overrides sender.',
            },
          },
        });

        expect(response, 'Should send email with explicit from').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
        expect(response.data.options.from.email, 'Explicit from should override sender').toBe(customFrom.email);
        expect(response.data.options.from.name, 'Explicit from name should override sender').toBe(customFrom.name);
      },
    },

    {
      name: 'sender-unknown-falls-back-to-defaults',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - Unknown Sender',
          to: `_test-receiver@${config.domain}`,
          sender: 'nonexistent',
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - Unknown Sender',
            },
            content: {
              message: 'Testing that unknown sender falls back to brand defaults.',
            },
          },
        });

        expect(response, 'Should send email with default from').toBeSuccess();
        expect(response.data.status, 'Status should be sent').toBe('sent');
        expect(response.data.options.from.email, 'Should have a from email (brand default)').toBeTruthy();
        expect(response.data.options.asm, 'Should have default ASM group').toBeTruthy();
      },
    },

    {
      name: 'sendat-iso-string-accepted',
      auth: 'admin',
      timeout: 30000,

      async run({ http, expect, config }) {
        // Use a time 1 hour from now (well within the 71h limit)
        const sendAtDate = new Date(Date.now() + (60 * 60 * 1000)).toISOString();

        const response = await http.post('omega/admin/email', {
          subject: '@omega.js/backend Test Email - ISO SendAt',
          to: `_test-receiver@${config.domain}`,
          sendAt: sendAtDate,
          copy: false,
          data: {
            email: {
              subject: '@omega.js/backend Test Email - ISO SendAt',
            },
            content: {
              message: 'Testing ISO string sendAt.',
            },
          },
        });

        expect(response, 'Should send email with ISO sendAt').toBeSuccess();
        expect(response.data.status, 'Status should be sent (within 71h)').toBe('sent');
        expect(response.data.options.sendAt, 'sendAt should be normalized to unix timestamp').toBeTypeOf('number');
      },
    },
  ],
});
