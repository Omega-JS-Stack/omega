/**
 * Push identity test — the icon and click target of a push notification come from
 * the brand's own config, and a missing click target fails LOUDLY.
 *
 * The framework used to ship its author's company brandmark and homepage as the
 * hardcoded defaults, so any brand that had not configured its own would push a
 * lock-screen notification wearing another company's mark and linking to another
 * company's site. These checks pin the replacement: config-driven, omitted, or a
 * thrown error — never a substituted identity.
 *
 * Plain-node unit test (no emulator, no network).
 */
const assert = require('node:assert');
const { buildPayload } = require('../../dist/manager/libraries/notification.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// The identity the framework used to hardcode. Nothing may ever emit these again.
const FRAMEWORK_IDENTITY = /ITW Creative Works|itwcreativeworks/i;

const brand = {
  name: 'Acme',
  url: 'https://acme.example',
  images: { brandmark: 'https://acme.example/brandmark.png' },
};

const brandWithoutImages = { name: 'Acme', url: 'https://acme.example' };

module.exports = defineCases({
  description: 'Push notification identity (icon + click target come from config)',
  type: 'group',
  tests: [
    // ---------- Config-driven ----------

    {
      name: 'the icon is filled from brand.images.brandmark',

      run() {
        const payload = buildPayload(brand, { title: 'Hi', body: 'There' });

        assert.equal(payload.imageUrl, 'https://acme.example/brandmark.png');
      },
    },

    {
      name: 'the click target is filled from brand.url',

      run() {
        const payload = buildPayload(brand, { title: 'Hi', body: 'There' });

        assert.ok(
          payload.click_action.startsWith('https://acme.example/?cb='),
          `unexpected click_action: ${payload.click_action}`,
        );
      },
    },

    {
      name: 'explicit caller values still win over config',

      run() {
        const payload = buildPayload(brand, {
          title: 'Hi',
          body: 'There',
          icon: 'https://acme.example/campaign.png',
          clickAction: 'https://acme.example/sale',
        });

        assert.equal(payload.imageUrl, 'https://acme.example/campaign.png');
        assert.ok(payload.click_action.startsWith('https://acme.example/sale?cb='));
      },
    },

    // ---------- Absence: omit the decoration, refuse the destination ----------

    {
      name: 'an unconfigured icon is omitted, not substituted',

      run() {
        const payload = buildPayload(brandWithoutImages, { title: 'Hi', body: 'There' });

        assert.ok(
          !('imageUrl' in payload),
          `sent a stand-in mark: ${JSON.stringify(payload)}`,
        );
      },
    },

    {
      name: 'no click target anywhere throws',

      run() {
        assert.throws(
          () => buildPayload({ name: 'Acme' }, { title: 'Hi', body: 'There' }),
          (error) => /brand\.url/.test(error.message),
          'a missing click target must fail loudly',
        );
      },
    },

    {
      name: 'no brand at all throws',

      run() {
        // The message matcher keeps this red-capable: a missing/renamed buildPayload
        // would throw a TypeError here and still "throw", but not with this message.
        assert.throws(() => buildPayload(undefined, { title: 'Hi', body: 'There' }), /brand\.url/);
      },
    },

    {
      name: 'the loud failure never leaks the framework identity',

      run() {
        // The whole point: refuse, rather than point the push at someone else's site.
        let thrown;
        try {
          buildPayload({ name: 'Acme' }, { title: 'Hi', body: 'There' });
        } catch (error) {
          thrown = error;
        }

        assert.ok(thrown, 'expected a throw');
        assert.match(thrown.message, /brand\.url/, 'expected the config-hole refusal, not an unrelated error');
        assert.strictEqual(thrown.code, 400, 'a config hole is the caller\'s 400, never a code-less 500');
        assert.ok(!FRAMEWORK_IDENTITY.test(thrown.message), `error message leaked an identity: ${thrown.message}`);
      },
    },

    // ---------- The whole payload, unconfigured ----------

    {
      name: 'a fully unconfigured payload carries NO framework identity',

      run() {
        const payload = buildPayload(brandWithoutImages, { title: 'Hi', body: 'There' });

        assert.ok(
          !FRAMEWORK_IDENTITY.test(JSON.stringify(payload)),
          `payload leaked the framework identity: ${JSON.stringify(payload)}`,
        );
      },
    },

    {
      name: 'an invalid click target still fails loudly (unchanged)',

      run() {
        assert.throws(
          () => buildPayload(brand, { title: 'Hi', body: 'There', clickAction: 'not-a-url' }),
          /Invalid click_action URL/,
        );
      },
    },
  ],
});
