/**
 * Baseline knowledge for Chatsy chat agents — the shared knowledge every
 * brand agent gets, loaded from baseline-knowledge.md with the brand's
 * values filled in. Brand-specific knowledge from the brand repo's
 * config/chatsy.md is appended after this by the chat operation.
 *
 * Placeholders: {website} (brand.url), {description} (brand.description),
 * {pricing} (generated from payment.products), and {sponsorshipsUrl}
 * (inbound.chat.providers.chatsy.sponsorshipsUrl, default {website}/contact — omega-manager
 * hardcoded the company sponsorship page here).
 */
const { join } = require('node:path');
const fs = require('node:fs');

const BASELINE_KNOWLEDGE = fs.readFileSync(join(__dirname, '..', 'data', 'baseline-knowledge.md'), 'utf8').trimEnd();

/**
 * Format what a product promises as a human-readable string
 * ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)).
 *
 * A product's `features` map names only VALUES; the top-level `features`
 * catalog is what says what each id is CALLED, so the agent quotes the brand's
 * own words rather than a raw key. A `false` (or absent) value is not part of
 * the tier and is never mentioned.
 *
 * @param {Object} values - the product's `features` map, e.g. { requests: 100, support: true }
 * @param {Object} catalog - the top-level `features` catalog
 * @returns {string} - e.g., "100 API Requests, unlimited Saves, Priority support"
 */
function formatFeatures(values, catalog) {
  if (!values) {
    return '';
  }

  return Object.entries(values)
    .filter(([, value]) => value !== false && value !== '' && value !== undefined && value !== null)
    .map(([key, value]) => {
      const name = catalog?.[key]?.name || key;

      if (value === -1) {
        return `unlimited ${name}`;
      }
      if (value === true) {
        return name;
      }
      return `${value} ${name}`;
    })
    .join(', ');
}

/**
 * Format a product's prices as a human-readable string
 *
 * @param {Object} prices - e.g., { monthly: 9, annually: 90 }
 * @returns {string} - e.g., "$9/month or $90/year"
 */
function formatPrices(prices) {
  if (!prices) {
    return '';
  }

  const labels = {
    daily: 'day',
    weekly: 'week',
    monthly: 'month',
    annually: 'year',
    once: 'one-time',
  };

  return Object.entries(prices)
    .map(([interval, amount]) => `$${amount}/${labels[interval] || interval}`)
    .join(' or ');
}

/**
 * Generate the pricing section from payment.products config
 */
function generatePricing(brandConfig) {
  const products = brandConfig.payment?.products;

  if (!products || products.length === 0) {
    return '';
  }

  const lines = ['Pricing / plans:'];

  for (const product of products) {
    if (product.archived) {
      continue;
    }

    const parts = [`- ${product.name}`];

    if (product.prices && Object.keys(product.prices).length > 0) {
      parts.push(`(${formatPrices(product.prices)})`);
    } else {
      parts.push('(free)');
    }

    const features = formatFeatures(product.features, brandConfig.features);
    if (features) {
      parts.push(`- ${features}`);
    }

    if (product.trial?.days) {
      parts.push(`(${product.trial.days}-day free trial)`);
    }

    lines.push(parts.join(' '));
  }

  lines.push('- We offer a risk-free free trial of any paid plan. You can cancel any time during your free trial and you will not be charged.');
  lines.push(`- You can find more information at {website}/pricing`);

  return lines.join('\n');
}

/**
 * Get the baseline knowledge string with placeholders replaced
 *
 * @param {Object} brandConfig - The full brand config object
 * @returns {string} - Baseline knowledge with placeholders replaced
 */
function getBaselineKnowledge(brandConfig) {
  const websiteUrl = brandConfig.brand.url;
  const pricing = generatePricing(brandConfig);
  const description = brandConfig.brand.description || brandConfig.brand.name;
  const sponsorshipsUrl = brandConfig.inbound?.chat?.providers?.chatsy?.sponsorshipsUrl || `${websiteUrl}/contact`;

  return BASELINE_KNOWLEDGE
    .replace('{description}', description)
    .replace('{pricing}', pricing)
    .replace('{sponsorshipsUrl}', sponsorshipsUrl)
    .replaceAll('{website}', websiteUrl);
}

module.exports = { getBaselineKnowledge };
