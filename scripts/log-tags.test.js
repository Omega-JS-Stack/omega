/**
 * log-tags tests — the ONE identity tag guard
 * ([#12](https://github.com/Omega-JS-Stack/omega/issues/12)).
 *
 * Every OMEGA log line carries exactly one identity tag,
 * `[@omega.js/<package>:<module>]`, emitted by a logger — never hand-written
 * per module. Build-time output prefixes its own `[HH:MM:SS]` bracket; runtime
 * console lines carry no timestamp. `[DRY RUN]` survives as a separate marker
 * AFTER the tag.
 *
 * This scan is the mechanism that keeps it true: a log call whose message
 * STARTS with a literal bracket tag is a hand-written tag, and fails here.
 * Interpolated brackets (`[${lang}]`, `[Memory ${label}]`) are data in the
 * message, not identity tags, so they pass.
 *
 * Two layers: fixture self-tests (synthetic source that must go red), then a
 * live scan over every packages/<pkg>/src and packages/<pkg>/servers file.
 *
 * Run: node --test scripts/log-tags.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');

// A log call whose first argument opens with a bracket tag. Four wrappers count
// as the same thing, because in each the tag is still hand-written:
//   console.warn('[Sentry] …')                       plain
//   logger.log(`[watcher] …`)  this.logger.log('[AUTH] …')
//   console.log('%c[Checkout Dev] …', 'color: …')    devtools styling
//   log(`${chalk.yellow('[DRY RUN]')} …`)            the manager's chalk style
//   log('[Tag] …')                                   an INJECTED line printer
// The receiver is optional so a bare `log(` — a function passed in as `spec.log`
// — is caught too; `\W` before the method name keeps `blog(`/`catalog(` out.
const LOG_CALL = /(?:^|[^\w$.])((?:[A-Za-z_$][\w$]*\.)*)(log|info|warn|error|debug)\(\s*(?:`\$\{\s*)?(?:chalk\.[a-z]+\(\s*)?(['"`])(?:%c)?\[([^\]\n]*)\]/g;

// The tag that IS allowed, plus the one surviving mode marker.
const IDENTITY_PREFIX = '@omega.js/';
const DRY_RUN_MARKER = 'DRY RUN';

// A static tag: no interpolation, and identifier-ish content.
const STATIC_TAG = /^[A-Za-z@][\w .:@/-]*$/;

// Test harnesses and fixtures are stand-ins for consumer code, not OMEGA output.
const EXEMPT_PATH = /(^|\/)(test|tests|fixtures|harness)(\/|$)/;

// No package is exempt (backend joined the contract in issue #121).
const EXEMPT_PACKAGES = new Set();

// The shipped source trees a package can carry: src/, and the MCP servers mcp-router ships beside it.
const SHIPPED_TREES = ['src', 'servers'];

// Scan one source string; returns [{ tag, method }] for every hand-written tag.
function findHandWrittenTags(source) {
  const found = [];
  for (const match of source.matchAll(LOG_CALL)) {
    const [, receiver, method, , tag] = match;
    if (tag.includes('${')) { continue; }
    if (!STATIC_TAG.test(tag)) { continue; }
    if (tag.startsWith(IDENTITY_PREFIX)) { continue; }
    if (tag === DRY_RUN_MARKER) { continue; }
    found.push({ receiver, method, tag });
  }
  return found;
}

// A raw stream write whose literal opens with a bracket: a sink that bypasses
// every logger still prints its tag by hand. Group 2 is the bracket's text.
const STREAM_WRITE = /(?:^|[^\w$.])(?:process\.)?(?:stderr|stdout)\.write\(\s*(['"`])(?:%c)?\[([^\]\n]*)\]/g;

// Scan one source string for stream writes opening with a hand-typed tag. Only
// the text before any interpolation counts: `[${ts}]` is data, `[mcp-router ${level}]` a tag.
function findHandWrittenWriteTags(source) {
  const found = [];
  for (const match of source.matchAll(STREAM_WRITE)) {
    const prefix = match[2].split('${')[0].trim();
    if (!prefix || !STATIC_TAG.test(prefix)) { continue; }
    if (prefix.startsWith(IDENTITY_PREFIX) || prefix === DRY_RUN_MARKER) { continue; }
    found.push({ receiver: 'stream', method: 'write', tag: match[2] });
  }
  return found;
}

// Every packages/<pkg>/{src,servers}/**/*.js outside a harness/fixture path, plus web's
// browser runtime (packages/web/core/js) — shipped source that logs to the
// visitor's console, so it carries the same tag. The harness exemption does NOT
// apply inside core/js: its `pages/test/` tree is web's own DEMO PAGES (real
// shipped source), not a test harness.
function sourceFiles() {
  const files = [];
  const walk = (dir, { exemptHarnessPaths }) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') { continue; }
        walk(full, { exemptHarnessPaths });
        continue;
      }
      if (!entry.name.endsWith('.js')) { continue; }
      const rel = path.relative(PACKAGES_DIR, full);
      if (exemptHarnessPaths && EXEMPT_PATH.test(rel)) { continue; }
      files.push(full);
    }
  };
  for (const pkg of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!pkg.isDirectory()) { continue; }
    if (EXEMPT_PACKAGES.has(pkg.name)) { continue; }
    for (const tree of SHIPPED_TREES) {
      const dir = path.join(PACKAGES_DIR, pkg.name, tree);
      if (fs.existsSync(dir)) { walk(dir, { exemptHarnessPaths: true }); }
    }
  }
  const webRuntime = path.join(PACKAGES_DIR, 'web', 'core', 'js');
  if (fs.existsSync(webRuntime)) { walk(webRuntime, { exemptHarnessPaths: false }); }
  return files;
}

