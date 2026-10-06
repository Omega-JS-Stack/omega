/**
 * The assertion layer of the suite converter (scripts/convert-suites.js): the
 * node:assert map and backend's ctx `assert` map, one table each, the one call
 * rewrite both go through (a trailing message rides as the second `expect`
 * argument), and the in-place pass over a backend-style file, where every
 * `assert` becomes `expect` and every assertion its matcher.
 */

// Libraries
const path = require('node:path');
const {
  pad, isFn, refuse, walk, isReference, declared, requiredModule, parse,
} = require('./convert-suites-source.js');

const ASSERT_MODULES = ['node:assert', 'node:assert/strict', 'assert', 'assert/strict'];
const EXPECT_MODULE = '@omega.js/devkit/test/expect';
const DEFINE_CASES_MODULE = /(^|\/)define-cases(\.js)?$/;
const BACKEND_TEST_MODULE = '@omega.js/backend/test';

// A `matcher` row takes the actual, `args` matcher arguments, then an optional message.
const matcher = (chain, args, extra) => ({ kind: 'matcher', chain, args, ...extra });
const throwing = (chain) => ({ kind: 'throw', chain });

// node:assert method -> its rewrite, loose and strict alike.
const NODE_MAP = {
  strictEqual: matcher('.toBe', 1),
  equal: matcher('.toBe', 1),
  deepStrictEqual: matcher('.toEqual', 1),
  deepEqual: matcher('.toEqual', 1),
  notStrictEqual: matcher('.not.toBe', 1),
  notEqual: matcher('.not.toBe', 1),
  notDeepStrictEqual: matcher('.not.toEqual', 1),
  notDeepEqual: matcher('.not.toEqual', 1),
  match: matcher('.toMatch', 1),
  doesNotMatch: matcher('.not.toMatch', 1),
  ok: matcher('.toBeTruthy', 0),
  throws: throwing('.toThrow'),
  doesNotThrow: throwing('.not.toThrow'),
  rejects: throwing('.rejects.toThrow'),
  fail: { kind: 'fail' },
};

// Backend's ctx `assert` method -> its rewrite; the names it shares with node map as node does.
const BACKEND_MAP = {
  ...Object.fromEntries([
    'ok', 'equal', 'strictEqual', 'deepEqual', 'deepStrictEqual', 'notEqual', 'notStrictEqual',
    'match', 'doesNotMatch', 'throws', 'doesNotThrow', 'rejects', 'fail',
  ].map((method) => [method, NODE_MAP[method]])),
  notMatch: matcher('.not.toMatch', 1),
  isSuccess: matcher('.toBeSuccess', 0),
  isError: matcher('.toBeError', 1, { optional: true }),
  hasProperty: matcher('.toHaveProperty', 1),
  propertyEquals: matcher('.toHaveProperty', 2),
  isType: matcher('.toBeTypeOf', 1),
  contains: matcher('.toContain', 1),
  inRange: { kind: 'range', chains: ['.toBeGreaterThanOrEqual', '.toBeLessThanOrEqual'] },
};

const isString = (node) => node.type === 'TemplateLiteral' || (node.type === 'Literal' && typeof node.value === 'string');
const isNothing = (node) => (node.type === 'Literal' && node.value === null) || (node.type === 'Identifier' && node.name === 'undefined');

// A walk visitor: a file that already names `expect` cannot take the converter's own.
function refuseOwnExpect(node, parent) {
  if (node.type === 'Identifier' && node.name === 'expect' && isReference(node, parent)) refuse('an `expect` already in the file', node);
}

function enclosingFn(node, parents) {
  let p = parents.get(node);
  while (p && !isFn(p) && p.type !== 'FunctionDeclaration') p = parents.get(p);
  return p;
}

/**
 * The rewrite of one assertion call, as a splice text function.
 * @param {object} call - The CallExpression node.
 * @param {string} method - The assert method it calls (`ok` for a bare `assert(...)`).
 * @param {object} style - `{ table, assertName, expectName }`: the map, and the names on each side.
 * @param {object} opened - The open source (`renderNode`, `parents`, `lineIndent`).
 * @returns {Function} `(shift) => text`; throws a Refusal for a call outside the map.
 */
