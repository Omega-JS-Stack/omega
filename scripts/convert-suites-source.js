/**
 * The source layer of the suite converter (scripts/convert-suites.js): acorn
 * parsing with ranges, a plain walker, binding and reference tests, the refusal
 * every layer throws, and the range splicer that renders the source back out with every edit applied and
 * any moved text re-indented (template literal text never moves).
 */

// Libraries
const acorn = require('acorn');

/**
 * Indentation of `n` spaces.
 * @param {number} n - The column count; a negative count is zero.
 * @returns {string} The spaces.
 */
const pad = (n) => ' '.repeat(Math.max(0, n));

/**
 * Whether a node is a function expression, arrow or `function`.
 * @param {object|null} node - An acorn node, or nothing.
 * @returns {boolean} True for an ArrowFunctionExpression or a FunctionExpression.
 */
const isFn = (node) => Boolean(node) && (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression');

/** A construct the converter will not rewrite; the file stays unwritten. */
class Refusal extends Error {}

/**
 * Refuse a construct, naming it and, when a node is given, its line.
 * @param {string} construct - What the converter will not rewrite.
 * @param {object} [node] - The acorn node it sits at.
 * @returns {never} Always throws a Refusal.
 */
function refuse(construct, node) {
  throw new Refusal(node && node.loc ? `${construct} (line ${node.loc.start.line})` : construct);
}

function children(node) {
  const out = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => item && typeof item.type === 'string' && out.push(item));
    else if (value && typeof value.type === 'string') out.push(value);
  }
  return out;
}

/**
 * Walk a tree depth-first; a visitor returning false skips the node's children.
 * @param {object} node - The acorn node to start at.
 * @param {Function} visit - Called as `visit(node, parent)` for every node.
 * @param {object|null} [parent] - The start node's parent.
 * @returns {void}
 */
function walk(node, visit, parent = null) {
  if (visit(node, parent) === false) return;
  for (const child of children(node)) walk(child, visit, node);
}

/**
 * Whether a node is an Identifier that names a binding or reads one (never a property key or a label).
 * @param {object} node - The acorn node.
 * @param {object|null} parent - Its parent node, or null at the root.
 * @returns {boolean} True for a reference.
 */
function isReference(node, parent) {
  if (node.type !== 'Identifier') return false;
  if (!parent) return true;
  if (parent.type === 'MemberExpression') return parent.object === node || parent.computed;
  if (parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') {
    return parent.value === node || parent.computed;
  }
  return !['LabeledStatement', 'BreakStatement', 'ContinueStatement', 'MetaProperty'].includes(parent.type);
}

function patternNames(pattern, out = []) {
  if (!pattern) return out;
  if (pattern.type === 'Identifier') out.push(pattern.name);
  else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((p) => patternNames(p.type === 'RestElement' ? p.argument : p.value, out));
  else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((e) => patternNames(e, out));
  else if (pattern.type === 'RestElement') patternNames(pattern.argument, out);
  else if (pattern.type === 'AssignmentPattern') patternNames(pattern.left, out);
  return out;
}

/**
 * The names a scope node binds directly: a function's own name and params, a catch
 * param, or the declarations of a block or a for head.
 * @param {object} node - The acorn node that may open a scope.
 * @returns {string[]} The bound names; empty for a node that binds none.
 */
