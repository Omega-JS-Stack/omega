/**
 * Test: Single transactional email send
 * Verifies the full pipeline end-to-end: prepare → render → deliver via SendGrid.
 */

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Transactional email send',
  auth: 'admin',
  skip: !process.env.TEST_EXTENDED_MODE ? 'TEST_EXTENDED_MODE not set' : false,
  timeout: 30000,

  async run({ http, expect, config }) {
    const response = await http.post('omega/admin/email', {
      subject: '[TEST] Transactional pipeline — card template',
      to: `_test-email-send@${config.domain}`,
      template: 'card',
      sender: 'hello',
      copy: false,
      data: {
        content: {
          title: 'Pipeline Test',
          message: '# It works\n\nMarkdown → HTML → MJML → email.\n\n- **Bold** and *italic*\n- `Code` inline\n- A [link](https://example.com)',
        },
        signoff: { type: 'personal' },
      },
    });

    expect(response, 'Should send successfully').toBeSuccess();
    expect(response.data.status, 'Status should be sent').toBe('sent');
    expect(response.data.options.content?.[0]?.value?.includes('<html'), 'Should have rendered HTML').toBeTruthy();
    expect(response.data.options.content[0].value.includes('It works'), 'Markdown should be rendered').toBeTruthy();
    expect(response.data.options.asm, 'Should have ASM group').toBeTruthy();
    expect(response.data.options.headers['List-Unsubscribe'], 'Should have unsubscribe header').toBeTruthy();
  },
});
