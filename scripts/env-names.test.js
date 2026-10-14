/**
 * env-names ratchet: ONE name says a test run is on, `OMEGA_ENVIRONMENT=testing`,
 * read by `isTesting()` ([#931](https://github.com/Omega-JS-Stack/omega/issues/931)).
 *
 * The three retired names (`OMEGA_TEST_MODE`, `OMEGA_TEST_RUNNER`, `OMEGA_CASE_RUNNER`)
 * stay out of code and docs. Every file in `SCOPES` is read; a retired name may appear
 * only in a file the allow-list names, and the list is empty. The register of retired
 * shapes and the three tests proving a retired name is ignored name them for good: they
 * stand outside it.
 *
 * Run: node --test scripts/env-names.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SELF = path.relative(ROOT, __filename);

const RETIRED = /\bOMEGA_(?:TEST_MODE|TEST_RUNNER|CASE_RUNNER)\b/;

const SCOPES = ['packages/*/src/**', 'packages/*/test/**', 'packages/*/README.md', 'scripts/*.js', 'brands/*/test/**', 'test/**', 'docs/**'];

// The register of retired shapes names them by design, the exemption config's
// repo.owner ratchet makes too, and the tests proving a retired name is ignored
// set one on purpose; none is a file waiting on a group.
const STANDING = new Set([
  'docs/shared/breaking-changes.md',
  'packages/config/test/env.test.js',
  'packages/monitoring/test/env.test.js',
  'packages/backend/test/helpers/environment.test.js',
]);

// Empty by design: every group has converted its files. A line here would be a
// file waiting on a conversion, and none is owed.
const ALLOWED = new Set([]);

// Every tracked or new file in the scopes, through git so ignored build output
// and self-referencing node_modules links are never walked.
function scannedFiles() {
  const globs = SCOPES.map((glob) => `:(glob)${glob}`);
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...globs], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file && file !== SELF)
    .filter((file) => !file.split('/').some((part) => part === 'node_modules' || part === 'dist'))
    .filter((file) => fs.existsSync(path.join(ROOT, file)));
}

function namesRetired(file) {
  return RETIRED.test(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

module.exports = defineCases({
  type: 'group',
  description: 'env-names',
  tests: [
    {
      name: 'the pattern catches each retired name and nothing that merely shares a prefix',
      run: (ctx) => {
        for (const name of ['OMEGA_TEST_MODE', 'OMEGA_TEST_RUNNER', 'OMEGA_CASE_RUNNER']) {
          ctx.expect(`process.env.${name} = '1';`, name).toMatch(RETIRED);
        }
        ctx.expect("process.env.OMEGA_ENVIRONMENT = 'testing';").not.toMatch(RETIRED);
        ctx.expect('OMEGA_TEST_MODES OMEGA_CASE_RUNNERS').not.toMatch(RETIRED);
      },
    },

    {
      name: 'no file outside the allow-list names a retired test env name',
      run: (ctx) => {
        const offenders = scannedFiles()
          .filter((file) => !STANDING.has(file) && !ALLOWED.has(file))
          .filter(namesRetired);

        ctx.expect(offenders, `these files name OMEGA_TEST_MODE, OMEGA_TEST_RUNNER or OMEGA_CASE_RUNNER; set and read OMEGA_ENVIRONMENT=testing / isTesting() instead:\n  ${offenders.join('\n  ')}`).toEqual([]);
      },
    },

    {
      name: 'every allow-list entry still names one, so a converted file leaves the list',
      run: (ctx) => {
        const stale = [...ALLOWED].filter((file) => !fs.existsSync(path.join(ROOT, file)) || !namesRetired(file));

        ctx.expect(stale, `these allow-list entries name no retired env name any more; delete their lines:\n  ${stale.join('\n  ')}`).toEqual([]);
      },
    },
  ],
});
