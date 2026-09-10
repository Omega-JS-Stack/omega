/**
 * Test: the framework suite that ships is the framework suite that RUNS
 * ([#720](https://github.com/Omega-JS-Stack/omega/issues/720))
 *
 * @omega.js/backend ships its corpus as raw source (`files` lists `test/` beside
 * `dist/`), so a consumer's `npx omega test mgr:` loads these very files out of
 * node_modules. Two things break there and nowhere else:
 *
 *   - a require of a path the tarball does not carry (`../../src/...` — only
 *     `dist/` ships, and it mirrors src 1:1)
 *   - a bare require of a devDependency (`@omega.js/devkit`, `@omega.js/config`
 *     and friends NEVER publish — their modules ride along vendored under
 *     `dist/vendor/`)
 *
 * Both are invisible in the monorepo, where src/ is on disk and the workspace
 * resolves every @omega.js package. So the suite audits ITSELF here: every
 * require and every package-relative path literal in test/ must land on
 * something the published package actually carries.
 *
 * The shipped set comes from the package's own `files` list, not from a pack
 * run — `npm pack` runs `prepare`, which purges and rebuilds dist/ underneath
 * the suite that is reading it.
 *
 * Run: npx omega test backend:boot/suite-portability
 */
const path = require('path');
const { isBuiltin } = require('node:module');
const jetpack = require('fs-jetpack');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const PACKAGE_DIR = path.join(__dirname, '..', '..');
const TEST_DIR = path.join(PACKAGE_DIR, 'test');
const MANIFEST = jetpack.read(path.join(PACKAGE_DIR, 'package.json'), 'json');

const RUNTIME_DEPENDENCIES = {
  ...(MANIFEST.dependencies || {}),
  ...(MANIFEST.peerDependencies || {}),
  ...(MANIFEST.optionalDependencies || {}),
};

// Every require/require.resolve with a literal specifier. The leading class
// keeps the match off requires that live INSIDE a string — test/helpers/
// settings.test.js writes `'require("a-package-that-does-not-exist");'` as
// fixture SOURCE, which is not a dependency of the suite.
const REQUIRE_CALL = /(?:^|[^'"`\w.])require(?:\.resolve)?\(\s*(['"])([^'"]+)\1\s*\)/g;

