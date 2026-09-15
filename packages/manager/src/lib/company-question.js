/**
 * The ONE company question ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)).
 *
 * Joining a company is a single field, so it is asked in exactly one wording,
 * validated by exactly one rule, wherever it comes up: the onboard wizard for
 * a fresh brand, and the manage walk's workspace service for a brand that
 * carries no `company` key yet. A blank answer is the standalone brand — it
 * writes nothing, and the next run asks again.
 */

const { input } = require('@omega.js/devkit/prompt');
const { COMPANY_SELF } = require('@omega.js/config');

// The id a company is named by is the PARENT's own `brand.id`, so it follows
// the same conservative subset the onboard wizard accepts for a new brand id.
const COMPANY_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const COMPANY_ID_HINT = 'lowercase letters, numbers, dashes; starts with a letter';

const COMPANY_QUESTION = `Company brand id (the parent brand's id, "${COMPANY_SELF}" if this brand is the company, blank for none):`;

/**
 * The answer rule: a brand id, the literal `self`, or blank.
 *
 * @param {string} value - The raw answer.
 * @returns {true|string} True, or the message telling the owner what is valid.
 */
function validateCompanyId(value) {
  const answer = String(value).trim();

  return !answer || answer === COMPANY_SELF || COMPANY_ID_PATTERN.test(answer)
    ? true
    : `Must be a brand id (${COMPANY_ID_HINT}), "${COMPANY_SELF}", or blank`;
}

/**
 * Ask it. Callers gate on interactivity themselves (canPrompt) — this is the
 * question, not the decision to ask it.
 *
 * @param {object} [deps] - Test seam: `{ input }` overrides devkit/prompt's.
 * @returns {Promise<string>} The trimmed answer ('' = standalone).
 */
async function askCompanyId(deps = {}) {
  const ask = deps.input || input;

  return (await ask({ message: COMPANY_QUESTION, validate: validateCompanyId })).trim();
}

module.exports = { askCompanyId, validateCompanyId, COMPANY_QUESTION };
