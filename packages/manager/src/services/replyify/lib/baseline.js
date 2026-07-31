/**
 * Baseline templates for Replyify agents — the shared support knowledge and
 * the baseline Gmail filter every brand agent gets, loaded from data/ with
 * the brand's values filled in via the manager's templateObject (flat
 * `{ brand.url }` / `{ domain }` placeholders).
 *
 * De-ITW'd from omega-manager's baseline: the company sponsorship business
 * block (guest-post rules, the company sponsorship URL, its promo code) is
 * GONE from the packaged template — company business prose belongs in the
 * brand/company config/replyify.md that gets appended to the baseline. The
 * discount section only renders when `inbound.email.providers.replyify.discount` is configured
 * (omega-manager hardcoded the company's GIFT15 code for every brand); with
 * no code configured the section is omitted entirely so agents can never
 * invent one.
 */
const { join } = require('node:path');
const fs = require('node:fs');
const { templateObject } = require('../../../config.js');

const BASELINE_KNOWLEDGE = fs.readFileSync(join(__dirname, '..', 'data', 'baseline-knowledge.md'), 'utf8').trimEnd();
const BASELINE_FILTER = fs.readFileSync(join(__dirname, '..', 'data', 'baseline-filter.md'), 'utf8').trimEnd();

// Spliced into baseline-knowledge.md's {discountSection} slot only when
// inbound.email.providers.replyify.discount carries a code
const DISCOUNT_SECTION = `  <discount followup="0">
    <reasoning>
      - DO NOT offer or mention a discount proactively. Only provide a code if the user SPECIFICALLY asks for one (e.g. they reply asking for a deal, a promo code, or a way to save).
      - Provide the code warmly and only ONCE per conversation. DO NOT repeat the code if you have already shared it.
      - DO NOT invent or guess a code. Only ever share the exact code below.
    </reasoning>
    <facts>
      - Discount code: { discount.code } ({ discount.label }).
      - Users redeem the code at checkout when subscribing at { brand.url }/pricing?utm_source=replyify&utm_medium=customer_support&utm_campaign=discount_code
    </facts>
  </discount>`;

/**
 * Build the flat placeholder context templateObject resolves against.
 * Discount keys join only when configured — templateObject would stringify
 * an undefined value.
 */
function templateContext(brandConfig, domain) {
  const discount = brandConfig.inbound?.email?.providers?.replyify?.discount;

  return {
    'brand.name': brandConfig.brand.name,
    'brand.url': brandConfig.brand.url,
    domain,
    ...(discount?.code ? { 'discount.code': discount.code, 'discount.label': discount.label || '' } : {}),
  };
}

/**
 * Get the baseline knowledge with placeholders replaced and the discount
 * section rendered only when inbound.email.providers.replyify.discount is configured.
 *
 * @param {Object} brandConfig - The full brand config object
 * @param {string} domain - Brand domain (e.g. "fixture-brand.test")
 * @returns {string}
 */
function getBaselineKnowledge(brandConfig, domain) {
  const discount = brandConfig.inbound?.email?.providers?.replyify?.discount;
  const withDiscount = BASELINE_KNOWLEDGE.replace(
    '{discountSection}',
    discount?.code ? `\n${DISCOUNT_SECTION}\n` : '',
  );

  return templateObject(withDiscount, templateContext(brandConfig, domain));
}

/**
 * Get the baseline Gmail filter with the brand's domain filled in.
 *
 * @param {Object} brandConfig - The full brand config object
 * @param {string} domain - Brand domain
 * @returns {string}
 */
function getBaselineFilter(brandConfig, domain) {
  return templateObject(BASELINE_FILTER, templateContext(brandConfig, domain));
}

module.exports = { getBaselineKnowledge, getBaselineFilter };
