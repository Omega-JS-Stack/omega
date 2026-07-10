// Vendors private @omegajs workspace packages (devkit, account, ...) into a
// framework's dist/ so published tarballs are self-contained (the shared packages
// never ship to npm).
//
// Wired as the framework's prepare-package `after` hook:
//   "preparePackage": { "hooks": { "after": "node -e \"require('@omegajs/devkit/vendor')()\"" } }
//
// From the framework's cwd it:
//   1. Scans dist/ for references to @omegajs packages — CommonJS (require,
//      require.resolve) AND ESM (import ... from, export ... from, dynamic
//      import(), side-effect import) — web-manager's dist is ESM. Real host
//      files only: symlinks are never followed and node_modules never entered
//      (@omegajs/backend's dist carries a self-test fixture with a circular self-link)
//   2. Copies ONLY the referenced modules (plus their transitive relative
//      requires/imports) into <dist>/vendor/<package>/ — selective, so a host
//      that uses just safe-install doesn't ship the test runner or inherit its
//      dependency requirements
//   3. Rewrites every @omegajs specifier under dist/ to a relative path into
//      the matching vendor dir
//   4. Fails if the host doesn't declare a runtime dependency the vendored modules
//      require — vendored code resolves e.g. chalk from the HOST's node_modules
//
// Package convention: every vendorable package's entry is <root>/src/index.js and
// subpath exports live beside it ('@omegajs/x/foo' → src/foo.js) — the entry's
// directory is the module root, resolved via require.resolve of the bare name.
//
// Notes:
//   - prepare-package `after` hooks are non-blocking (a failure warns but doesn't
//     stop prepare). The hard gate is CI's pack→scratch-install smoke plus its
//     "no @omegajs refs in shipped dist" check.
//   - Watch mode's single-file copies skip hooks, so a freshly-saved file can hold
//     a raw @omegajs specifier in dist. That's fine wherever dist is consumed from
//     the monorepo (workspace + file: installs resolve the packages up the tree); a
//     full prepare (npm install / pack / publish) always re-runs the rewrite.

const fs = require('fs');
const path = require('path');
const { isBuiltin } = require('node:module');
const jetpack = require('fs-jetpack');
const Logger = require('../src/logger');

const logger = new Logger('devkit-vendor');

// Specifier body shared by every reference pattern: package name + optional subpath.
const SPECIFIER = '@omegajs\\/([a-z0-9-]+)(?:\\/([A-Za-z0-9._/-]+))?';

// The ways dist code can reference an @omegajs package. Each pattern captures:
// 1 = prefix (kept verbatim on rewrite), 2 = quote, 3 = package name, 4 = subpath.
// The match ends at the closing quote, so trailing syntax (`)`, `;`) is untouched.
const REFERENCE_PATTERNS = [
  new RegExp(`(require(?:\\.resolve)?\\(\\s*)(['"])${SPECIFIER}\\2`, 'g'), // require / require.resolve
  new RegExp(`(from\\s+)(['"])${SPECIFIER}\\2`, 'g'),                      // import|export ... from
  new RegExp(`(import\\s*\\(\\s*)(['"])${SPECIFIER}\\2`, 'g'),             // dynamic import()
  new RegExp(`(import\\s+)(['"])${SPECIFIER}\\2`, 'g'),                    // side-effect import
];

