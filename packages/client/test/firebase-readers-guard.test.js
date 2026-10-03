/**
 * Firestore and messaging are reached through their loaders alone
 * (`omega.loadFirebaseFirestore()`, `omega.loadFirebaseMessaging()`), so the two
 * sync getters are gone and nothing may read them. Static by design: the
 * guard greps every surface that boots the client, so a reader added anywhere
 * fails here without needing a scenario that reaches it.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');
const { createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

const PACKAGES = path.resolve(__dirname, '..', '..');

// The client itself, plus the three surfaces that extend or call it; web's
// defaults and scaffold ship starter code to consumers
const ROOTS = [
  path.join(PACKAGES, 'client', 'src'),
  path.join(PACKAGES, 'web', 'core'),
  path.join(PACKAGES, 'web', 'themes'),
  path.join(PACKAGES, 'web', 'src'),
  path.join(PACKAGES, 'web', 'sw'),
  path.join(PACKAGES, 'web', 'runtime'),
  path.join(PACKAGES, 'web', 'defaults'),
  path.join(PACKAGES, 'web', 'scaffold'),
  path.join(PACKAGES, 'desktop', 'src'),
  path.join(PACKAGES, 'extension', 'src'),
];

// Build output, vendored copies and test harnesses are not source
const SKIPPED_DIRS = new Set(['dist', 'vendor', 'test', 'node_modules']);
const SOURCE_FILE = /\.(?:js|mjs|cjs|html)$/;
const REMOVED_READ = /\.firebase(?:Firestore|Messaging)\b/;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(full);
    }

    return SOURCE_FILE.test(entry.name) ? [full] : [];
  });
}

module.exports = defineCases({
  type: 'group',
  description: 'firebase-readers-guard',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    {
      name: 'the removed Firebase getters > should leave no reader of firebaseFirestore or firebaseMessaging in client, web, desktop or extension source (case 7)',
      run: async (ctx) => {
        await beforeEachHook();
        const offenders = [];

        for (const root of ROOTS) {
          ctx.expect(fs.existsSync(root), `the guarded root exists: ${path.relative(PACKAGES, root)}`).toBeTruthy();

          for (const file of sourceFiles(root)) {
            fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
              if (REMOVED_READ.test(line)) {
                offenders.push(`${path.relative(PACKAGES, file)}:${index + 1}: ${line.trim()}`);
              }
            });
          }
        }

        ctx.expect(offenders, 'read through omega.loadFirebaseFirestore() / omega.loadFirebaseMessaging() instead').toEqual([]);
      },
    },

    {
      name: 'the removed Firebase getters > should carry neither getter on the instance, only the two loaders',
      run: async (ctx) => {
        await beforeEachHook();
        const { Omega } = await import('../src/index.js');
        const omega = new Omega();

        ctx.expect('firebaseFirestore' in omega).toBe(false);
        ctx.expect('firebaseMessaging' in omega).toBe(false);
        ctx.expect(typeof omega.loadFirebaseFirestore).toBe('function');
        ctx.expect(typeof omega.loadFirebaseMessaging).toBe('function');
      },
    },
  ],
});