function assertEdit(call, method, style, opened) {
  const { table, assertName, expectName } = style;
  const { renderNode, parents, lineIndent } = opened;
  const args = call.arguments;
  const label = call.callee.type === 'Identifier' ? `${assertName}(...)` : `${assertName}.${method}`;
  const row = Object.prototype.hasOwnProperty.call(table, method) ? table[method] : null;
  if (!row) refuse(label, call);
  if (args.some((a) => a.type === 'SpreadElement')) refuse(`${label} with a spread argument`, call);
  const arity = (low, high) => {
    if (args.length < low || args.length > high) refuse(`${label} with ${args.length} arguments`, call);
  };
  // The one home of the message rule: a trailing message rides as expect's second argument.
  const expectOf = (actual, message, s) => `${expectName}(${actual}${message ? `, ${renderNode(message, s)}` : ''})`;

  if (row.kind === 'matcher') {
    const count = row.optional && args.length === 1 ? 0 : row.args;
    arity(1 + count, 2 + count);
    // A null or undefined optional argument (backend's isError code) checks nothing.
    const given = args.slice(1, 1 + count).filter((a) => !(row.optional && isNothing(a)));
    return (s) => `${expectOf(renderNode(args[0], s), args[1 + count], s)}${row.chain}(${given.map((a) => renderNode(a, s)).join(', ')})`;
  }
  if (row.kind === 'range') {
    arity(3, 4);
    const stmt = parents.get(call);
    const list = stmt && parents.get(stmt);
    if (stmt.type !== 'ExpressionStatement' || !['BlockStatement', 'Program'].includes(list.type)) refuse(`${label} outside a statement of its own`, call);
    return (s) => row.chains.map((chain, i) => `${expectOf(renderNode(args[0], s), args[3], s)}${chain}(${renderNode(args[1 + i], s)})`)
      .join(`;\n${pad(lineIndent(stmt.start) + s)}`);
  }
  if (row.kind === 'fail') {
    arity(0, 1);
    return (s) => `${expectName}.fail(${args[0] ? renderNode(args[0], s) : ''})`;
  }
  arity(1, 3);
  // node reads a string second argument as the message, never as an error matcher.
  const messageSecond = args[1] && isString(args[1]);
  const errorMatcher = messageSecond || method === 'doesNotThrow' ? null : args[1];
  const message = messageSecond ? args[1] : args[2];
  const owner = enclosingFn(call, parents);
  const awaitIt = method === 'rejects' && parents.get(call).type === 'ExpressionStatement' && owner && owner.async;
  return (s) => {
    const subject = method === 'rejects' && isFn(args[0]) ? `(${renderNode(args[0], s)})()` : renderNode(args[0], s);
    return `${awaitIt ? 'await ' : ''}${expectOf(subject, message, s)}${row.chain}(${errorMatcher ? renderNode(errorMatcher, s) : ''})`;
  };
}

// The assert method a call reaches through `name`, or null when it is no assertion call.
function assertMethod(call, name) {
  const { callee } = call;
  if (callee.type === 'Identifier' && callee.name === name) return 'ok';
  if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' && callee.object.name === name) {
    return callee.property.name;
  }
  return null;
}

// The file-level `const assert = require('<assert module>')` declarator, or null.
function fileAssert(ast) {
  let found = null;
  for (const stmt of ast.body) {
    if (stmt.type !== 'VariableDeclaration') continue;
    for (const decl of stmt.declarations) {
      const mod = requiredModule(decl.init);
      if (!ASSERT_MODULES.includes(mod)) continue;
      if (stmt.declarations.length !== 1) refuse(`a require('${mod}') sharing its declaration`, stmt);
      if (decl.id.type !== 'Identifier' || decl.id.name !== 'assert') refuse(`a require('${mod}') not bound to \`assert\``, decl);
      found = decl;
    }
  }
  return found;
}

