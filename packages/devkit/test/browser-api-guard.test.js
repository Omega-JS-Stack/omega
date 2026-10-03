/**
 * The browser-floor API guard: esbuild lowers syntax to the floor but adds no
 * missing API, so every browser API newer than the floor (NEWER_BROWSER_APIS,
 * beside the floor constant) must be feature-checked where it is used. A use
 * counts as guarded when its own statement, or an enclosing `if` condition,
 * holds `typeof <api>` or `'<name>' in` on its own object, or `?.` on it.
 * Static, the house pattern of packages/web/test/config-reads-guard.test.js.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');

const { NEWER_BROWSER_APIS } = require('../src/browser-floor.js');

const MONOREPO = path.join(__dirname, '..', '..', '..');

// The browser-side roots, each a tracked path walked recursively. Desktop's
// preload and renderer are files: the rest of desktop/src is the main process.
const BROWSER_SOURCES = [
  'packages/client/src',
  'packages/web/core/js',
  'packages/web/sw',
  'packages/extension/src',
  'packages/extension/src/defaults/src/assets/js',
  'packages/desktop/src/preload.js',
  'packages/desktop/src/renderer.js',
  'packages/desktop/src/lib/logger-lite.js',
  'packages/desktop/src/utils/mode-helpers.js',
  'packages/desktop/src/utils/url-helpers.js',
  'packages/desktop/src/assets/js',
  'packages/desktop/src/defaults/src/assets/js',
];

// Paths under a root that are not browser source: the extension's Node side
// (CLI, gulp, build module, scaffold) and a vendored prebuilt bundle.
const EXCLUDED = new Set([
  'packages/extension/src/build.js',
  'packages/extension/src/cli-run.js',
  'packages/extension/src/cli.js',
  'packages/extension/src/index.js',
  'packages/extension/src/omega-bin.js',
  'packages/extension/src/commands',
  'packages/extension/src/config',
  'packages/extension/src/gulp',
  'packages/extension/src/defaults',
  'packages/desktop/src/assets/js/bootstrap.bundle.js',
]);

// `test` is a harness everywhere but web's core/js, where `pages/test/` is
// shipped demo pages.
const SKIPPED_DIRS = new Set(['dist', 'vendor', 'node_modules', 'test']);
const SHIPPED_TEST_DIRS = new Set(['packages/web/core/js/pages/test']);
const SOURCE_FILE = /\.(?:js|mjs|cjs)$/;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The API's own text, without a call's `(`: `AbortSignal.timeout`, `.at`.
function coreOf(api) {
  return api.pattern.replace(/\($/, '');
}

// Every use of the API's search text, bounded where it starts or ends on a
// name character so `WeakRef` does not match `WeakRefs`.
function usePattern(api, flags) {
  const head = /^[\w$]/.test(api.pattern) ? '(?<![\\w$])' : '';
  const tail = /[\w$]$/.test(api.pattern) ? '(?![\\w$])' : '';
  return new RegExp(`${head}${escapeRegex(api.pattern)}${tail}`, flags);
}

// `?.` straight after the API's own text.
function isOptional(text, index, api) {
  return text.startsWith('?.', index + coreOf(api).length);
}

// The objects an `in` check (and a method's `typeof`) must name, as a regex
// alternation: the pattern's owner (`AbortSignal`), a method's receiver at the
// use or any prototype, or the global for a bare name.
function inObjects(api, receiver) {
  const core = coreOf(api);
  const dot = core.lastIndexOf('.');
  if (dot > 0) return escapeRegex(core.slice(0, dot));
  if (dot === 0) return [receiver && escapeRegex(receiver), '[\\w$]+\\.prototype'].filter(Boolean).join('|');
  return 'window|globalThis|self';
}

// True when the text holds a feature check on the API: `typeof <api>` (a
// method's on its receiver or a prototype), `'<name>' in <its object>`
// (`'on<name>'` for an event), or `?.` on it.
function holdsGuard(text, api, receiver) {
  const core = escapeRegex(coreOf(api));
  const name = escapeRegex(api.name.split('.').pop());
  const objects = inObjects(api, receiver);
  const typeofHead = api.pattern.startsWith('.') ? `(?<![\\w$.])(?:${objects})` : '[\\w$.\\[\\]]*?';
  if (new RegExp(`\\btypeof\\s+\\(?\\s*${typeofHead}${core}(?![\\w$])`).test(text)) return true;
  if (new RegExp(`['"](?:on)?${name}['"]\\s+in\\s+(?:${objects})(?![\\w$.])`).test(text)) return true;
  return [...text.matchAll(new RegExp(core, 'g'))].some((match) => isOptional(text, match.index, api));
}

// A full-line comment, or a trailing `//` comment that starts before the match.
function inComment(source, index) {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  const before = source.slice(lineStart, index);
  return /^\s*(?:\/\/|\/\*|\*)/.test(before) || /(?:^|[\s;,)])\/\//.test(before);
}

// The statement holding the match: back to the last `;`, `{` or `}`, and on
// to the next one.
function statementAround(source, start, end) {
  const from = Math.max(source.lastIndexOf(';', start), source.lastIndexOf('{', start), source.lastIndexOf('}', start)) + 1;
  const ahead = source.slice(end).search(/[;{}]/);
  return source.slice(from, ahead === -1 ? source.length : end + ahead);
}

// The condition of every `if` whose block encloses the index, innermost first.
function enclosingIfConditions(source, index) {
  const conditions = [];
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (source[i] === '}') depth += 1;
    else if (source[i] === '{' && depth > 0) depth -= 1;
    else if (source[i] === '{') {
      const header = source.slice(0, i).trimEnd();
      if (!header.endsWith(')')) continue;
      let parens = 0;
      let open = header.length - 1;
      for (; open >= 0; open -= 1) {
        if (header[open] === ')') parens += 1;
        else if (header[open] === '(') parens -= 1;
        if (parens === 0) break;
      }
      if (/\bif\s*$/.test(header.slice(0, open))) conditions.push(header.slice(open + 1, header.length - 1));
    }
  }
  return conditions;
}

/**
 * Every unguarded use of a listed API in one source.
 * @param {string} source - the file's text
 * @param {string} file - the name a finding carries
 * @param {{ name: string, pattern: string }[]} apis - the newer-than-floor APIs
 * @returns {{ file: string, line: number, api: string }[]}
 */
