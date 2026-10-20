/**
 * lines.js: the line helpers the codemod rules (rules.js) share. A rule
 * rewrites one file's text line by line and records one edit per changed line.
 */

/**
 * Split text into lines preserving the trailing-newline state.
 * @param {string} text
 * @returns {{ lines: string[], trailingNewline: boolean }}
 */
function toLines(text) {
  const trailingNewline = text.endsWith('\n');
  const lines = text.split('\n');
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

/**
 * Reassemble lines into text.
 */
function fromLines(lines, trailingNewline) {
  return lines.join('\n') + (trailingNewline ? '\n' : '');
}

/**
 * Line-by-line regex replace helper: applies `pattern` to `replacement` per
 * line and records one edit per changed line.
 * @param {string} id - rule id for the edit records
 * @param {string} text
 * @param {RegExp} pattern - must carry the g flag
 * @param {string|function} replacement
 * @returns {{ text: string, edits: object[] }}
 */
function replacePerLine(id, text, pattern, replacement) {
  const { lines, trailingNewline } = toLines(text);
  const edits = [];
  const out = lines.map((line, index) => {
    const replaced = line.replace(pattern, replacement);
    if (replaced !== line) edits.push({ rule: id, line: index + 1, before: line.trim(), after: replaced.trim() });
    return replaced;
  });
  return { text: fromLines(out, trailingNewline), edits };
}

module.exports = { toLines, fromLines, replacePerLine };
