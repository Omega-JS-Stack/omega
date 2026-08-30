/**
 * Rules-posture guard — every rule this brand opens is a rule someone reviewed.
 *
 * `firestore.rules` is YOUR half of the compiled model: `omega build` splices it
 * together with the framework half into `dist/firestore.rules`, and that is what
 * the emulator and `firebase deploy` read. A match block you add here widens (or
 * tightens) real access to real user data, so this suite makes adding one a
 * DELIBERATE act: list the path in `AUTHORED_FIRESTORE_PATHS` below, with a
 * comment saying why it is open, or the suite goes red.
 *
 * Same deal for Storage: the scaffold denies every path, and each one you expose
 * goes in `EXPOSED_STORAGE_PATHS`.
 *
 * Static + emulator-free: reads the rules FILES, compares text. Behavioral rules
 * coverage (allow/deny against a real Firestore) lives in the emulator suite
 * (`npx omega test`), which boots the database it asserts against.
 *
 * Lives under `_unit/` on purpose: the framework's test discovery skips
 * `_`-prefixed paths, so this file runs in the static lane and never inside the
 * emulator lane.
 *
 *   node --require ./test/_helpers/connect-trap.js --test test/_unit/rules-posture.test.js
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const APP_DIR = path.join(__dirname, '..', '..');

// ── Yours to fill in ────────────────────────────────────────────────────────
// Every collection path YOUR firestore.rules opens, and every Storage path you
// expose. Empty is the scaffold's posture: the framework half gates everything
// it owns and the default lock closes the rest.
//
//   const AUTHORED_FIRESTORE_PATHS = [
//     '/posts/{id}',   // public blog posts — read-only to clients, admin writes
//   ];
const AUTHORED_FIRESTORE_PATHS = [];
const EXPOSED_STORAGE_PATHS = [];
// ────────────────────────────────────────────────────────────────────────────

function read(file) {
  return fs.readFileSync(path.join(APP_DIR, file), 'utf8');
}

// Comments carry no posture — strip them before any rule text is read, so a
// commented-out example never counts as an open path.
function rulePaths(contents) {
  const live = contents
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  return [...live.matchAll(/match\s+(\/\S+)/g)].map((match) => match[1]);
}

test('firestore.rules opens exactly the paths this brand declared', () => {
  const authored = rulePaths(read('firestore.rules'))
    // The scope opener every rules file carries, not a rule.
    .filter((rulePath) => !rulePath.startsWith('/databases/'));

  assert.deepEqual(
    authored,
    AUTHORED_FIRESTORE_PATHS,
    'firestore.rules opens a path this suite does not declare — add it to AUTHORED_FIRESTORE_PATHS with the reason, or take the rule out',
  );
});

test('storage.rules denies every path this brand has not exposed', () => {
  const storage = read('storage.rules');

  assert.ok(
    /match \/\{allPaths=\*\*\} \{\s*\n\s*allow read, write: if false;/.test(storage),
    'the storage deny-all default is gone — every path without its own rule is now open',
  );

  const exposed = rulePaths(storage)
    .filter((rulePath) => !rulePath.startsWith('/b/') && rulePath !== '/{allPaths=**}');

  assert.deepEqual(
    exposed,
    EXPOSED_STORAGE_PATHS,
    'storage.rules exposes a path this suite does not declare — add it to EXPOSED_STORAGE_PATHS with the reason, or take the rule out',
  );
});

test('firebase.json reads the COMPILED firestore rules, not the source half', () => {
  const firebase = JSON.parse(read('firebase.json'));

  // `firestore.rules` here is source: on its own it carries none of the
  // framework's gating. Pointed at directly, a deploy would ship whatever this
  // file alone says — which for a fresh brand is nothing at all.
  assert.equal(
    firebase.firestore.rules,
    'dist/firestore.rules',
    'firestore rules no longer read the compiled artifact — the framework half is not being deployed',
  );
  assert.equal(firebase.database.rules, 'database.rules.json', 'the Realtime Database rules file moved');
  assert.equal(firebase.storage.rules, 'storage.rules', 'the Storage rules file moved');
});