// Matches relative requires/imports — used to walk package-internal dependencies.
// Group 2 = the relative path in every pattern.
const RELATIVE_PATTERNS = [
  /require\(\s*(['"])(\.{1,2}\/[^'"]+)\1/g,
  /from\s+(['"])(\.{1,2}\/[^'"]+)\1/g,
  /import\s*\(\s*(['"])(\.{1,2}\/[^'"]+)\1/g,
  /import\s+(['"])(\.{1,2}\/[^'"]+)\1/g,
];

// Matches bare-specifier requires/imports (anything not starting with . or /) —
// used by the host-dependency guard on the vendored files. Group 2 = specifier.
const BARE_PATTERNS = [
  /require\(\s*(['"])([^'"./][^'"]*)\1/g,
  /from\s+(['"])([^'"./][^'"]*)\1/g,
  /import\s*\(\s*(['"])([^'"./][^'"]*)\1/g,
  /import\s+(['"])([^'"./][^'"]*)\1/g,
];

// Strip JS comments before dep-guard scanning — JSDoc prose can look exactly
// like an ESM from-clause (config/edit.js: "('brand' from brand, 'a b' from
// 'a b')" reported a phantom host dep named 'a b'). Conservative: block
// comments and // line tails (the [^:'"\`] guard keeps 'http://...' in string
// literals intact). Detection-only — never used for rewriting.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

// Map a package subpath ('' | 'logger' | 'test/assert' | 'logger.js') to its module-root-relative file.
function subpathToFile(subpath) {
  const name = subpath || 'index';
  return name.endsWith('.js') ? name : `${name}.js`;
}

// Reduce a require/import specifier to its package name ('chalk', '@scope/pkg').
function specifierToPackageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// Collect the .js files under dir that are host code: never follows symlinks
// (@omegajs/backend's self-test fixture ships a circular self-link inside a dist
// node_modules — jetpack.find follows it until ENAMETOOLONG) and never
// descends into node_modules, the vendor output, or dist/defaults (none is
// host code to scan or rewrite — defaults are consumer templates scaffolded
// into consumer projects, where @omegajs/* specifiers must survive as package
// requires; a framework's own defaults reference the framework itself, which
// would otherwise vendor the host into itself).
function findHostJsFiles(dir, vendorRoot) {
  const files = [];
  const queue = [dir];
  const defaultsRoot = path.join(dir, 'defaults');

  while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && abs !== vendorRoot && abs !== defaultsRoot) {
          queue.push(abs);
        }
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(abs);
      }
    }
  }

  return files;
}

// Locate a vendorable package's module root (the directory of its src/index.js
// entry) — resolved from the host first, falling back to devkit's own tree so
// devkit always self-resolves.
function resolvePackageRoot(name, cwd) {
  try {
    return path.dirname(require.resolve(`@omegajs/${name}`, { paths: [cwd, __dirname] }));
  } catch (error) {
    throw new Error(`[devkit vendor] Cannot resolve '@omegajs/${name}' from ${cwd} — is it a devDependency of the host?`);
  }
}

// From a seed set of module-root-relative files, follow relative requires/imports
// inside the package until closure. Returns the full set of files to vendor.
function resolveNeededFiles(name, packageRoot, seeds) {
  const needed = new Set();
  const queue = [...seeds];

  while (queue.length > 0) {
    const relative = queue.pop();
    if (needed.has(relative)) continue;

    const abs = path.join(packageRoot, relative);
    if (!jetpack.exists(abs)) {
      throw new Error(`[devkit vendor] '@omegajs/${name}' has no module '${relative}' (requested by the host or a package-internal require)`);
    }
    needed.add(relative);

    const contents = jetpack.read(abs) || '';
    for (const pattern of RELATIVE_PATTERNS) {
      for (const match of contents.matchAll(pattern)) {
        let dep = path.join(path.dirname(relative), match[2]).split(path.sep).join('/');
        if (!dep.endsWith('.js')) dep = `${dep}.js`;
        queue.push(dep);
      }
    }
  }

  return needed;
}

/**
 * Vendor the @omegajs modules a host framework actually uses into its dist and
 * rewrite the references.
 *
 * @param {object} [options]
 * @param {string} [options.cwd] - Host framework root (defaults to process.cwd())
 * @returns {{ rewritten: number, vendored: Object<string, string[]>, vendorRoot: string }}
 */
function vendorPackages(options) {
  options = options || {};
  const cwd = path.resolve(options.cwd || process.cwd());

  const hostPackage = jetpack.read(path.join(cwd, 'package.json'), 'json');
  if (!hostPackage) {
    throw new Error(`[devkit vendor] No package.json found in ${cwd}`);
  }

  const output = (hostPackage.preparePackage && hostPackage.preparePackage.output) || './dist';
  const distPath = path.resolve(cwd, output);
  if (!jetpack.exists(distPath)) {
    throw new Error(`[devkit vendor] Output dir does not exist: ${distPath} — run prepare first`);
  }

  const vendorRoot = path.join(distPath, 'vendor');

  // The host's OWN name is never a vendor candidate: files that reference the
  // host by name (boot harnesses, consumer fixtures under src/test/) run in a
  // CONSUMER context where the name resolves via the consumer's node_modules —
  // vendoring would fold the host into itself, and rewriting would break that
  // runtime resolution. Those references survive verbatim.
  const hostSelfName = (hostPackage.name || '').startsWith('@omegajs/')
    ? hostPackage.name.slice('@omegajs/'.length)
    : null;

  // 1. Scan dist for @omegajs references: which files need rewriting, which
  // modules of which packages are used.
  const seedsByPackage = new Map();
  const filesToRewrite = [];
  findHostJsFiles(distPath, vendorRoot).forEach((abs) => {
    const contents = jetpack.read(abs);
    if (!contents || !contents.includes('@omegajs/')) {
      return;
    }
    let uses = false;
    for (const pattern of REFERENCE_PATTERNS) {
      for (const match of contents.matchAll(pattern)) {
        const name = match[3];
        if (name === hostSelfName) continue;
        if (!seedsByPackage.has(name)) seedsByPackage.set(name, new Set());
        seedsByPackage.get(name).add(subpathToFile(match[4]));
        uses = true;
      }
    }
    if (uses) filesToRewrite.push(abs);
  });

  // Nothing references @omegajs — clear any stale vendor dir and exit.
  // (Everything under dist/vendor is generated by this tool, so a full reset is safe.)
  jetpack.remove(vendorRoot);
  if (seedsByPackage.size === 0) {
    logger.log(`No @omegajs references found in ${hostPackage.name} dist — nothing to vendor`);
    return { rewritten: 0, vendored: {}, vendorRoot };
  }

  // 2. Selective copy per package: seeds + transitive relative deps, nothing else.
  const vendored = {};
  for (const [name, seeds] of seedsByPackage) {
    const packageRoot = resolvePackageRoot(name, cwd);
    const needed = resolveNeededFiles(name, packageRoot, seeds);
    for (const relative of needed) {
      jetpack.copy(path.join(packageRoot, relative), path.join(vendorRoot, name, relative));
    }
    vendored[name] = [...needed].sort();
  }

  // 3. Rewrite the @omegajs references to relative paths into the vendor dirs.
  let rewritten = 0;
  filesToRewrite.forEach((abs) => {
    const contents = jetpack.read(abs);
    let updated = contents;
    for (const pattern of REFERENCE_PATTERNS) {
      updated = updated.replace(pattern, (match, prefix, quote, name, subpath) => {
        if (name === hostSelfName) return match;
        const target = path.join(vendorRoot, name, subpathToFile(subpath));
        let relative = path.relative(path.dirname(abs), target).split(path.sep).join('/');
        if (!relative.startsWith('.')) {
          relative = `./${relative}`;
        }
        return `${prefix}${quote}${relative}${quote}`;
      });
    }
    if (updated !== contents) {
      jetpack.write(abs, updated);
      rewritten += 1;
    }
  });

  // 4. Guard: every bare specifier in the vendored modules must resolve from the
  // host at consumer runtime — i.e. live in its dependencies/peerDependencies/
  // optionalDependencies.
  const hostRuntimeDeps = {
    ...(hostPackage.dependencies || {}),
    ...(hostPackage.peerDependencies || {}),
    ...(hostPackage.optionalDependencies || {}),
  };
  const missing = new Set();
  jetpack.find(vendorRoot, { matching: '**/*.js' }).forEach((file) => {
    const contents = stripComments(jetpack.read(path.resolve(file)) || '');
    for (const pattern of BARE_PATTERNS) {
      for (const match of contents.matchAll(pattern)) {
        const name = specifierToPackageName(match[2]);
        // Cross-references between @omegajs packages are never host deps —
        // leftovers in shipped dist are caught by CI's no-@omegajs-refs check.
        if (name.startsWith('@omegajs/')) {
          continue;
        }
        if (!isBuiltin(name) && !hostRuntimeDeps[name]) {
          missing.add(name);
        }
      }
    }
  });
  if (missing.size > 0) {
    throw new Error(`[devkit vendor] ${hostPackage.name} must declare runtime dependencies used by vendored modules: ${[...missing].join(', ')}`);
  }

  const summary = Object.entries(vendored).map(([name, files]) => `${name} (${files.length})`).join(', ');
  logger.log(`Vendored ${summary} into ${path.relative(cwd, vendorRoot)}, rewrote ${rewritten} file(s) in ${hostPackage.name}`);

  return { rewritten, vendored, vendorRoot };
}

module.exports = vendorPackages;
