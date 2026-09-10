/**
 * "Does this project declare everything its sources require?" The migrate
 * report's dependency-resolution scan ([#600](https://github.com/Omega-JS-Stack/omega/issues/600)).
 *
 * Under the legacy FLAT install every framework dependency sat in the
 * consumer's own `node_modules`, so a ported file could `require('fs-jetpack')`
 * and be right. Under OMEGA the framework is a package with its own tree, and a
 * bare require of something the consumer never declared resolves only by
 * HOISTING, which holds on one install and not on the next. The requires that
 * carried this were LAZY (inside the function that needs them), so the module
 * loads fine and the code 500s the first time it actually runs.
 *
 * REPORT ONLY, and by the consumer's own manifest: every bare specifier under
 * the scanned tree that is neither a Node built-in, nor an alias the caller's
 * framework resolves, nor a declared dependency, named file:line with the fix
 * (declare it). Never an auto-install: which package version a brand wants is
 * the brand's call.
 *
 * It lives HERE because both frameworks whose consumers were ported need it,
 * and the answer must not differ between them: @omega.js/web's `omega migrate`
 * and @omega.js/backend's `omega migrate` each pass their own alias list and
 * read the same verdict. Stdlib-only, like every vendorable module.
 */
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

// Both spellings of every built-in: `require('fs')` and `require('node:fs')`.
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

const REQUIRE_CALL = /\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g;

// Build output, vendored trees and the archive dirs a port leaves behind: none
// of them is source this project ships, and scanning them reports findings
// nobody can act on.
const SKIP_DIRS = ['node_modules', 'dist', '_site', '_legacy', '_backup', '.git'];

// The dependency fields npm resolves a bare specifier from at RUNTIME or in a
// build. A peer the consumer declares is installed beside it like any other.
const MANIFEST_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * The PACKAGE a specifier resolves to: `@scope/name` keeps two segments,
 * everything else keeps one, and the subpath is not the dependency.
 *
 * @param {string} specifier
 * @returns {string}
 */
function packageName(specifier) {
  const segments = specifier.split('/');

  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

/**
 * Every `.js` file under a dir, build output and archive dirs skipped.
 *
 * @param {string} dir
 * @returns {string[]} Absolute paths, sorted.
 */
function collectScriptFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.includes(entry.name)) walk(full);
        continue;
      }

      if (entry.isFile() && path.extname(entry.name) === '.js') files.push(full);
    }
  };

  if (fs.existsSync(dir)) walk(dir);

  return files.sort();
}

/**
 * Every package name the consumer's own package.json declares.
 *
 * @param {string} root - Consumer project root.
 * @returns {Set<string>|null} null when there is no manifest to judge against.
 */
function declaredPackages(root) {
  const manifestPath = path.join(root, 'package.json');
  if (!fs.existsSync(manifestPath)) return null;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null; // an unparseable manifest says nothing about what is declared
  }

  const declared = new Set();
  for (const field of MANIFEST_FIELDS) {
    for (const name of Object.keys(manifest[field] || {})) declared.add(name);
  }

  return declared;
}

/**
 * Scan a consumer's sources for bare requires of packages it does not declare.
 *
 * @param {string} root - Consumer project root (the manifest is judged from here).
 * @param {object} [options]
 * @param {string[]} [options.aliases] - Package names the framework RESOLVES for
 *   the consumer (a bundler alias, a runtime the framework owns). None is a
 *   dependency a consumer may declare, so naming one would hand the report a
 *   fix that breaks the project.
 * @param {string} [options.srcDir] - The tree to scan, relative to root. Defaults to `src`.
 * @returns {Array<{ file: string, line: number, module: string, fix: string }>}
 *   One entry per file+package, at its first sighting.
 */
function collectBareRequires(root, options = {}) {
  const aliases = options.aliases || [];
  const declared = declaredPackages(root);
  if (!declared) return [];

  const found = [];
  for (const filePath of collectScriptFiles(path.join(root, options.srcDir || 'src'))) {
    const source = fs.readFileSync(filePath, 'utf8');
    const seen = new Set();

    REQUIRE_CALL.lastIndex = 0;
    let match;
    while ((match = REQUIRE_CALL.exec(source)) !== null) {
      const specifier = match[2];
      if (specifier.startsWith('.') || specifier.startsWith('/')) continue; // a path, not a package
      if (BUILTINS.has(specifier)) continue;

      const name = packageName(specifier);
      if (aliases.includes(name)) continue;
      if (declared.has(name) || seen.has(name)) continue;
      seen.add(name);

      found.push({
        file: path.relative(root, filePath),
        line: source.slice(0, match.index).split('\n').length,
        module: name,
        fix: `add it to this project's package.json (\`npm install ${name}\`), it resolved through the legacy flat install and resolves under OMEGA only by hoisting`,
      });
    }
  }

  return found;
}

module.exports = { collectBareRequires, packageName };