function unguardedUses(source, file, apis) {
  const findings = [];
  for (const api of apis) {
    for (const match of source.matchAll(usePattern(api, 'g'))) {
      if (inComment(source, match.index) || isOptional(source, match.index, api)) continue;
      const receiver = source.slice(0, match.index).match(/[\w$]+(?:\.[\w$]+)*$/)?.[0];
      if (holdsGuard(statementAround(source, match.index, match.index + match[0].length), api, receiver)) continue;
      if (enclosingIfConditions(source, match.index).some((condition) => holdsGuard(condition, api, receiver))) continue;
      findings.push({ file, line: source.slice(0, match.index).split('\n').length, api: api.name });
    }
  }
  return findings;
}

function describeFinding(finding) {
  return `${finding.file}:${finding.line} uses ${finding.api} with no feature check (guard it with typeof, 'name' in, or ?.)`;
}

function sourceFiles(abs, found = []) {
  if (!fs.statSync(abs).isDirectory()) {
    found.push(abs);
    return found;
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(abs, entry.name);
    const rel = path.relative(MONOREPO, child);
    if (EXCLUDED.has(rel)) continue;
    if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name) && !SHIPPED_TEST_DIRS.has(rel)) continue;
    if (entry.isDirectory()) sourceFiles(child, found);
    else if (SOURCE_FILE.test(entry.name)) found.push(child);
  }
  return found;
}

module.exports = { unguardedUses, describeFinding };

