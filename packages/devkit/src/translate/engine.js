/**
 * The translation engine — one provider-agnostic protocol for translating a
 * batch of strings: JSON array in → same-length JSON array out, with a control
 * sentinel appended to every batch to prove alignment, automatic batching,
 * validation retries, and a HALVING re-ask for a batch the model keeps
 * collapsing. Frameworks feed it strings (page text nodes, extension messages)
 * and get positionally-aligned translations back.
 */

// Alignment sentinel — appended to every batch, must return unchanged
const CONTROL = 'OMEGA-TRANSLATION-CONTROL';

const BATCH_SIZE = 25;
const MAX_RETRIES = 2;

// How many batches are in flight at once (#604). A batch is one model call and
// the model's latency dominates it, so a serial pass paid that latency once per
// 25 strings — a language took minutes it never needed to. Raise it only as far
// as the providers' rate limits allow.
const CONCURRENCY = 5;

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
 * An alignment failure — the batch came back, but not one-for-one. Marked so
 * the caller can tell it from a provider that never answered at all.
 * @param {string} message
 * @returns {Error}
 */
function alignmentError(message) {
  const error = new Error(message);
  error.alignment = true;
  return error;
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
      throw alignmentError(`length mismatch: expected ${payload.length}, got ${parsed.length}`);
    }

    if (parsed[parsed.length - 1] !== CONTROL) {
      throw alignmentError('control sentinel missing or altered at the last position');
    }

    return { result: parsed.slice(0, -1), usage };
  } catch (e) {
    if (attempt < MAX_RETRIES) {
      return translateBatch(ctx, batch, attempt + 1);
    }

    // A batch a model MERGES is deterministic (#523): the playground's
    // ship-the-docs page came back 25-for-26 on all six attempts, in two
    // languages — re-asking the same array can only fail the same way. Halving
    // it separates whatever pair collapsed, and each half is asked in full,
    // so nothing is guessed at and the page stops shipping untranslated.
    if (e.alignment && batch.length > 1) {
      return splitBatch(ctx, batch);
    }

    throw new Error(`translation failed after ${MAX_RETRIES + 1} attempts: ${e.message}`);
  }
}

/**
 * Re-ask a collapsing batch in halves, bottoming out at one string (a single
 * string plus the sentinel is unambiguous — a provider that still drops it is
 * broken, and the caller skips the page-language pair whole).
 * @param {object} ctx - { send, system, language, languageName }
 * @param {string[]} batch - the batch that would not come back aligned
 * @returns {Promise<{ result: string[], usage: object }>}
 */
async function splitBatch(ctx, batch) {
  const middle = Math.ceil(batch.length / 2);
  const result = [];
  const usage = { input: 0, output: 0 };

  for (const half of [batch.slice(0, middle), batch.slice(middle)]) {
    const outcome = await translateBatch(ctx, half, 0);
    result.push(...outcome.result);
    usage.input += outcome.usage?.input || 0;
    usage.output += outcome.usage?.output || 0;
  }

  return { result, usage };
}

/**
 * Run a worker over every item with at most CONCURRENCY of them in flight,
 * returning results in the ITEMS' order — never completion order.
 * @param {Array} items - the work items
 * @param {Function} worker - (item) → Promise
 * @returns {Promise<Array>} results, positionally aligned with items
 */
async function mapLimited(items, worker) {
  const results = new Array(items.length);
  let next = 0;

  const drain = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, drain));

  return results;
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
  const translated = [];
  const usage = { input: 0, output: 0 };

  // Dedupe before batching (#529): a page sends its title and description once
  // per meta tag, so the same string rode a batch three times over — three
  // times the AI spend, and adjacent twins are exactly what a model merges.
  // Each unique string is translated ONCE and fanned back below.
  const unique = [];
  const position = new Map();
  for (const string of strings) {
    if (!position.has(string)) {
      position.set(string, unique.length);
      unique.push(string);
    }
  }

  const batches = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    batches.push(unique.slice(i, i + BATCH_SIZE));
  }

  // Batches fly CONCURRENCY-wide (#604) and are stitched back in BATCH order:
  // the sentinel, the alignment checks, and the #523 split backstop all stay
  // per batch, so what a batch does on its own is exactly what it always did.
  const outcomes = await mapLimited(batches, (batch) => translateBatch(ctx, batch, 0));

  outcomes.forEach((outcome, i) => {
    translated.push(...outcome.result.map((text, j) => preserveWhitespace(batches[i][j], text)));
    usage.input += outcome.usage?.input || 0;
    usage.output += outcome.usage?.output || 0;
  });

  // Occurrences are keyed on the exact source string, whitespace included, so
  // every one of them gets back the translation its own text asked for.
  const result = strings.map((string) => translated[position.get(string)]);

  return { result, usage };
}

module.exports = { translateStrings, preserveWhitespace, CONTROL, BATCH_SIZE, CONCURRENCY };
