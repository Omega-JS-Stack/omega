/**
 * Suite converter: `node scripts/convert-suites.js <path>... [--check]`.
 * Rewrites plain node:test suites in place into ONE `defineCases` group:
 * describe names join with ` > `, top-level before/after become setup/cleanup,
 * every other hook opens each case it covers, the case parameter becomes `ctx`,
 * and every node:assert call becomes its `ctx.expect` matcher, as range splices
 * over the acorn-parsed source. A path is a file or a directory (its suites, as
 * the runner discovers them). A converted file is left as is; `--check` writes
 * nothing and exits 1 naming each file that would change. A construct outside
 * the map is refused by file and construct, that file unwritten (exit 2).
 */

// Libraries
const fs = require('node:fs');
const path = require('node:path');
const {
  pad, isFn, walk, isReference, declared, requiredModule, parse, openSource,
} = require('./convert-suites-source.js');
const { findTestFiles } = require('../packages/devkit/src/test/discovery.js');

const DEFINE_CASES_LINE = "const defineCases = require('@omega.js/devkit/test/define-cases');";
const ASSERT_MODULES = ['node:assert', 'node:assert/strict', 'assert', 'assert/strict'];
// node:test's export name -> what the converter makes of it.
const KINDS = {
  test: 'case', it: 'case', describe: 'describe', suite: 'describe',
  before: 'before', after: 'after', beforeEach: 'beforeEach', afterEach: 'afterEach',
};
const CASE_OPTIONS = ['skip', 'timeout'];
// node:assert method -> the matcher chain it becomes.
const MATCHERS = {
  strictEqual: '.toBe', equal: '.toBe', deepStrictEqual: '.toEqual', deepEqual: '.toEqual',
  notStrictEqual: '.not.toBe', notEqual: '.not.toBe', notDeepStrictEqual: '.not.toEqual', notDeepEqual: '.not.toEqual',
  match: '.toMatch', doesNotMatch: '.not.toMatch', ok: '.toBeTruthy',
};
const THROW_CHAINS = { throws: '.toThrow', doesNotThrow: '.not.toThrow', rejects: '.rejects.toThrow' };

const isString = (node) => node.type === 'TemplateLiteral' || (node.type === 'Literal' && typeof node.value === 'string');
const quote = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

/** A construct the converter will not rewrite; the file stays unwritten. */
class Refusal extends Error {}

function refuse(construct, node) {
  throw new Refusal(node && node.loc ? `${construct} (line ${node.loc.start.line})` : construct);
}

function isConverted(ast) {
  return ast.body.some((s) => s.type === 'ExpressionStatement'
    && s.expression.type === 'AssignmentExpression'
    && s.expression.left.type === 'MemberExpression'
    && s.expression.left.object.name === 'module'
    && s.expression.left.property.name === 'exports'
    && s.expression.right.type === 'CallExpression'
    && s.expression.right.callee.name === 'defineCases');
}

/**
 * Convert one plain node:test suite's source into a `defineCases` group.
 * @param {string} source - The suite file's text.
 * @param {string} file - Its path; the group's description is its base name.
 * @returns {string} The converted text, or `source` itself when already converted.
 */