function declared(node) {
  if (isFn(node) || node.type === 'FunctionDeclaration') {
    return [...(node.type === 'FunctionExpression' && node.id ? [node.id.name] : []), ...node.params.flatMap((p) => patternNames(p))];
  }
  if (node.type === 'CatchClause') return patternNames(node.param);
  const statements = ['Program', 'BlockStatement', 'StaticBlock'].includes(node.type) ? node.body
    : node.type === 'ForStatement' ? [node.init]
      : ['ForOfStatement', 'ForInStatement'].includes(node.type) ? [node.left] : [];
  return statements.flatMap((s) => {
    if (s && s.type === 'VariableDeclaration') return s.declarations.flatMap((d) => patternNames(d.id));
    return s && (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id ? [s.id.name] : [];
  });
}

/**
 * The module a `require('<name>')` call names.
 * @param {object|null} init - A declarator's init node, or nothing.
 * @returns {string|null} The module name, or null when it is not a require of a string literal.
 */
function requiredModule(init) {
  if (!init || init.type !== 'CallExpression' || init.callee.type !== 'Identifier' || init.callee.name !== 'require') return null;
  const [arg] = init.arguments;
  return arg && arg.type === 'Literal' && typeof arg.value === 'string' ? arg.value : null;
}

/**
 * Parse a script with acorn: latest syntax, script mode, ranges and line locations.
 * Throws acorn's error on a parse failure.
 * @param {string} source - The script's text.
 * @param {object[]} [comments] - Filled with every comment the parse reads.
 * @returns {object} The Program node.
 */
function parse(source, comments = []) {
  return acorn.parse(source, {
    ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true, locations: true, onComment: comments,
  });
}

/**
 * Parse a script and open it for range edits. Throws acorn's error on a parse failure.
 * @param {string} source - The script's text.
 * @returns {object} The ast, its comments and parent links, and the splice helpers:
 *   `addEdit(start, end, text(shift), moved)`, `seal()` once every edit is in, then
 *   `render(start, end, shift)` / `renderNode(node, shift)`.
 */
function openSource(source) {
  const comments = [];
  const ast = parse(source, comments);
  const parents = new Map();
  const idents = new Set();
  const inTemplate = new Uint8Array(source.length);
  walk(ast, (node, parent) => {
    parents.set(node, parent);
    if (node.type === 'Identifier') idents.add(node.name);
    if (node.type === 'TemplateElement') inTemplate.fill(1, node.start, node.end);
  });

  // A name no identifier in the file already uses.
  const fresh = (base) => {
    let name = base;
    for (let n = 2; idents.has(name); n += 1) name = `${base}${n}`;
    idents.add(name);
    return name;
  };

  const isShadowed = (node, name) => {
    for (let p = parents.get(node); p && p.type !== 'Program'; p = parents.get(p)) {
      if (declared(p).includes(name)) return true;
    }
    return false;
  };

  const edits = [];
  const editKeys = new Set();
  const addEdit = (start, end, text, moved = false) => {
    const key = `${start}:${end}`;
    if (editKeys.has(key)) return;
    editKeys.add(key);
    edits.push({ start, end, text, moved });
  };
  // Zero-width inserts sort before a replacement at the same offset.
  const seal = () => edits.sort((a, b) => a.start - b.start
    || (a.end === a.start ? 0 : 1) - (b.end === b.start ? 0 : 1)
    || b.end - a.end);

  const lineStart = (pos) => source.lastIndexOf('\n', pos - 1) + 1;
  const lineIndent = (pos) => /^[ \t]*/.exec(source.slice(lineStart(pos)))[0].length;
  const lineEnd = (pos) => (source.indexOf('\n', pos) === -1 ? source.length : source.indexOf('\n', pos));
  const isBlank = (from, to) => /^\s*$/.test(source.slice(from, to));

  // A source slice with every line moved by `shift` columns; template text never moves.
  function raw(a, b, shift) {
    if (!shift) return source.slice(a, b);
    let out = '';
    for (let i = a; i < b; i += 1) {
      out += source[i];
      if (source[i] !== '\n' || inTemplate[i]) continue;
      if (shift > 0) {
        if (i + 1 < source.length && source[i + 1] !== '\n' && source[i + 1] !== '\r') out += pad(shift);
      } else {
        for (let k = 0; k < -shift && i + 1 < b && source[i + 1] === ' '; k += 1) i += 1;
      }
    }
    return out;
  }

  function render(start, end, shift) {
    let out = '';
    let pos = start;
    for (const e of edits) {
      if (e.start < pos || e.end > end) continue;
      // A moved statement's removal never applies while its own text is re-rendered.
      if (e.moved && e.start <= start && end <= e.end) continue;
      out += raw(pos, e.start, shift) + e.text(shift);
      pos = e.end;
    }
    return out + raw(pos, end, shift);
  }
  const renderNode = (node, shift) => render(node.start, node.end, shift);

  // Every comment between the previous sibling statement and this one travels with it.
  function commentStart(stmt) {
    const parent = parents.get(stmt);
    const index = parent.body.indexOf(stmt);
    const from = index > 0 ? parent.body[index - 1].end : (parent.type === 'Program' ? 0 : parent.start + 1);
    const own = comments.filter((c) => c.start >= from && c.end <= stmt.start
      && (index === 0 || source.slice(from, c.start).includes('\n')));
    return own.length ? own[0].start : stmt.start;
  }

  // A statement's leading comments, re-indented to `col`, ending at `col` on the statement's line.
  const leadingText = (stmt, col) => {
    const start = commentStart(stmt);
    return start < stmt.start ? render(start, stmt.start, col - lineIndent(stmt.start)) : '';
  };

  // Remove a statement's whole lines (and one blank line when a blank line already precedes).
  function removeStatement(stmt, from, moved) {
    const start = isBlank(lineStart(from), from) ? lineStart(from) : from;
    let end = stmt.end;
    if (isBlank(end, lineEnd(end))) {
      end = Math.min(lineEnd(end) + 1, source.length);
      const prevBlank = start === 0 || isBlank(lineStart(start - 1), start);
      if (prevBlank && end < source.length && isBlank(end, lineEnd(end))) end = Math.min(lineEnd(end) + 1, source.length);
    }
    addEdit(start, end, () => '', moved);
  }

  return {
    ast, comments, parents, fresh, isShadowed, addEdit, seal, render, renderNode,
    lineIndent, commentStart, leadingText, removeStatement,
  };
}

module.exports = {
  pad,
  isFn,
  Refusal,
  refuse,
  walk,
  isReference,
  declared,
  requiredModule,
  parse,
  openSource,
};
