/**
 * Test: Email template rendering (campaign/transactional templates)
 *
 * Pure rendering tests — no network, no Firebase, no SendGrid.
 * Verifies the prepare → render pipeline for card, plain, order, feedback templates.
 */
const { renderEmail } = require('../../src/manager/libraries/email/generators/lib/mjml-template.js');
const { resolveEmailTemplate: resolveTemplate } = require('../../src/manager/libraries/email/generators/lib/templates/index.js');

const TEST_BRAND = {
  id: 'testco',
  name: 'TestCo',
  // Deliberately different from brand.name so the footer assertions prove the parent
  // identity is read from config rather than defaulted.
  company: 'TestCo Holdings Inc',
  url: 'https://testco.example',
  contact: { email: 'hello@testco.example' },
  images: {
    brandmark: 'https://cdn.example.com/brandmark-1024.png',
    companyWordmark: 'https://cdn.example.com/company-wordmark.png',
  },
  address: {
    line1: '123 Main St',
    city: 'Testville',
    region: 'TS',
    postalCode: '12345',
  },
};

const TEMPLATES = ['card', 'plain', 'order', 'feedback'];

async function render(templateName, dataOverrides = {}) {
  const data = {
    brand: TEST_BRAND,
    content: {
      title: 'Test Title',
      message: '<p>Hello <strong>world</strong></p>',
    },
    email: {
      subject: 'Test Subject',
      preview: 'Preview text',
      unsubscribeUrl: 'https://testco.example/portal/email-preferences',
    },
    signoff: { type: 'team' },
    ...dataOverrides,
  };

  return renderEmail({ brand: TEST_BRAND, template: templateName, data });
}