function convertSource(source, file) {
  let opened;
  try {
    opened = openSource(source);
  } catch (e) {
    refuse(`a parse error: ${e.message}`);
  }
  const {
    ast, comments, parents, fresh, isShadowed, addEdit, seal, render, renderNode,
    lineIndent, commentStart, leadingText, removeStatement,
  } = opened;
  if (isConverted(ast)) return source;

  let casesName;
  let contextName;
  const casesVar = () => (casesName = casesName || fresh('cases'));

  // ─── Imports ───

  const bindings = new Map();
  const importIds = new Set();
  const consumed = new Set();
  let assertName = null;
  let testDecl = null;
  const kept = [];

  for (const stmt of ast.body) {
    if (stmt.type !== 'VariableDeclaration') continue;
    for (const decl of stmt.declarations) {
      const mod = requiredModule(decl.init);
      const isTest = mod === 'node:test';
      // `const { before, after } = test;` reads node:test's default export.
      const fromTest = Boolean(decl.init) && decl.init.type === 'Identifier' && bindings.get(decl.init.name) === 'test';
      if (!isTest && !fromTest && !ASSERT_MODULES.includes(mod)) continue;
      const label = fromTest ? `= ${decl.init.name}` : `require('${mod}')`;
      if (stmt.declarations.length !== 1) refuse(`a ${label} sharing its declaration`, stmt);
      walk(decl.id, (node) => { if (node.type === 'Identifier') importIds.add(node); });
      if (!isTest && !fromTest) {
        if (decl.id.type !== 'Identifier') refuse(`a destructured ${label}`, decl);
        assertName = decl.id.name;
        removeStatement(stmt, stmt.start, false);
        continue;
      }
      if (fromTest) {
        importIds.add(decl.init);
        removeStatement(stmt, stmt.start, false);
      } else if (testDecl) refuse("a second require('node:test')", stmt);
      else testDecl = stmt;
      if (isTest && decl.id.type === 'Identifier') bindings.set(decl.id.name, 'test');
      else if (decl.id.type === 'ObjectPattern') {
        for (const prop of decl.id.properties) {
          if (prop.type !== 'Property' || prop.computed || prop.value.type !== 'Identifier') refuse(`a ${label} pattern`, prop);
          if (KINDS[prop.key.name]) bindings.set(prop.value.name, prop.key.name);
          else kept.push(source.slice(prop.start, prop.end));
        }
      } else refuse(`a ${label} pattern`, decl);
    }
  }
  if (!testDecl) refuse("no require('node:test')");
  if (!assertName && declared(ast).includes('assert')) refuse("an `assert` that is not a require('node:assert')");
  addEdit(testDecl.start, testDecl.end, () => (kept.length
    ? `${DEFINE_CASES_LINE}\nconst { ${kept.join(', ')} } = require('node:test');`
    : DEFINE_CASES_LINE));

  // The node:test export a call reaches (`test`, `it`, `test.after`, ...), or null.
  function kindOf(call) {
    if (!call || call.type !== 'CallExpression') return null;
    const { callee } = call;
    if (callee.type === 'Identifier' && bindings.has(callee.name) && !isShadowed(callee, callee.name)) return bindings.get(callee.name);
    if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier'
      && bindings.get(callee.object.name) === 'test' && KINDS[callee.property.name] && !isShadowed(callee, callee.object.name)) {
      return callee.property.name;
    }
    return null;
  }
  const roleOf = (call) => KINDS[kindOf(call)] || null;
  const stmtCall = (stmt) => (stmt.type === 'ExpressionStatement' && kindOf(stmt.expression) ? stmt.expression : null);
  const consume = (call) => consumed.add(call.callee.type === 'Identifier' ? call.callee : call.callee.object);
  const nameOf = (call) => source.slice(call.callee.start, call.callee.end);

  // ─── Case and hook bodies: ctx, t, assertions ───

  function renameAll(scope, from, to, onRef, stopAtRebind) {
    walk(scope, (node, parent) => {
      if (stopAtRebind && node !== scope && declared(node).includes(from)) return false;
      if (node.type !== 'Identifier' || node.name !== from || !isReference(node, parent)) return undefined;
      if (onRef) onRef(node, parent);
      const shorthand = parent && parent.type === 'Property' && parent.shorthand;
      addEdit(node.start, node.end, () => (shorthand ? `${from}: ${to}` : to));
      return undefined;
    }, parents.get(scope));
  }

  function enclosingFn(node) {
    let p = parents.get(node);
    while (p && !isFn(p) && p.type !== 'FunctionDeclaration') p = parents.get(p);
    return p;
  }

  function assertEdit(call, method) {
    const args = call.arguments;
    const label = method === 'ok' && call.callee.type === 'Identifier' ? `${assertName}(...)` : `${assertName}.${method}`;
    if (args.some((a) => a.type === 'SpreadElement')) refuse(`${label} with a spread argument`, call);
    const expectOf = (actual, message, s) => `ctx.expect(${renderNode(actual, s)}${message ? `, ${renderNode(message, s)}` : ''})`;
    if (MATCHERS[method]) {
      const arity = method === 'ok' ? 1 : 2;
      if (args.length < arity || args.length > arity + 1) refuse(`${label} with ${args.length} arguments`, call);
      return (s) => `${expectOf(args[0], args[arity], s)}${MATCHERS[method]}(${arity === 2 ? renderNode(args[1], s) : ''})`;
    }
    if (THROW_CHAINS[method]) {
      if (!args.length || args.length > 3) refuse(`${label} with ${args.length} arguments`, call);
      // node reads a string second argument as the message, never as an error matcher.
      const messageSecond = args[1] && isString(args[1]);
      const matcher = messageSecond || method === 'doesNotThrow' ? null : args[1];
      const message = messageSecond ? args[1] : args[2];
      const parent = parents.get(call);
      const owner = enclosingFn(call);
      const awaitIt = method === 'rejects' && parent.type === 'ExpressionStatement' && owner && owner.async;
      return (s) => {
        const subject = method === 'rejects' && isFn(args[0]) ? `(${renderNode(args[0], s)})()` : renderNode(args[0], s);
        const actual = `ctx.expect(${subject}${message ? `, ${renderNode(message, s)}` : ''})`;
        return `${awaitIt ? 'await ' : ''}${actual}${THROW_CHAINS[method]}(${matcher ? renderNode(matcher, s) : ''})`;
      };
    }
    if (method === 'fail') {
      if (args.length > 1) refuse(`${label} with ${args.length} arguments`, call);
      return (s) => `ctx.expect.fail(${args[0] ? renderNode(args[0], s) : ''})`;
    }
    return refuse(label, call);
  }

  // Rewrite every assertion under `scope`; returns how many there were.
  function convertAsserts(scope) {
    let count = 0;
    walk(scope, (node) => {
      if (node.type !== 'CallExpression' || !assertName) return;
      const { callee } = node;
      let method = null;
      if (callee.type === 'Identifier' && callee.name === assertName) method = 'ok';
      else if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' && callee.object.name === assertName) {
        method = callee.property.name;
      }
      if (!method || isShadowed(callee, assertName)) return;
      addEdit(node.start, node.end, assertEdit(node, method));
      consumed.add(callee.type === 'Identifier' ? callee : callee.object);
      count += 1;
    });
    return count;
  }

  // Give a case or hook function the `ctx` parameter; returns whether it takes one.
  function prepareFn(fn, isCase) {
    if (fn.params.length > 1) refuse('a done callback', fn);
    const [param] = fn.params;
    if (param && param.type !== 'Identifier') refuse('a destructured test context', param);
    walk(fn.body, (node) => {
      if (node !== fn && kindOf(node)) refuse(`${nameOf(node)}(...) inside a case`, node);
    });
    const asserts = convertAsserts(fn.body);
    const takesCtx = Boolean(param) || isCase || asserts > 0;
    if (!takesCtx || (param && param.name === 'ctx')) return takesCtx;

    for (let p = parents.get(fn); p; p = parents.get(p)) {
      if (declared(p).includes('ctx')) refuse('a `ctx` binding around a case', p);
    }
    let hasLocalCtx = false;
    walk(fn, (node, parent) => { if (node.type === 'Identifier' && node.name === 'ctx' && isReference(node, parent)) hasLocalCtx = true; }, parents.get(fn));
    if (hasLocalCtx) renameAll(fn, 'ctx', contextName = contextName || fresh('context'), null, false);

    if (param) {
      renameAll(fn, param.name, 'ctx', (node, parent) => {
        const prop = parent && parent.type === 'MemberExpression' && parent.object === node && !parent.computed && parent.property.name;
        if (prop === 'mock' || prop === 'test') refuse(`${param.name}.${prop}`, parent);
      }, true);
    } else {
      const open = source.indexOf('(', fn.type === 'FunctionExpression' && fn.id ? fn.id.end : fn.start);
      addEdit(open + 1, open + 1, () => 'ctx');
    }
    return true;
  }

  // ─── Plan: frames, cases, hooks ───

  const newFrame = (name) => ({ name, hooks: { beforeOnce: [], beforeEach: [], afterEach: [], after: [] }, cases: [] });
  const top = newFrame(null);
  const topHooks = { before: [], after: [] };
  const caseInfo = new Map();
  const describeInfo = new Map();
  const items = [];

  const callHook = (h) => `${h.ref}(${h.takesCtx ? 'ctx' : ''})`;
  const registerAfter = (h) => `ctx.after(${h.takesCtx ? `() => ${h.ref}(ctx)` : h.ref});`;
  function prologue(info) {
    const lines = info.afterRegs.map(registerAfter);
    for (const frame of info.chain) frame.hooks.beforeOnce.forEach((h) => lines.push(`await ${h.ref}(ctx);`));
    for (const frame of info.chain) frame.hooks.beforeEach.forEach((h) => lines.push(`${h.isAsync ? 'await ' : ''}${callHook(h)};`));
    for (const frame of info.chain) frame.hooks.afterEach.forEach((h) => lines.push(registerAfter(h)));
    return lines;
  }
  const needsAwait = (info) => prologue(info).some((line) => line.startsWith('await '));

  // The hook lines open the case body; a one-line body opens onto its own lines for them.
  function addPrologue(info) {
    const { fn: { body, start } } = info;
    const at = (s, extra) => pad(lineIndent(start) + s + extra);
    if (source.slice(body.start, body.end).includes('\n')) {
      addEdit(body.start + 1, body.start + 1, (s) => prologue(info).map((l) => `\n${at(s, 2)}${l}`).join(''));
      return;
    }
    addEdit(body.start, body.end, (s) => {
      const inner = render(body.start + 1, body.end - 1, s);
      const lines = prologue(info);
      if (!lines.length) return `{${inner}}`;
      return `{\n${[...lines, inner.trim()].filter(Boolean).map((l) => at(s, 2) + l).join('\n')}\n${at(s, 0)}}`;
    });
  }

  function planCase(call, chain, loopUpTo) {
    consume(call);
    const args = call.arguments;
    if (args.length < 2 || args.length > 3 || isFn(args[0])) refuse(`${nameOf(call)}(...) with ${args.length} arguments`, call);
    const fn = args[args.length - 1];
    const opts = args.length === 3 ? args[1] : null;
    if (opts && opts.type === 'ObjectExpression') {
      for (const p of opts.properties) {
        if (p.type !== 'Property' || p.computed || !CASE_OPTIONS.includes(p.key.name)) refuse(`the ${nameOf(call)} option ${p.key ? p.key.name : '...'}`, p);
      }
    }
    const info = { call, chain, fn, opts, afterRegs: [] };
    if (isFn(fn)) {
      prepareFn(fn, true);
      if (fn.body.type === 'BlockStatement') {
        addEdit(fn.start, fn.start, () => (needsAwait(info) && !fn.async ? 'async ' : ''));
        addPrologue(info);
      }
    } else if (!['Identifier', 'MemberExpression'].includes(fn.type)) refuse(`a ${fn.type} as a case body`, fn);
    caseInfo.set(call, info);
    chain.forEach((frame, i) => frame.cases.push({ info, inLoop: i < loopUpTo }));
  }

  function prepareHook(call) {
    consume(call);
    const kind = kindOf(call);
    if (call.arguments.length !== 1) refuse(`${nameOf(call)}(...) with ${call.arguments.length} arguments`, call);
    const [fn] = call.arguments;
    if (isFn(fn)) return { kind, fn, takesCtx: prepareFn(fn, false), isAsync: fn.async };
    if (fn.type === 'Identifier' || fn.type === 'MemberExpression') return { kind, fn, takesCtx: false, isAsync: true };
    return refuse(`a ${fn.type} as a ${kind} hook`, fn);
  }

  function hookDecl(hook, col, shift) {
    const fnText = renderNode(hook.fn, shift);
    if (hook.kind !== 'before') return `const ${hook.ref} = ${fnText};`;
    // A describe's `before` runs once, before the first of its cases that runs.
    const run = fresh(`${hook.ref}Run`);
    const body = `Promise.resolve().then(() => (${fnText})(${hook.takesCtx ? 'ctx' : ''}))`;
    return `let ${run};\n${pad(col)}const ${hook.ref} = (ctx) => (${run} ||= ${body});`;
  }

  function planHook(call, stmt, chain, mode) {
    const hook = prepareHook(call);
    if (mode === 'top' && (hook.kind === 'before' || hook.kind === 'after')) {
      topHooks[hook.kind].push({ ...hook, stmt });
      removeStatement(stmt, commentStart(stmt), true);
      return;
    }
    hook.ref = fresh(`${hook.kind}Hook`);
    chain[chain.length - 1].hooks[hook.kind === 'before' ? 'beforeOnce' : hook.kind].push(hook);
    addEdit(stmt.start, stmt.end, (s) => hookDecl(hook, lineIndent(stmt.start) + s, s));
  }

  function pushText(itemTexts, col) {
    return `${casesVar()}.push(\n${itemTexts.map((t) => `${pad(col + 2)}${t},`).join('\n')}\n${pad(col)});`;
  }

  function planDescribe(call, chain, loopUpTo) {
    consume(call);
    const fn = call.arguments[1];
    if (call.arguments.length !== 2 || !isFn(fn) || fn.params.length || fn.body.type !== 'BlockStatement') {
      refuse(`a ${nameOf(call)}(...) form other than (name, () => { ... })`, call);
    }
    const frame = newFrame(call.arguments[0]);
    const body = fn.body.body;
    const last = body[body.length - 1];
    const dynamic = !body.every((s) => ['case', 'describe'].includes(roleOf(stmtCall(s))))
      || comments.some((c) => c.start > (last ? last.end : fn.body.start) && c.end < fn.body.end);
    describeInfo.set(call, { fn, dynamic });
    planStatements(body, [...chain, frame], dynamic ? 'dynamic' : 'static', loopUpTo);
    if (!frame.hooks.after.length || !frame.cases.length) return;
    const lastCase = frame.cases[frame.cases.length - 1];
    if (lastCase.inLoop) refuse(`an after hook in a ${nameOf(call)} whose last case runs in a loop`, call);
    lastCase.info.afterRegs.unshift(...[...frame.hooks.after].reverse());
  }

  // Test calls inside a loop or block: each becomes a push onto the container's cases.
  function planNested(stmt, chain) {
    walk(stmt, (node) => {
      const role = roleOf(node);
      if (!role) return undefined;
      const parent = parents.get(node);
      if (parent.type !== 'ExpressionStatement') refuse(`${nameOf(node)}(...) outside a statement`, node);
      for (let p = parent; p !== stmt; p = parents.get(p)) {
        if (isFn(p) || p.type === 'FunctionDeclaration') refuse(`${nameOf(node)}(...) inside a function`, node);
      }
      if (role === 'case') {
        planCase(node, chain, chain.length);
        addEdit(parent.start, parent.end, (s) => `${casesVar()}.push(${caseItem(node, lineIndent(parent.start) + s)});`);
      } else if (role === 'describe') {
        planDescribe(node, chain, chain.length);
        addEdit(parent.start, parent.end, (s) => pushText(describeItems(node, lineIndent(parent.start) + s + 2), lineIndent(parent.start) + s));
      } else refuse(`${nameOf(node)}(...) inside a loop or block`, node);
      return false;
    });
  }

  const containsTests = (stmt) => {
    let found = false;
    walk(stmt, (node) => { if (kindOf(node)) found = true; return !found; });
    return found;
  };

  function planStatements(statements, chain, mode, loopUpTo) {
    for (const hookPass of [true, false]) {
      for (const stmt of statements) {
        const call = stmtCall(stmt);
        const role = call && roleOf(call);
        const isHook = Boolean(role) && role !== 'case' && role !== 'describe';
        if (isHook !== hookPass) continue;
        if (isHook) planHook(call, stmt, chain, mode);
        else if (role === 'case') planCase(call, chain, loopUpTo);
        else if (role === 'describe') planDescribe(call, chain, loopUpTo);
        else if (!containsTests(stmt)) continue;
        else planNested(stmt, chain);

        if (mode === 'top' && !isHook) {
          items.push(stmt);
          removeStatement(stmt, commentStart(stmt), true);
        } else if (mode === 'dynamic' && role === 'case') {
          addEdit(stmt.start, stmt.end, (s) => `${casesVar()}.push(${caseItem(call, lineIndent(stmt.start) + s)});`);
        } else if (mode === 'dynamic' && role === 'describe') {
          addEdit(stmt.start, stmt.end, (s) => pushText(describeItems(call, lineIndent(stmt.start) + s + 2), lineIndent(stmt.start) + s));
        }
      }
    }
  }

  // ─── Emit: case objects, describe groups, the exports block ───

  function nameText(info) {
    const parts = [...info.chain.filter((f) => f.name).map((f) => f.name), info.call.arguments[0]];
    if (parts.length === 1) return renderNode(parts[0], 0);
    if (parts.every((p) => p.type === 'Literal' && typeof p.value === 'string')) return quote(parts.map((p) => p.value).join(' > '));
    const piece = (p) => {
      if (p.type === 'Literal' && typeof p.value === 'string') return p.value.replace(/[`\\]|\$\{/g, (m) => `\\${m}`);
      if (p.type === 'TemplateLiteral') return source.slice(p.start + 1, p.end - 1);
      return `\${${source.slice(p.start, p.end)}}`;
    };
    return `\`${parts.map(piece).join(' > ')}\``;
  }

  function runText(info, col) {
    const { fn } = info;
    const shift = col - lineIndent(fn.start);
    const lines = prologue(info);
    if (isFn(fn) && (fn.body.type === 'BlockStatement' || !lines.length)) return renderNode(fn, shift);
    if (!lines.length) return renderNode(fn, 0);
    const last = isFn(fn) ? `return ${renderNode(fn.body, shift)};` : `return ${renderNode(fn, 0)}(ctx);`;
    return `async (ctx) => {\n${[...lines, last].map((l) => pad(col + 2) + l).join('\n')}\n${pad(col)}}`;
  }

  function caseItem(call, col) {
    const info = caseInfo.get(call);
    const inner = col + 2;
    const lines = [`name: ${nameText(info)},`];
    if (info.opts && info.opts.type === 'ObjectExpression') {
      for (const p of info.opts.properties) {
        lines.push(p.shorthand ? `${p.key.name},` : `${p.key.name}: ${renderNode(p.value, inner - lineIndent(p.value.start))},`);
      }
    } else if (info.opts) lines.push(`...${renderNode(info.opts, 0)},`);
    lines.push(`run: ${runText(info, inner)},`);
    return `{\n${lines.map((l) => pad(inner) + l).join('\n')}\n${pad(col)}}`;
  }

  // A block of statements run once at load, its cases collected into an array.
  function iifeText(start, end, baseIndent, col) {
    const body = render(start, end, col + 2 - baseIndent).trimEnd();
    const v = casesVar();
    return `...(() => {\n${pad(col + 2)}const ${v} = [];\n${pad(col + 2)}${body}\n${pad(col + 2)}return ${v};\n${pad(col)}})()`;
  }

  function describeItems(call, col) {
    const { fn, dynamic } = describeInfo.get(call);
    if (dynamic) {
      const start = fn.body.start + 1 + /^\s*/.exec(source.slice(fn.body.start + 1))[0].length;
      return [iifeText(start, fn.body.end - 1, lineIndent(start), col)];
    }
    return fn.body.body.flatMap((stmt) => stmtItems(stmt, col));
  }

  function stmtItems(stmt, col) {
    const call = stmtCall(stmt);
    const role = call && roleOf(call);
    if (role !== 'case' && role !== 'describe') {
      return [iifeText(commentStart(stmt), stmt.end, lineIndent(stmt.start), col)];
    }
    const own = role === 'case' ? [caseItem(call, col)] : describeItems(call, col);
    if (own.length) own[0] = leadingText(stmt, col) + own[0];
    return own;
  }

  function hookKey(key, hooks) {
    const fnText = (h, col) => renderNode(h.fn, isFn(h.fn) ? col - lineIndent(h.fn.start) : 0);
    if (hooks.length === 1) return `${pad(2)}${leadingText(hooks[0].stmt, 2)}${key}: ${fnText(hooks[0], 2)},`;
    const calls = hooks.map((h) => `${pad(4)}${leadingText(h.stmt, 4)}await (${fnText(h, 4)})(${h.takesCtx ? 'ctx' : ''});`);
    return `${pad(2)}${key}: async (ctx) => {\n${calls.join('\n')}\n${pad(2)}},`;
  }

  // ─── Run ───

  planStatements(ast.body, [top], 'top', 0);

  walk(ast, (node, parent) => {
    if (!isReference(node, parent) || consumed.has(node) || importIds.has(node)) return;
    if (!bindings.has(node.name) && node.name !== assertName) return;
    if (isShadowed(node, node.name)) return;
    const member = parent.type === 'MemberExpression' && parent.object === node && !parent.computed ? `.${parent.property.name}` : '';
    const where = node.name === assertName ? ' outside a case' : '';
    refuse(`${node.name}${member}${member ? '' : '(...)'}${where}`, node);
  });

  seal();

  const description = path.basename(file).replace(/\.test\.js$/, '');
  const exportsLines = ['module.exports = defineCases({', "  type: 'group',", `  description: ${quote(description)},`];
  if (topHooks.before.length) exportsLines.push(hookKey('setup', topHooks.before));
  if (topHooks.after.length) exportsLines.push(hookKey('cleanup', topHooks.after));
  const itemTexts = items.flatMap((stmt) => stmtItems(stmt, 4)).map((t) => `${pad(4)}${t},`);
  exportsLines.push('  tests: [', itemTexts.join('\n\n'), '  ],', '});');

  const output = `${render(0, source.length, 0).trimEnd()}\n\n${exportsLines.join('\n')}\n`;
  try {
    parse(output);
  } catch (e) {
    throw new Error(`${file}: the converted text does not parse (${e.message}); this is a converter bug`);
  }
  return output;
}

/**
 * The CLI: convert (or, with `--check`, judge) every suite under the given paths.
 * @param {string[]} argv - Paths and flags.
 * @returns {number} The exit code: 0 clean, 1 a `--check` that would change a file, 2 a refusal.
 */
function main(argv) {
  const check = argv.includes('--check');
  const targets = argv.filter((arg) => arg !== '--check');
  if (!targets.length || targets.some((arg) => arg.startsWith('--'))) {
    console.error('usage: node scripts/convert-suites.js <path>... [--check]');
    return 2;
  }
  const missing = targets.find((target) => !fs.existsSync(target));
  if (missing) {
    console.error(`usage: node scripts/convert-suites.js <path>... [--check] (no such path: ${missing})`);
    return 2;
  }
  // A directory is read the way the runner discovers it: `_`- and `.`-prefixed names are never suites.
  const files = targets.flatMap((target) => (fs.statSync(target).isDirectory() ? findTestFiles(target) : [target]));
  let changed = 0;
  let refused = 0;
  files.forEach((file, index) => {
    const source = fs.readFileSync(file, 'utf8');
    let output;
    try {
      output = convertSource(source, file);
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      refused += 1;
      console.error(`[${index + 1}/${files.length}] refused ${file}: ${e.message}`);
      return;
    }
    if (output === source) return;
    changed += 1;
    if (check) {
      console.log(`[${index + 1}/${files.length}] would change ${file}`);
      return;
    }
    fs.writeFileSync(file, output);
    console.log(`[${index + 1}/${files.length}] converted ${file}`);
  });
  const unchanged = files.length - changed - refused;
  console.log(`convert-suites: ${changed} ${check ? 'would change' : 'converted'}, ${unchanged} unchanged, ${refused} refused`);
  if (refused) return 2;
  return check && changed ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { convertSource, main };
