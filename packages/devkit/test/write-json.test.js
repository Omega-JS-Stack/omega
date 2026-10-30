/**
 * write-json tests: the family's ONE JSON writer. Its bytes are the contract
 * every manifest, lock and config file on disk shares (two-space JSON, exactly
 * one trailing newline), and the production trees reach disk through it alone.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// acorn resolves from the monorepo root's devDependencies only; devkit declares it nowhere.
const acorn = require('acorn');

const { writeJson } = require('@omega.js/devkit/write-json');

const PACKAGES_DIR = path.join(__dirname, '..', '..');
const WRITER = path.join(PACKAGES_DIR, 'devkit', 'src', 'write-json.js');

// Tests and fixtures stand in for consumer code; build output and installs are not source.
const EXEMPT_PATH = /(^|\/)(test|tests|fixtures|__fixtures__|node_modules|dist|vendor)(\/|$)/;

// Writers of files that are not JSON documents, so writeJson is not theirs.
const NOT_JSON_DOCUMENTS = new Set([
  'backend/src/cli/commands/logs.js', // appends JSON Lines, one record per line
  'desktop/src/gulp/tasks/sass.js', // writes compact source maps (.map)
]);

// The calls that put bytes on disk: node's fs family by name, fs-jetpack's by its receiver.
const FS_WRITERS = new Set(['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile']);
const JETPACK_WRITERS = new Set(['write', 'writeAsync', 'append', 'appendAsync']);

// Every production source file: packages/*/src and web's browser runtime under core/.
function productionFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (EXEMPT_PATH.test(path.relative(PACKAGES_DIR, full))) continue;
      if (entry.isDirectory()) walk(full);
      else if (/\.[cm]?js$/.test(entry.name)) files.push(full);
    }
  };
  for (const pkg of fs.readdirSync(PACKAGES_DIR)) {
    for (const tree of ['src', 'core']) {
      const dir = path.join(PACKAGES_DIR, pkg, tree);
      if (fs.existsSync(dir)) walk(dir);
    }
  }
  return files;
}

// Module syntax first; a CommonJS file using `package` as a name parses as a script.
function parse(source) {
  const options = { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, locations: true };
  try {
    return acorn.parse(source, { ...options, sourceType: 'module' });
  } catch {
    return acorn.parse(source, { ...options, sourceType: 'script' });
  }
}

function visit(node, see) {
  if (!node || typeof node.type !== 'string') return;
  see(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => visit(child, see));
    else if (value && typeof value.type === 'string') visit(value, see);
  }
}

const isStringify = (node) => node.type === 'CallExpression'
  && node.callee.type === 'MemberExpression'
  && node.callee.object.name === 'JSON'
  && node.callee.property.name === 'stringify';

// Every disk write in one file whose arguments build their text with JSON.stringify.
function stringifiedWrites(file) {
  const source = fs.readFileSync(file, 'utf8');
  const hits = [];
  visit(parse(source), (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee;
    const name = callee.type === 'MemberExpression' ? callee.property.name : callee.name;
    const receiver = callee.type === 'MemberExpression' ? source.slice(callee.object.start, callee.object.end) : '';
    const writes = FS_WRITERS.has(name) || (JETPACK_WRITERS.has(name) && /jetpack/i.test(receiver));
    if (!writes) return;
    let stringified = false;
    node.arguments.forEach((argument) => visit(argument, (inner) => { stringified = stringified || isStringify(inner); }));
    if (stringified) hits.push(`${path.relative(PACKAGES_DIR, file)}:${node.loc.start.line}`);
  });
  return hits;
}

module.exports = defineCases({
  type: 'group',
  description: 'write-json',
  tests: [
    {
      name: 'writeJson writes two-space JSON ending in exactly one newline',
      run: (ctx) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-write-json-'));
        ctx.after(() => fs.rmSync(dir, { recursive: true, force: true }));
        const file = path.join(dir, 'package.json');

        writeJson(file, { name: 'consumer', files: ['src/'], engines: { node: '>=24' } });

        ctx.expect(fs.readFileSync(file, 'utf8')).toBe([
          '{',
          '  "name": "consumer",',
          '  "files": [',
          '    "src/"',
          '  ],',
          '  "engines": {',
          '    "node": ">=24"',
          '  }',
          '}',
          '',
        ].join('\n'));
      },
    },

    {
      name: 'no production file writes JSON.stringify to disk but write-json.js',
      run: (ctx) => {
        const offenders = productionFiles()
          .filter((file) => file !== WRITER && !NOT_JSON_DOCUMENTS.has(path.relative(PACKAGES_DIR, file)))
          .flatMap(stringifiedWrites);

        ctx.expect(offenders, `route these writes through @omega.js/devkit/write-json:\n${offenders.join('\n')}`).toEqual([]);
      },
    },
  ],
});
