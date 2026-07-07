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
 * @param {boolean} [preferLiteral=false] - unquoted strings are literals unless
 *   they contain dots or exist in context (Ruby parity)
 * @returns {*}
 */
function resolveInput(lookup, input, preferLiteral = false) {
  if (input === null || input === undefined || input === '') return null;

  const quoted = input.match(/^["'](.*)["']$/);
  if (quoted) return quoted[1];

  if (preferLiteral) {
    if (input.includes('.') || isTruthyLookup(lookup(input))) {
      return resolveVariable(lookup, input);
    }
    return input;
  }

  return resolveVariable(lookup, input);
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
    const key = arg.slice(0, index).trim();
    let value = arg.slice(index + 1).trim();

    if (lookup) {
      value = resolveInput(lookup, value);
    } else {
      value = value.replace(/^['"]|['"]$/g, '');
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
