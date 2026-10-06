/**
 * Test: Single marketing campaign send
 * Verifies the full marketing pipeline end-to-end: prepare → render → audience → SendGrid Single Send.
 * Sends to test_admin segment only.
 */

const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');
module.exports = defineCases({
  description: 'Marketing campaign send',
  auth: 'admin',
  skip: !process.env.TEST_EXTENDED_MODE ? 'TEST_EXTENDED_MODE not set' : false,
  timeout: 60000,

  async run({ http, expect }) {
    const response = await http.post('omega/marketing/campaign', {
      name: '[TEST] Summer Sale — Free Users',
      subject: 'Summer Sale — {discount.percent}% Off Your First Month!',
      preheader: 'Limited time offer — upgrade to Premium today',
      template: 'card',
      data: {
        content: {
          title: 'Summer Sale!',
          message: [
            'You\'ve been using **{brand.name}** on our free plan — and we think you\'ll love what\'s on the other side.',
            '',
            'For a limited time, upgrade to Premium and get **{discount.percent}% off** your first month.',
            '',
            'Use code **{discount.code}** at checkout.',
          ].join('\n'),
          button: { text: 'Upgrade Now →', url: '{brand.url}/pricing' },
          discountCode: 'UPGRADE15',
        },
      },
      test: true,
      sendAt: 'now',
    });

    expect(response, 'Should create and schedule campaign').toBeSuccess();
    expect(response.data.id, 'Should have campaign ID').toBeTruthy();

    const sg = response.data?.providers?.campaigns;
    expect(sg, 'Should have campaigns result').toBeTruthy();
    expect(sg.success, 'Campaigns (SendGrid) should succeed').toBe(true);
    expect(sg.id, 'Should have Single Send ID').toBeTruthy();
    expect(sg.scheduled, 'Should be scheduled').toBe(true);
  },
});