module.exports = defineCases({
  type: 'group',
  description: 'log-tags',
  tests: [
    {
      name: 'fixture: hand-written tags are caught',
      run: (ctx) => {
        const source = [
          "console.warn('[Sentry] Caught error:', error);",
          'logger.log(`[watcher] Watching for changes...`);',
          "this.logger.log('[AUTH] syncAuth: Already in sync');",
          "console.log('[DRY-RUN] would write');",
          "console.log('%c[Checkout Dev] window._checkout available', 'color: #2563EB');",
        ].join('\n');

        const found = findHandWrittenTags(source);
        ctx.expect(found.map((f) => f.tag)).toEqual(['Sentry', 'watcher', 'AUTH', 'DRY-RUN', 'Checkout Dev']);
      },
    },

    {
      name: 'fixture: a chalk-wrapped tag is caught (the manager house style)',
      run: (ctx) => {
        const source = [
          // Chalk as the first argument, and chalk opening a template literal — both
          // are the same hand-written tag wearing a color.
          "logger.log(chalk.yellow('[Stripe] Would create product'));",
          "log(`${chalk.cyan('[SEO]')} Would update description`);",
        ].join('\n');

        ctx.expect(findHandWrittenTags(source).map((f) => f.tag)).toEqual(['Stripe', 'SEO']);
      },
    },

    {
      name: 'fixture: a bare-function line printer is caught (injected `log`/`warn` sinks)',
      run: (ctx) => {
        const source = [
          "warn(`[sections] ${key}: nothing inherited`);",
          "log('[Migrate] would move the file');",
          // …while a same-named property access is not a bare call, and words merely
          // ending in the method name are not calls at all.
          "const url = catalog('[not-a-tag] x');",
          "const entry = blog('[not-a-tag] y');",
        ].join('\n');

        ctx.expect(findHandWrittenTags(source).map((f) => f.tag)).toEqual(['sections', 'Migrate']);
      },
    },

    {
      name: 'fixture: the identity tag, the DRY RUN marker, and interpolated brackets pass',
      run: (ctx) => {
        const source = [
          // The runtime tag, hand-written or from a logger — either way it IS the tag.
          "console.log('[@omega.js/client:push] Subscribed');",
          "console.log('[@omega.js/client:push:sync] Synced');",
          // The one surviving mode marker.
          "console.log('[DRY RUN] would write');",
          // Data in the message, not an identity tag.
          'logger.log(`[${lang}] Messages translation saved`);',
          'logger.log(`[Memory ${label}] RSS: ${mem.rss}MB`);',
          // A logger that names itself carries no bracket in the message at all.
          "logger.log('Watching for changes...');",
          // The marker survives its chalk coat too — this is the manager's live shape
          // (src/lib/product-create.js), a report row through an injected line
          // printer, not a module tag.
          "log(`${chalk.yellow('[DRY RUN]')} Would create ${chalk.cyan(collection)} doc`);",
        ].join('\n');

        ctx.expect(findHandWrittenTags(source)).toEqual([]);
      },
    },

    {
      name: 'fixture: a raw stream write that hand-types its tag is caught; a timestamp or the family tag passes',
      run: (ctx) => {
        const source = [
          // The router's two sinks before they took the family tag.
          'process.stderr.write(`[mcp-router ${level}] ${args.join(\' \')}\\n`);',
          'process.stderr.write(`[omega-extension ${level}] ${args.join(\' \')}\\n`);',
          "process.stdout.write('[Build] done\\n');",
          // Data first, the family tag, and a non-word bracket all pass.
          'process.stdout.write(`[${ts}] signed ${file}\\n`);',
          "process.stderr.write(`[@omega.js/mcp-router:${name}] ${level}: ${line}\\n`);",
          'process.stdout.write(`[??] ${jsonLine}\\n`);',
        ].join('\n');

        ctx.expect(findHandWrittenWriteTags(source).map((f) => f.tag)).toEqual(['mcp-router ${level}', 'omega-extension ${level}', 'Build']);
      },
    },

    {
      name: 'live: no framework source hand-writes a log tag',
      run: (ctx) => {
        const offenders = [];
        for (const file of sourceFiles()) {
          const source = fs.readFileSync(file, 'utf8');
          for (const hit of [...findHandWrittenTags(source), ...findHandWrittenWriteTags(source)]) {
            offenders.push(`${path.relative(ROOT, file)} — ${hit.receiver}.${hit.method}('[${hit.tag}] …`);
          }
        }

        ctx.expect(offenders, `hand-written log tags found — route them through the package's logger instead:\n${offenders.join('\n')}`).toEqual([]);
      },
    },
  ],
});
