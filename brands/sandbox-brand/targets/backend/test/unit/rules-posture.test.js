/**
 * Rules-posture guard: every rule this brand opens is a rule someone reviewed.
 * `firestore.rules` is YOUR half of the compiled model, so adding a match block
 * is a DELIBERATE act: list the path below with why it is open, or the suite goes
 * red. Reads the rules FILES; a file this target does not carry skips its case.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/backend/dist/vendor/devkit/test/define-cases.js');

const APP_DIR = path.join(__dirname, '..', '..');

// ── Yours to fill in ────────────────────────────────────────────────────────
// Every collection path YOUR firestore.rules opens, and every Storage path you
// expose. Empty is the scaffold's posture: the framework half gates everything
// it owns and the default lock closes the rest.
//
//   const AUTHORED_FIRESTORE_PATHS = [
//     '/posts/{id}',   // public blog posts: read-only to clients, admin writes
//   ];
const AUTHORED_FIRESTORE_PATHS = [];
const EXPOSED_STORAGE_PATHS = [];
// ────────────────────────────────────────────────────────────────────────────

// A custom-server backend carries no Firebase rules files, so a case whose file is absent skips
function read(file, skip) {
  const full = path.join(APP_DIR, file);
  if (!fs.existsSync(full)) skip(`no ${file} in this target`);
  return fs.readFileSync(full, 'utf8');
}

// Comments carry no posture: strip them before any rule text is read, so a
// commented-out example never counts as an open path.
function rulePaths(contents) {
  const live = contents
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  return [...live.matchAll(/match\s+(\/\S+)/g)].map((match) => match[1]);
}

module.exports = defineCases({
  description: 'Rules posture: every open path is a declared one',
  type: 'group',

  tests: [
    {
      name: 'firestore-rules-open-exactly-the-declared-paths',

      run({ skip }) {
        const authored = rulePaths(read('firestore.rules', skip))
          // The scope opener every rules file carries, not a rule.
          .filter((rulePath) => !rulePath.startsWith('/databases/'));

        assert.deepEqual(
          authored,
          AUTHORED_FIRESTORE_PATHS,
          'firestore.rules opens a path this suite does not declare: add it to AUTHORED_FIRESTORE_PATHS with the reason, or take the rule out',
        );
      },
    },

    {
      name: 'storage-rules-deny-every-path-not-exposed',

      run({ skip }) {
        const storage = read('storage.rules', skip);

        assert.ok(
          /match \/\{allPaths=\*\*\} \{\s*\n\s*allow read, write: if false;/.test(storage),
          'the storage deny-all default is gone: every path without its own rule is now open',
        );

        const exposed = rulePaths(storage)
          .filter((rulePath) => !rulePath.startsWith('/b/') && rulePath !== '/{allPaths=**}');

        assert.deepEqual(
          exposed,
          EXPOSED_STORAGE_PATHS,
          'storage.rules exposes a path this suite does not declare: add it to EXPOSED_STORAGE_PATHS with the reason, or take the rule out',
        );
      },
    },

    {
      name: 'firebase-json-reads-the-compiled-firestore-rules',

      run({ skip }) {
        const firebase = JSON.parse(read('firebase.json', skip));

        // `firestore.rules` here is source: on its own it carries none of the
        // framework's gating. Pointed at directly, a deploy would ship whatever this
        // file alone says, which for a fresh brand is nothing at all.
        assert.equal(
          firebase.firestore.rules,
          'dist/firestore.rules',
          'firestore rules no longer read the compiled artifact: the framework half is not being deployed',
        );
        assert.equal(firebase.database.rules, 'database.rules.json', 'the Realtime Database rules file moved');
        assert.equal(firebase.storage.rules, 'storage.rules', 'the Storage rules file moved');
      },
    },
  ],
});
