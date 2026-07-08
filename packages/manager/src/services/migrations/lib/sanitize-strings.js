/**
 * Whitespace-trim fix for migration documents.
 *
 * Historically omega-manager stripped HTML via sanitize-html, but that
 * entity-encoded `&` → `&amp;` (and `<`/`>`) on every string — corrupting
 * URLs and any text containing those characters. XSS defense belongs at
 * render time (template engines escape on output), not at storage. Storage
 * stores literals, so this only trims.
 */
const chalk = require('chalk').default;

/**
 * Recursively walk an object and trim all string leaf values.
 * Returns a flat dot-notation update map of only the values that changed,
 * plus an array of log entries describing each change.
 *
 * @param {*} value - The value to walk
 * @param {string} prefix - Dot-notation path prefix
 * @param {Object} result - Accumulator { updates, logs }
 * @returns {Object} { updates, logs }
 */
function walkAndTrim(value, prefix, result) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== value) {
      result.updates[prefix] = trimmed;

      const maxLen = 80;
      const oldDisplay = value.length > maxLen ? `${value.slice(0, maxLen)}...` : value;
      const newDisplay = trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}...` : trimmed;
      result.logs.push(`          ${chalk.dim(prefix)}: ${chalk.red(JSON.stringify(oldDisplay))} → ${chalk.green(JSON.stringify(newDisplay))}`);
    }
    return result;
  }

  if (Array.isArray(value)) {
    let arrayChanged = false;
    const arrayLogs = [];
    const trimmedArray = value.map((item, i) => {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed !== item) {
          arrayChanged = true;
          arrayLogs.push(`          ${chalk.dim(`${prefix}[${i}]`)}: ${chalk.red(JSON.stringify(item))} → ${chalk.green(JSON.stringify(trimmed))}`);
        }
        return trimmed;
      }

      // Recurse into objects inside arrays
      if (item !== null && typeof item === 'object') {
        const nested = { updates: {}, logs: [] };
        walkAndTrim(item, `${prefix}[${i}]`, nested);
        if (Object.keys(nested.updates).length > 0) {
          arrayChanged = true;
          arrayLogs.push(...nested.logs);

          // Apply nested updates to the item
          for (const [path, val] of Object.entries(nested.updates)) {
            const subPath = path.substring(`${prefix}[${i}].`.length);
            const parts = subPath.split('.');
            let target = item;
            for (let j = 0; j < parts.length - 1; j++) {
              target = target[parts[j]];
            }
            target[parts[parts.length - 1]] = val;
          }
        }
        return item;
      }

      return item;
    });

    if (arrayChanged && prefix) {
      result.updates[prefix] = trimmedArray;
      result.logs.push(...arrayLogs);
    }
    return result;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const childPath = prefix ? `${prefix}.${key}` : key;
      walkAndTrim(child, childPath, result);
    }
  }

  return result;
}

/**
 * Create a migration fix that recursively trims whitespace on all string
 * values in a document. Attaches per-field before → after log lines via the
 * `__logs__` sentinel so the migration runner prints them under the doc's
 * `[N/total] <docId>` header instead of out-of-order.
 *
 * @returns {Function} Fix function for runMigration
 */
function createSanitizeFix() {
  return (data) => {
    const result = { updates: {}, logs: [] };
    walkAndTrim(data, '', result);

    if (Object.keys(result.updates).length === 0) {
      return null;
    }

    return { ...result.updates, __logs__: result.logs };
  };
}

module.exports = { createSanitizeFix };