module.exports = {
  description: 'Email template rendering (card, plain, order, feedback)',
  type: 'suite',
  auth: 'none',
  timeout: 30000,
  tests: [
    {
      name: 'every registered template resolves and has build()',
      async run({ assert }) {
        for (const name of TEMPLATES) {
          const t = resolveTemplate(name);
          assert.ok(t, `Template "${name}" should resolve`);
          assert.ok(typeof t.build === 'function', `Template "${name}" should expose build()`);
          assert.ok(t.meta?.name, `Template "${name}" should expose meta.name`);
        }
      },
    },

    {
      name: 'every template renders valid HTML without MJML errors',
      async run({ assert }) {
        for (const name of TEMPLATES) {
          const result = await render(name);
          assert.ok(result.html.includes('<html'), `${name}: produces HTML`);
          assert.equal(result.template, name, `${name}: reports correct template name`);
          // plain uses width="100%" which MJML warns about (expected — it bypasses the 600px default)
          if (name !== 'plain') {
            assert.equal(result.errors.length, 0, `${name}: no MJML errors`);
          }
        }
      },
    },

    {
      name: 'card template renders brand, title, message, signoff, and footer',
      async run({ assert }) {
        const result = await render('card');

        assert.ok(result.html.includes('TestCo'), 'card: brand name renders');
        assert.ok(result.html.includes('Test Title'), 'card: title renders');
        assert.ok(result.html.includes('Hello <strong>world</strong>'), 'card: HTML message preserved');
        assert.ok(result.html.includes('Sincerely'), 'card: team signoff renders');
        assert.ok(result.html.includes('TestCo Holdings Inc'), 'card: configured parent company renders');
        assert.ok(result.html.includes('company-wordmark.png'), 'card: configured company wordmark renders');
        assert.ok(result.html.includes('123 Main St'), 'card: address renders');
      },
    },

    {
      name: 'card template renders personal signoff with image and link',
      async run({ assert }) {
        const result = await render('card', {
          signoff: {
            type: 'personal',
            name: 'Jane Doe',
            image: 'https://example.com/headshot.jpg',
            url: 'https://example.com',
            urlText: '@janedoe',
          },
        });

        assert.ok(result.html.includes('Jane Doe'), 'card: personal signoff name renders');
        assert.ok(result.html.includes('Warm regards'), 'card: personal signoff greeting renders');
        assert.ok(result.html.includes('headshot.jpg'), 'card: personal signoff image renders');
        assert.ok(result.html.includes('@janedoe'), 'card: personal signoff link text renders');
      },
    },

    {
      name: 'card template renders CTA button when provided',
      async run({ assert }) {
        const result = await render('card', {
          content: {
            title: 'Test',
            message: '<p>Click below</p>',
            button: { url: 'https://testco.example/action', text: 'Get Started' },
          },
        });

        assert.ok(result.html.includes('Get Started'), 'card: button text renders');
        assert.ok(result.html.includes('testco.example/action'), 'card: button URL renders');
      },
    },

    {
      name: 'card template includes hidden ASM tags for SendGrid',
      async run({ assert }) {
        const result = await render('card');

        assert.ok(
          result.html.includes('asm_group_unsubscribe_raw_url'),
          'card: hidden ASM unsubscribe tag present',
        );
        assert.ok(
          result.html.includes('asm_preferences_raw_url'),
          'card: hidden ASM preferences tag present',
        );
      },
    },

    {
      name: 'plain template renders without card wrapper',
      async run({ assert }) {
        const result = await render('plain');

        assert.ok(result.html.includes('TestCo'), 'plain: brand name renders');
        assert.ok(result.html.includes('Hello <strong>world</strong>'), 'plain: message renders');
      },
    },

    {
      name: 'order template renders order summary when data provided',
      async run({ assert }) {
        const result = await render('order', {
          content: {
            event: 'confirmation',
            id: 'ORD-12345',
            type: 'subscription',
            unified: {
              product: { id: 'premium', name: 'Premium' },
              payment: { price: 9.99, frequency: 'monthly' },
            },
            _computed: { totalToday: '9.99' },
          },
        });

        assert.ok(result.html.includes('ORD-12345'), 'order: order ID renders');
        assert.ok(result.html.includes('9.99'), 'order: price renders');
      },
    },

    {
      name: 'order template names the PRODUCT on a one-time receipt',
      async run({ assert }) {
        // A one-time row was labelled `Order #<id>` — the id the header already
        // prints above it — so the receipt for a $49.99 purchase named the
        // product nowhere at all
        // ([#668](https://github.com/Omega-JS-Stack/omega/issues/668)).
        const result = await render('order', {
          content: {
            event: 'confirmation',
            id: 'ORD-ONETIME',
            type: 'one-time',
            unified: {
              product: { id: 'launch-kit', name: 'Starter Library' },
              payment: { price: 49.99 },
            },
            _computed: { totalToday: '49.99' },
          },
        });

        assert.ok(result.html.includes('Starter Library'), 'order: a one-time receipt names what was bought');
        assert.ok(result.html.includes('One-time purchase'), 'order: and says nothing renews, where a subscription names its cadence');
        assert.ok(!result.html.includes('Billed'), 'order: a one-time buy is billed on no cadence');
        assert.ok(result.html.includes('49.99'), 'order: the price still renders');
        assert.ok(result.html.includes('ORD-ONETIME'), 'order: and the order id still rides the header');
      },
    },

    {
      name: 'order template renders a percent promo line',
      async run({ assert }) {
        const result = await render('order', {
          content: {
            event: 'confirmation',
            id: 'ORD-PERCENT',
            type: 'subscription',
            unified: {
              product: { id: 'premium', name: 'Premium' },
              payment: { price: 49.99, frequency: 'monthly' },
            },
            _computed: { promoCode: 'WELCOME15', promoPercent: 15, promoSavings: '7.50', totalToday: '42.49' },
          },
        });

        assert.ok(result.html.includes('WELCOME15'), 'order: the redeemed code renders');
        assert.ok(result.html.includes('15% off'), 'order: a percent code reads as "15% off"');
        assert.ok(result.html.includes('7.50'), 'order: the savings render');
      },
    },

    {
      name: 'order template renders an amount promo line as money, not a percent',
      async run({ assert }) {
        // A flat-dollar code has no percent to quote — the line used to render
        // "undefined% off" for one ([#239](https://github.com/Omega-JS-Stack/omega/issues/239))
        const result = await render('order', {
          content: {
            event: 'confirmation',
            id: 'ORD-AMOUNT',
            type: 'subscription',
            unified: {
              product: { id: 'premium', name: 'Premium' },
              payment: { price: 49.99, frequency: 'monthly' },
            },
            _computed: { promoCode: 'WELCOME10OFF', promoAmount: '10.00', promoSavings: '10.00', totalToday: '39.99' },
          },
        });

        assert.ok(result.html.includes('WELCOME10OFF'), 'order: the redeemed code renders');
        assert.ok(result.html.includes('$10.00 off'), 'order: an amount code reads as "$10.00 off", formatted like every other amount');
        assert.ok(!result.html.includes('% off'), 'order: an amount code never quotes a percentage');
        assert.ok(!result.html.includes('undefined'), 'order: nothing renders as undefined');
      },
    },

    {
      name: 'feedback template renders',
      async run({ assert }) {
        const result = await render('feedback');

        assert.ok(result.html.includes('<html'), 'feedback: produces valid HTML');
        assert.ok(result.html.includes('TestCo'), 'feedback: brand name renders');
      },
    },

    {
      name: 'direct template names resolve correctly',
      async run({ assert }) {
        const names = { card: 'card', plain: 'plain', order: 'order', feedback: 'feedback' };

        for (const [name, expected] of Object.entries(names)) {
          const t = resolveTemplate(name);
          assert.equal(t.meta.name, expected, `Template "${name}" should resolve`);
        }
      },
    },

    {
      name: 'unknown template falls back to card',
      async run({ assert }) {
        const t = resolveTemplate('nonexistent-template');
        assert.equal(t.meta.name, 'card', 'Unknown template should fall back to card');
      },
    },
  ],
};
