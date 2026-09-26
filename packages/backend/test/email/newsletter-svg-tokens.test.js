/**
 * Test: newsletter SVG illustrator token accounting
 * (libraries/email/generators/lib/svg-illustrator.js)
 *
 * The illustrator retries once when a model returns no usable <svg>. Under
 * per-call token semantics every attempt reports only ITS OWN usage, so the
 * section meta has to accumulate the attempts — keeping just the last one hid a
 * discarded attempt's cost from the newsletter's aggregateTotals.
 *
 * Driven by the real `test` AI provider (directives scripted into the image
 * prompt), so the retry loop runs for real with no paid API call and no mock,
 * on a Context of a REAL Omega instance booted from the bundled fixture, so the
 * file runs with or without an emulator.
 */
const { generateSectionImage } = require('../../dist/omega/libraries/email/generators/lib/svg-illustrator.js');
const Context = require('../../dist/omega/context.js');
const { bootOmega } = require('../helpers/_boot-omega.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// Scripted reply with no <svg> in it, so BOTH attempts of the retry loop run
// and the placeholder illustration is what comes back
const NO_SVG_PROMPT = '[[reply:a description, not markup]]';

const NEWSLETTER_CONFIG = { provider: { svg: 'test' }, model: { svg: 'test' } };
const BRAND = { name: 'OMEGA Playground', color: { primary: '#5B5BFF', secondary: '#1E1E2A' } };

module.exports = defineCases({
  description: 'Newsletter SVG illustrator (retry token accounting)',
  type: 'group',
  tests: [
    {
      name: 'svg-retry-attempts-accumulate-into-the-section-tokens',
      async run({ assert }) {
        const ctx = new Context(bootOmega());
        const ai = ctx.ai;

        const result = await generateSectionImage({
          imagePrompt: NO_SVG_PROMPT,
          brand: BRAND,
          newsletterConfig: NEWSLETTER_CONFIG,
          ai: ai,
          ctx: ctx,
        });

        assert.equal(result.meta.attempts, 2, 'both attempts ran');
        assert.equal(result.fallback, true, 'no usable svg, placeholder illustration used');
        assert.equal(result.meta.tokens.total.count > 0, true, 'usage accounted');
        assert.deepEqual(
          result.meta.tokens,
          ai.tokens,
          'section meta carries every attempt the AI instance spent, not just the last',
        );
      },
    },
  ],
});
