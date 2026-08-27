/**
 * Shared contact inference library
 *
 * Infers first/last name and company from an email address using AI.
 * Requires OMEGA_OPENAI_API_KEY to be set.
 *
 * Usage:
 *   const { inferContact } = require('./libraries/infer-contact.js');
 *   const result = await inferContact(email, ctx);
 *   // { firstName, lastName, company, confidence, method }
 */
const path = require('path');
const env = require('./env.js');

const PROMPT_PATH = path.join(__dirname, 'prompts', 'infer-contact.md');

/**
 * Infer contact info from email address using AI
 *
 * @param {string} email - Email address
 * @param {object} ctx - Assistant instance (for AI access)
 * @returns {{ firstName: string, lastName: string, company: string, confidence: number, method: string }}
 */
async function inferContact(email, ctx) {
  if (env.get('OMEGA_OPENAI_API_KEY')) {
    const aiResult = await inferContactWithAI(email, ctx);
    if (aiResult) {
      return aiResult;
    }
    ctx?.log(`inferContact: AI returned null for ${email} — falling back to empty result`);
  } else {
    ctx?.log(`inferContact: OMEGA_OPENAI_API_KEY not set — skipping AI inference for ${email}`);
  }

  return { firstName: '', lastName: '', company: '', confidence: 0, method: 'none' };
}

/**
 * Use AI to infer contact info from email
 *
 * @param {string} email - Email address
 * @param {object} ctx - Assistant instance
 * @returns {object|null} Inferred contact or null on failure
 */
async function inferContactWithAI(email, ctx) {
  try {
    const ai = ctx.Manager.AI(ctx, env.get('OMEGA_OPENAI_API_KEY'));
    const result = await ai.request({
      model: 'gpt-5.4-mini',
      timeout: 60000,
      maxTokens: 1024 * 2,
      moderate: false,
      response: 'json',
      prompt: {
        path: PROMPT_PATH,
      },
      message: {
        content: `Email: ${email}`,
      },
    });

    const parsed = result?.content;
    if (parsed?.firstName !== undefined) {
      const inferred = {
        firstName: capitalize(parsed.firstName || ''),
        lastName: capitalize(parsed.lastName || ''),
        company: capitalize(parsed.company || ''),
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        method: 'ai',
      };
      if (!inferred.firstName && !inferred.lastName && !inferred.company) {
        ctx?.log(`inferContactWithAI: AI parsed response had ALL fields empty for ${email}. Raw:`, parsed);
      }
      return inferred;
    }

    ctx?.log(`inferContactWithAI: AI response missing firstName for ${email}. Raw result:`, result);
  } catch (e) {
    ctx?.error('inferContactWithAI: Failed:', e);
  }

  return null;
}

/**
 * Capitalize first letter of each word
 *
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalize(str) {
  if (!str) {
    return '';
  }
  return str
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

module.exports = { inferContact, capitalize };