// The declarator that replaces the file-level assert require, after the file's own
// define-cases require: the public test API's `expect`, `expect.js` beside a
// vendored path, else the devkit export.
function expectDeclarator(ast) {
  let from = null;
  walk(ast, (node) => {
    const mod = node.type === 'CallExpression' ? requiredModule(node) : null;
    if (from === null && mod && (mod === BACKEND_TEST_MODULE || DEFINE_CASES_MODULE.test(mod))) from = mod;
  });
  if (from === BACKEND_TEST_MODULE) return `{ expect } = require('${BACKEND_TEST_MODULE}')`;
  if (!from || !from.startsWith('.')) return `expect = require('${EXPECT_MODULE}')`;
  return `expect = require('${path.posix.dirname(from)}/expect.js')`;
}

/**
 * Convert a backend-style file (a `defineCases` call or a plain spec object) in place:
 * every `assert` binding (a destructured ctx key, a helper parameter, the file-level
 * require) becomes `expect`, and every assertion call its matcher.
 * @param {object} opened - The open source, from `openSource`.
 * @param {string} source - The file's text.
 * @param {string} file - Its path, for a converter-bug message.
 * @returns {string} The converted text, or `source` itself when it names no `assert`.
 */
function convertBackendSource(opened, source, file) {
  const { ast, parents, isShadowed, addEdit, seal, render } = opened;
  let named = false;
  walk(ast, (node) => {
    if (declared(node).includes('assert') || (node.type === 'MemberExpression' && !node.computed && node.property.name === 'assert')) named = true;
  });
  if (!named) return source;

  const fileDecl = fileAssert(ast);
  if (fileDecl) addEdit(fileDecl.start, fileDecl.end, () => expectDeclarator(ast));
  const styleOf = (id) => {
    if (isShadowed(id, 'assert')) return { table: BACKEND_MAP, assertName: 'assert', expectName: 'expect' };
    if (fileDecl) return { table: NODE_MAP, assertName: 'assert', expectName: 'expect' };
    return refuse('an `assert` with no binding', id);
  };
  const toExpect = (node) => addEdit(node.start, node.end, () => 'expect');

  walk(ast, (node, parent) => {
    refuseOwnExpect(node, parent);
    if (node.type === 'CallExpression' && node !== (fileDecl && fileDecl.init) && ASSERT_MODULES.includes(requiredModule(node))) {
      refuse(`a require('${requiredModule(node)}') below the top level`, node);
    }
    if (node.type === 'MemberExpression' && !node.computed && node.property.name === 'assert') {
      refuse(`${source.slice(node.start, node.end)}: an \`assert\` read off the ctx, not destructured`, node);
    }
    if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'assert'
      && !(parent.type === 'CallExpression' && parent.callee === node && !node.computed)) {
      refuse(`${source.slice(node.start, node.end)} outside a call`, node);
    }
    if (node.type === 'Property' && !node.computed && node.key.type === 'Identifier' && node.key.name === 'assert') {
      const value = node.value.type === 'AssignmentPattern' ? node.value.left : node.value;
      const isPattern = parent.type === 'ObjectPattern';
      if (value.type === 'Identifier' && value.name === 'assert') toExpect(node.key);
      else if (isPattern) refuse(`a destructured \`assert\` bound to ${source.slice(value.start, value.end)}`, node);
      const owner = isPattern && (parents.get(parent).type === 'AssignmentPattern' ? parents.get(parents.get(parent)) : parents.get(parent));
      if (isPattern && !((isFn(owner) || owner.type === 'FunctionDeclaration') && owner.params.some((p) => p.start <= node.start && node.end <= p.end))) {
        refuse('a destructured `assert` outside a parameter', node);
      }
    }
    if (node.type === 'CallExpression') {
      const method = assertMethod(node, 'assert');
      const id = method && (node.callee.type === 'Identifier' ? node.callee : node.callee.object);
      if (method) addEdit(node.start, node.end, assertEdit(node, method, styleOf(id), opened));
    }
    if (node.type === 'Identifier' && node.name === 'assert' && isReference(node, parent)) toExpect(node);
  });

  seal();
  const output = render(0, source.length, 0);
  try {
    parse(output);
  } catch (e) {
    throw new Error(`${file}: the converted text does not parse (${e.message}); this is a converter bug`);
  }
  return output;
}

module.exports = {
  ASSERT_MODULES,
  EXPECT_MODULE,
  NODE_MAP,
  assertEdit,
  assertMethod,
  convertBackendSource,
  refuseOwnExpect,
};