// The same call with a backtick specifier. An interpolated one resolves to a
// name only at runtime (`require(`../../dist/…/${name}.js`)`), but everything
// before the first `${` is static — and THAT directory has to ship.
const TEMPLATE_REQUIRE = /(?:^|[^'"`\w.])require(?:\.resolve)?\(\s*`([^`]+)`\s*\)/g;

// Any string literal, in any quote style, plus the shape of one that names the
// package's own source tree — the tarball ships dist/ (a 1:1 mirror), never src/.
const STRING_LITERAL = /(['"`])([^'"`\n]*)\1/g;
const SRC_LITERAL = /^(\.\.\/)*src\//;

// A path.join/path.resolve whose arguments are all string literals after a
// __dirname-rooted base — the other way a test file names a file in the package
// (`path.join(__dirname, '..', '..', 'src', ...)`), which no require regex sees.
const PATH_CALL = /path\.(?:join|resolve)\(\s*([A-Za-z_$][\w$]*)\s*,([^()]*)\)/g;

// File-local constants that are themselves __dirname-rooted, so a call through
// one (`path.join(PACKAGE_DIR, 'src', ...)`) resolves like a direct __dirname call.
const ROOT_CONSTANT = /const\s+([A-Za-z_$][\w$]*)\s*=\s*path\.(?:join|resolve)\(\s*__dirname\s*,([^()]*)\)/g;

const LITERAL = /^(['"])(.*)\1$/;

// npm packs these whatever `files` says, so a test may read them freely.
const ALWAYS_SHIPPED = /^(package\.json|README(\..*)?|LICEN[CS]E(\..*)?)$/i;

function testFiles() {
  return jetpack.find(TEST_DIR, { matching: '**/*.js' }).map((file) => path.resolve(file));
}

// Source lines that carry code. A require or a path.join inside JSDoc prose is
// documentation, not a dependency (devkit's vendor tool learned the same bite).
function codeLines(file) {
  return (jetpack.read(file) || '')
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
    });
}

// Split a path.join argument list into its literal parts, or null when any
// argument is an expression (a template literal, a variable) — an unresolvable
// call is not a finding.
function literalParts(args) {
  const parts = [];
  for (const argument of args.split(',')) {
    const trimmed = argument.trim();
    if (!trimmed) continue;
    const match = LITERAL.exec(trimmed);
    if (!match) return null;
    parts.push(match[2]);
  }
  return parts;
}

// The __dirname-rooted bases a file can resolve a path against: __dirname
// itself plus every file-local constant derived from it.
function rootsFor(file) {
  const roots = new Map([['__dirname', path.dirname(file)]]);
  for (const match of (jetpack.read(file) || '').matchAll(ROOT_CONSTANT)) {
    const parts = literalParts(match[2]);
    if (parts) roots.set(match[1], path.resolve(path.dirname(file), ...parts));
  }
  return roots;
}

// Does the published package carry this path? `files` is the SSOT: an entry is
// a shipped root, and the package root itself (the ancestor of every root) counts.
function ships(absolute) {
  const relative = path.relative(PACKAGE_DIR, absolute).split(path.sep).join('/');
  if (relative === '') return true;
  if (!jetpack.exists(absolute)) return false;
  if (ALWAYS_SHIPPED.test(relative)) return true;

  return (MANIFEST.files || []).some((entry) => {
    const root = entry.replace(/\/$/, '');
    return relative === root || relative.startsWith(`${root}/`) || root.startsWith(`${relative}/`);
  });
}

// Resolve a relative specifier the way require does: as written, then .js, then /index.js.
function resolveRequire(fromDir, specifier) {
  const base = path.resolve(fromDir, specifier);
  return [base, `${base}.js`, path.join(base, 'index.js')].find((candidate) => jetpack.exists(candidate) === 'file');
}

// The static leading segment of a specifier: everything before the first `${`,
// or the whole thing when it carries no interpolation.
function staticPrefix(specifier) {
  return specifier.split('${')[0];
}

// The directory a specifier lands in. Appending a placeholder segment makes the
// static prefix name a file inside that directory whether or not it ends in a separator.
function staticDirectory(fromDir, specifier) {
  return path.dirname(path.resolve(fromDir, `${staticPrefix(specifier)}#`));
}

module.exports = defineCases({
  description: 'The shipped test suite resolves inside the published package',
  type: 'group',

  tests: [
    {
      name: 'the-suite-and-its-targets-are-listed-in-files',
      async run({ assert }) {
        // Everything below reads `files` as the shipped set; these two entries
        // are what make the suite runnable from an install at all.
        for (const entry of ['test/', 'dist/']) {
          assert.equal((MANIFEST.files || []).includes(entry), true, `package.json files must list ${entry}`);
        }
      },
    },

    {
      name: 'relative-requires-resolve-inside-the-published-package',
      async run({ assert }) {
        const failures = [];

        for (const file of testFiles()) {
          for (const { line, number } of codeLines(file)) {
            for (const match of line.matchAll(REQUIRE_CALL)) {
              const specifier = match[2];
              if (!specifier.startsWith('.')) continue;

              const resolved = resolveRequire(path.dirname(file), specifier);
              if (!resolved) {
                failures.push(`${path.relative(PACKAGE_DIR, file)}:${number} requires '${specifier}', which does not resolve`);
              } else if (!ships(resolved)) {
                failures.push(`${path.relative(PACKAGE_DIR, file)}:${number} requires '${specifier}' → ${path.relative(PACKAGE_DIR, resolved)}, which the package does not ship`);
              }
            }

            for (const match of line.matchAll(TEMPLATE_REQUIRE)) {
              const specifier = match[1];
              if (!specifier.startsWith('.')) continue;

              const directory = staticDirectory(path.dirname(file), specifier);
              if (!ships(directory)) {
                failures.push(`${path.relative(PACKAGE_DIR, file)}:${number} requires \`${specifier}\` out of ${path.relative(PACKAGE_DIR, directory)}, which the package does not ship`);
              }
            }
          }
        }

        assert.equal(failures.length, 0, `Requires that break in a consumer install:\n  ${failures.join('\n  ')}`);
      },
    },

    {
      name: 'bare-requires-are-builtins-or-runtime-dependencies',
      async run({ assert }) {
        const failures = [];

        for (const file of testFiles()) {
          for (const { line, number } of codeLines(file)) {
            for (const match of line.matchAll(REQUIRE_CALL)) {
              const specifier = match[2];
              if (specifier.startsWith('.') || specifier.startsWith('/')) continue;

              const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
              if (isBuiltin(name) || RUNTIME_DEPENDENCIES[name]) continue;

              failures.push(`${path.relative(PACKAGE_DIR, file)}:${number} requires '${specifier}', which is not a builtin or a runtime dependency`);
            }
          }
        }

        assert.equal(failures.length, 0, `Requires that break in a consumer install:\n  ${failures.join('\n  ')}`);
      },
    },

    {
      name: 'package-relative-path-literals-point-at-shipped-files',
      async run({ assert }) {
        const failures = [];

        for (const file of testFiles()) {
          const roots = rootsFor(file);

          for (const { line, number } of codeLines(file)) {
            for (const match of line.matchAll(PATH_CALL)) {
              const root = roots.get(match[1]);
              if (!root) continue;

              const parts = literalParts(match[2]);
              if (!parts) continue;

              // Paths that stay inside test/ are fixtures and temp trees, which
              // the suite creates for itself — only what it reaches OUT to must ship.
              const resolved = path.resolve(root, ...parts);
              if (resolved.startsWith(`${TEST_DIR}${path.sep}`)) continue;

              if (!ships(resolved)) {
                failures.push(`${path.relative(PACKAGE_DIR, file)}:${number} reads ${path.relative(PACKAGE_DIR, resolved)}, which the package does not ship`);
              }
            }
          }
        }

        assert.equal(failures.length, 0, `Paths that break in a consumer install:\n  ${failures.join('\n  ')}`);
      },
    },

    {
      name: 'no-string-literal-names-the-source-tree',
      async run({ assert }) {
        const failures = [];

        for (const file of testFiles()) {
          for (const { line, number } of codeLines(file)) {
            for (const match of line.matchAll(STRING_LITERAL)) {
              const literal = match[2];
              if (!SRC_LITERAL.test(literal)) continue;

              // Resolve it the way its file would: a `../` literal is relative
              // to the file, a bare `src/` one is package-rooted. One that names
              // nothing on disk here is not a path into this package at all —
              // it is prose, or a path in the CONSUMER's repo (`src/_posts/…`).
              const from = literal.startsWith('..') ? path.dirname(file) : PACKAGE_DIR;
              if (!jetpack.exists(path.resolve(from, staticPrefix(literal)))) continue;

              failures.push(`${path.relative(PACKAGE_DIR, file)}:${number} names '${literal}', and only dist/ ships`);
            }
          }
        }

        assert.equal(failures.length, 0, `Paths that break in a consumer install:\n  ${failures.join('\n  ')}`);
      },
    },
  ],
});
