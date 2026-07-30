/**
 * variable-resolver.js — argument parsing + variable resolution for uj_* tags.
 *
 * Ported from jekyll-uj-powertools lib/helpers/variable_resolver.rb (READ-ONLY
 * reference repo). Engine-neutral: variable lookup goes through a `lookup(path)`
 * function the engine adapter provides (register-liquid.js builds one from the
 * LiquidJS render context).
 */

/**
 * Resolve a variable or string literal.
 * @param {function} lookup - (dotPath) => value from the render context
 * @param {string} input - raw tag argument
 * @param {boolean} [preferLiteral=false] - unquoted words stay literal text
 *   unless they are typed literals, contain dots, or exist in context
 * @returns {*}
 */
function resolveInput(lookup, input, preferLiteral = false) {
  if (input === null || input === undefined || input === '') return null;

  const quoted = input.match(/^["'](.*)["']$/);
  if (quoted) return quoted[1];

  if (preferLiteral) {
    // A typed literal is typed in this lane too — max_width=640 is the number
    // 640 and webp=false the boolean, matching the plain lane below. Quoting
    // is the author's opt-out.
    const typed = parseLiteral(input);
    if (typed) return typed.value;
    if (input.includes('.') || isTruthyLookup(lookup(input))) {
      return resolveVariable(lookup, input);
    }
    return input;
  }

  return resolveVariable(lookup, input);
}

/**
 * Read a bare typed literal (number, boolean, nil).
 * @param {string} input
 * @returns {{value: *}|null} null when the input is not a typed literal
 */
function parseLiteral(input) {
  const trimmed = String(input).trim();

  if (trimmed === 'nil' || trimmed === 'null') return { value: null };
  if (trimmed === 'true') return { value: true };
  if (trimmed === 'false') return { value: false };
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return { value: Number(trimmed) };

  return null;
}

// Ruby's `context[input]` guard is plain truthiness
function isTruthyLookup(value) {
  return value !== null && value !== undefined && value !== false;
}

/**
 * Resolve a dot-path variable through the context.
 * @param {function} lookup - (dotPath) => value
 * @param {string} variableName
 * @returns {*} null when unresolvable (Ruby parity: nil)
 */
function resolveVariable(lookup, variableName) {
  if (!variableName) return null;

  // Bare literals evaluate to their values before any scope lookup — a
  // template writes max_width=640 / webp=false meaning the literal, not an
  // (always-missing) scope path.
  const literal = parseLiteral(variableName);
  if (literal) return literal.value;

  const value = lookup(variableName);
  return value === undefined ? null : value;
}

/**
 * Parse comma-separated tag arguments, preserving quotes.
 * @param {string} markup
 * @returns {string[]}
 */
function parseArguments(markup) {
  const args = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = null;

  for (const char of markup || '') {
    if (!inQuotes && (char === '"' || char === "'")) {
      inQuotes = true;
      quoteChar = char;
      current += char;
    } else if (inQuotes && char === quoteChar) {
      inQuotes = false;
      quoteChar = null;
      current += char;
    } else if (!inQuotes && char === ',') {
      args.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim().length > 0) args.push(current.trim());
  return args;
}

/**
 * Parse key=value options from parsed arguments.
 * @param {string[]} args
 * @param {function} [lookup] - when provided, unquoted values resolve as variables
 * @returns {object}
 */
function parseOptions(args, lookup) {
  const options = {};

  for (const arg of args || []) {
    if (!arg.includes('=')) continue;

    const index = arg.indexOf('=');
    const key = stripQuotes(arg.slice(0, index).trim());
    let value = arg.slice(index + 1).trim();

    if (lookup) {
      // The ONE option parser (the image-tag lane in collections.js imports
      // it too), on the preferLiteral rule: typed literals resolve typed
      // (max_width=640 is the number), bare words keep their literal text
      // unless they exist in context (class=hero works), dotted paths
      // resolve — and a missing path yields null so a typo'd variable never
      // renders its own name into the page.
      value = resolveInput(lookup, value, true);
    } else {
      value = stripQuotes(value);
    }

    options[key] = value;
  }

  return options;
}

/**
 * Check whether a raw argument was quoted.
 * @param {string} input
 * @returns {boolean}
 */
function isQuoted(input) {
  return !!(input && /^["']/.test(input));
}

/**
 * Strip surrounding quotes from a raw argument.
 * @param {string} input
 * @returns {string}
 */
function stripQuotes(input) {
  return String(input).replace(/^['"]|['"]$/g, '');
}

module.exports = { resolveInput, resolveVariable, parseArguments, parseOptions, isQuoted, stripQuotes };
