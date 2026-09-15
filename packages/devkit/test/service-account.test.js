/**
 * The brand secrets folder's ONE spelling
 * ([#897](https://github.com/Omega-JS-Stack/omega/issues/897)).
 *
 * `.omega/secrets/` is a FOLDER the cloud manage service mints into, and its
 * two files are read from six modules across the manager and the backend. Each
 * one used to type the path itself, so a rename of the folder would have moved
 * the writer and left every reader looking at the old place.
 *
 * Two tests hold that shut: the constants themselves, and a drift guard that
 * reads every package's authored source and fails on a hand-typed folder path
 * outside this module. The guard reads the monorepo's own packages, so it runs
 * here and nowhere else (devkit's tests never ship inside a framework).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { SECRETS_DIR, SERVICE_ACCOUNT_REL, GOOGLE_OAUTH_REL } = require('../src/service-account.js');

const PACKAGES_DIR = path.join(__dirname, '..', '..');

// The hand-typed shapes: either file's path in join or slash form, and the
// folder itself in join form. A sentence that NAMES the folder (an env-schema
// description, a "look in .omega/secrets/" error) is prose, not a path build.
const HAND_TYPED = [
  /\.omega['"]?\s*[,/]\s*['"]?secrets['"]?\s*[,/]\s*['"]?(service-account|google-oauth)/,
  /['"]\.omega['"]\s*,\s*['"]secrets['"]/,
];

/** Every .js file under a directory, recursively. */
function sourceFiles(dir) {
  const found = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith('.js')) found.push(full);
  }

  return found;
}

/**
 * Source with its comments removed. Prose naming the folder documents it; the
 * guard is about code that BUILDS the path.
 */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

test('the secrets folder and its two files have one spelling', () => {
  assert.equal(SECRETS_DIR, path.join('.omega', 'secrets'));
  assert.equal(SERVICE_ACCOUNT_REL, path.join(SECRETS_DIR, 'service-account.json'));
  assert.equal(GOOGLE_OAUTH_REL, path.join(SECRETS_DIR, 'google-oauth.json'));
});

test('no package builds the secrets path by hand', () => {
  const packages = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'devkit')
    .map((entry) => path.join(PACKAGES_DIR, entry.name, 'src'))
    .filter((dir) => fs.existsSync(dir));

  assert.ok(packages.length > 3, `the packages' src trees were found (${packages.length})`);

  const offenders = packages
    .flatMap((dir) => sourceFiles(dir))
    .filter((file) => HAND_TYPED.some((shape) => shape.test(code(fs.readFileSync(file, 'utf8')))))
    .map((file) => path.relative(PACKAGES_DIR, file));

  assert.deepEqual(offenders, [], `these build the secrets path by hand instead of importing @omega.js/devkit/service-account:\n  ${offenders.join('\n  ')}`);
});
