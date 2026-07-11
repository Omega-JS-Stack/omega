/**
 * The translation engine — one provider-agnostic protocol for translating a
 * batch of strings: JSON array in → same-length JSON array out, with a control
 * sentinel appended to every batch to prove alignment, automatic batching,
 * and validation retries. Frameworks feed it strings (page text nodes,
 * extension messages) and get positionally-aligned translations back.
 */

// Alignment sentinel — appended to every batch, must return unchanged
const CONTROL = 'OMEGA-TRANSLATION-CONTROL';

const BATCH_SIZE = 25;
const MAX_RETRIES = 2;

const SYSTEM_PROMPT = `<role>
Professional translator. Return ONLY a valid JSON array — no commentary, no markdown fences, no wrapping.
</role>

<task>
Translate the input JSON array of strings into the target language.
The output array MUST have the EXACT same length as the input array.
</task>

<rules>
- Input: a JSON array of strings. Output: a JSON array of translated strings of the SAME length.
- DO NOT add, remove, merge, or reorder elements.
- Consider adjacent strings for context — they come from the same document.
- Preserve leading and trailing whitespace in each string.
- Keep HTML tags, attributes, URLs, and email addresses verbatim — never translate them.
- Preserve placeholder tokens exactly (e.g. $1, $2, %s, {name}, {{ value }}).
- Keep brand names, product names, and company names in their original language.
- Never translate the brand name "{brand}".
- The control string "${CONTROL}" must be returned unchanged at its exact position.
{extraRules}
</rules>

<example lang="es">
Input: ["Welcome to {brand}", "Get started today", "${CONTROL}"]
Output: ["Bienvenido a {brand}", "Comienza hoy", "${CONTROL}"]
</example>`;

/**
 * Parse the provider's response into a JSON array (strips accidental fences).
 * @param {string} text - raw provider response
 * @returns {Array} parsed array
 */
function parseArrayResponse(text) {
  const cleaned = (text || '').trim().replace(/^```json?\n?|\n?```$/g, '');
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    throw new Error(`translation result is not an array (got ${typeof parsed})`);
  }

  return parsed;
}

/**
 * Re-apply the original string's leading/trailing whitespace to a translation
 * (models trim despite instructions; surrounding markup relies on it).
 * @param {string} original - source string
 * @param {string} translated - translated string
 * @returns {string}
 */
function preserveWhitespace(original, translated) {
  const leading = original.match(/^\s*/)[0];
  const trailing = original.match(/\s*$/)[0];

  return `${leading}${String(translated).trim()}${trailing}`;
}

/**
 * Translate one batch (with the control sentinel and validation retries).
 * @param {object} ctx - { send, system, language, languageName }
 * @param {string[]} batch - strings to translate
 * @param {number} attempt - current attempt (0-based)
 * @returns {Promise<{ result: string[], usage: object }>}
 */
async function translateBatch(ctx, batch, attempt) {
  const payload = [...batch, CONTROL];
  const user = `Target language: ${ctx.language} (${ctx.languageName})\nArray length: ${payload.length}\n\n${JSON.stringify(payload)}`;

  const { text, usage } = await ctx.send({ system: ctx.system, user });

  try {
    const parsed = parseArrayResponse(text);

    if (parsed.length !== payload.length) {
      throw new Error(`length mismatch: expected ${payload.length}, got ${parsed.length}`);
    }

    if (parsed[parsed.length - 1] !== CONTROL) {
      throw new Error('control sentinel missing or altered at the last position');
    }

    return { result: parsed.slice(0, -1), usage };
  } catch (e) {
    if (attempt < MAX_RETRIES) {
      return translateBatch(ctx, batch, attempt + 1);
    }

    throw new Error(`translation failed after ${MAX_RETRIES + 1} attempts: ${e.message}`);
  }
}

/**
 * Translate an array of strings, batching + validating along the way.
 * @param {object} options
 * @param {string[]} options.strings - source strings
 * @param {string} options.language - target language code (e.g. 'es')
 * @param {string} options.languageName - English name of the target language
 * @param {Function} options.send - provider send ({ system, user }) → { text, usage }
 * @param {string} [options.brand] - brand name to keep untranslated
 * @param {string} [options.extraRules] - extra rule lines for the system prompt
 * @returns {Promise<{ result: string[], usage: { input: number, output: number } }>}
 *   result is positionally aligned with options.strings, original whitespace preserved
 */
async function translateStrings(options) {
  const { strings, language, languageName, send, brand, extraRules } = options;

  if (!strings.length) {
    return { result: [], usage: { input: 0, output: 0 } };
  }

  const system = SYSTEM_PROMPT
    .split('{brand}').join(brand || 'the brand')
    .replace('{extraRules}', extraRules ? `${extraRules.trim()}\n` : '');

  const ctx = { send, system, language, languageName };
  const result = [];
  const usage = { input: 0, output: 0 };

  for (let i = 0; i < strings.length; i += BATCH_SIZE) {
    const batch = strings.slice(i, i + BATCH_SIZE);
    const outcome = await translateBatch(ctx, batch, 0);

    result.push(...outcome.result.map((translated, j) => preserveWhitespace(batch[j], translated)));
    usage.input += outcome.usage?.input || 0;
    usage.output += outcome.usage?.output || 0;
  }

  return { result, usage };
}

module.exports = { translateStrings, preserveWhitespace, CONTROL, BATCH_SIZE };