module.exports = defineCases({
  type: 'group',
  description: 'browser-api-guard',
  tests: [
    {
      name: 'an unguarded use fails naming the file, the line and the API; the enclosing typeof check passes it',
      run: (ctx) => {
        const unguarded = [
          'export function signalFor(ms) {',
          '  const fallback = null;',
          '  return AbortSignal.timeout(5);',
          '}',
          '',
        ].join('\n');
        const guarded = [
          'export function signalFor(ms) {',
          "  if (typeof AbortSignal.timeout === 'function') {",
          '    return AbortSignal.timeout(5);',
          '  }',
          '  const controller = new AbortController();',
          '  setTimeout(() => controller.abort(), ms);',
          '  return controller.signal;',
          '}',
          '',
        ].join('\n');

        const findings = unguardedUses(unguarded, 'fixture.js', NEWER_BROWSER_APIS);
        ctx.expect(findings).toEqual([{ file: 'fixture.js', line: 3, api: 'AbortSignal.timeout' }]);
        ctx.expect(describeFinding(findings[0]).startsWith('fixture.js:3 uses AbortSignal.timeout')).toBe(true);

        ctx.expect(unguardedUses(guarded, 'fixture.js', NEWER_BROWSER_APIS)).toEqual([]);
      },
    },

    {
      name: "an `in` check on some other object is no guard: 'timeout' in options still fails",
      run: (ctx) => {
        const source = [
          'export function signalFor(options) {',
          "  if ('timeout' in options) {",
          '    return AbortSignal.timeout(options.timeout);',
          '  }',
          '}',
          '',
        ].join('\n');

        ctx.expect(unguardedUses(source, 'fixture.js', NEWER_BROWSER_APIS)).toEqual([
          { file: 'fixture.js', line: 3, api: 'AbortSignal.timeout' },
        ]);
      },
    },

    {
      name: "an `in` check on the API's own object passes: its owner, the receiver, a prototype or the global",
      run: (ctx) => {
        const source = [
          "if ('timeout' in AbortSignal) {",
          '  AbortSignal.timeout(5);',
          '}',
          "if ('at' in items) {",
          '  items.at(-1);',
          '}',
          "if ('at' in Array.prototype) {",
          '  list.at(0);',
          '}',
          "if ('structuredClone' in window) {",
          '  structuredClone(value);',
          '}',
          "if ('at' in other) {",
          '  items.at(-1);',
          '}',
          '',
        ].join('\n');

        ctx.expect(unguardedUses(source, 'fixture.js', NEWER_BROWSER_APIS)).toEqual([
          { file: 'fixture.js', line: 14, api: 'Array.prototype.at' },
        ]);
      },
    },

    {
      name: 'a method typeof check guards only its own receiver or a prototype: typeof other.at does not guard items.at(',
      run: (ctx) => {
        const source = [
          "if (typeof other.at === 'function') {",
          '  items.at(-1);',
          '}',
          "if (typeof items.at === 'function') {",
          '  items.at(-1);',
          '}',
          "if (typeof Array.prototype.at === 'function') {",
          '  list.at(0);',
          '}',
          '',
        ].join('\n');

        ctx.expect(unguardedUses(source, 'fixture.js', NEWER_BROWSER_APIS)).toEqual([
          { file: 'fixture.js', line: 2, api: 'Array.prototype.at' },
        ]);
      },
    },

    {
      name: 'every newer API in the browser sources is guarded or absent',
      run: (ctx) => {
        const findings = [];
        let scanned = 0;
        for (const root of BROWSER_SOURCES) {
          const abs = path.join(MONOREPO, root);
          ctx.expect(fs.existsSync(abs), `${root} is listed as a browser source but does not exist`).toBeTruthy();
          for (const file of sourceFiles(abs)) {
            scanned += 1;
            findings.push(...unguardedUses(fs.readFileSync(file, 'utf8'), path.relative(MONOREPO, file), NEWER_BROWSER_APIS));
          }
        }

        ctx.expect(scanned > 0, 'the guard must actually read sources').toBeTruthy();
        ctx.expect(findings, findings.map(describeFinding).join('\n')).toEqual([]);
      },
    },
  ],
});
