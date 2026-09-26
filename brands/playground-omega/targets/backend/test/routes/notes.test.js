/**
 * The notes routes end to end over the real HTTP surface: GET, POST and DELETE
 * /notes, served by the target's own `notes` function through its hosting
 * rewrite (src/routes/notes/), their schemas (src/schemas/notes/), and the
 * welcome note the on-create auth hook (src/hooks/auth/on-create.js) seeds.
 *
 * The suite writes notes, so it runs as the two personas test/_init.js declares
 * for it (`notes-owner`, `notes-other`) and never as a shared one.
 *
 * Run (from this target): npx omega test routes/notes
 */
const defineCases = require('@omega.js/backend/dist/vendor/devkit/test/define-cases.js');

const ROUTE = 'notes';
const WELCOME_TEXT = 'Welcome to the playground';

module.exports = defineCases({
  description: 'Notes routes: create, list, delete, and their gates',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'signed-out-caller-is-refused',

      async run({ http, assert }) {
        assert.isError(await http.as('none').get(ROUTE), 401, 'listing needs a signed-in caller');
        assert.isError(await http.as('none').post(ROUTE, { text: 'Anonymous' }), 401, 'so does creating');
        assert.isError(await http.as('none').delete(ROUTE, { id: 'any' }), 401, 'and deleting');
      },
    },

    {
      name: 'the-auth-hook-seeded-a-welcome-note',

      async run({ http, assert, waitFor }) {
        // The on-create hook runs in the auth trigger, after the persona was
        // created, so its write lands on its own schedule
        const welcome = await waitFor(async () => {
          const response = await http.as('notes-owner').get(ROUTE);
          return response.data?.notes?.find((note) => note.text === WELCOME_TEXT);
        }, 20000, 500);

        assert.ok(welcome, 'the new account starts with the welcome note');
      },
    },

    {
      name: 'create-stores-the-note-under-the-caller',

      async run({ http, assert, firestore, accounts, state }) {
        const response = await http.as('notes-owner').post(ROUTE, { text: '  First note  ', id: 'caller-picked-id' });

        assert.isSuccess(response, 'a signed-in caller creates a note');

        const note = response.data.note;

        assert.notEqual(note.id, 'caller-picked-id', 'the schema mints the id, the caller cannot set it');
        assert.equal(note.text, 'First note', 'the text is trimmed');

        const stored = await firestore.get(`notes/${note.id}`);

        assert.equal(stored.owner, accounts['notes-owner'].uid, 'the note belongs to the caller');
        assert.equal(stored.text, 'First note', 'as sent');
        assert.ok(stored.metadata.created.timestampUNIX > 0, 'stamped under metadata.created');

        state.id = note.id;
      },
    },

    {
      name: 'list-returns-the-callers-notes-newest-first',

      async run({ http, assert, state }) {
        const response = await http.as('notes-owner').get(ROUTE);

        assert.isSuccess(response, 'the owner lists their notes');
        assert.equal(response.data.notes[0].id, state.id, 'the newest note leads');

        const other = await http.as('notes-other').get(ROUTE);

        assert.isSuccess(other, 'another account lists its own');
        assert.ok(!other.data.notes.some((note) => note.id === state.id), 'and never sees this one');
      },
    },

    {
      name: 'list-honours-the-limit',

      async run({ http, assert }) {
        const response = await http.as('notes-owner').get(ROUTE, { limit: 1 });

        assert.isSuccess(response, 'a limit is accepted');
        assert.equal(response.data.notes.length, 1, 'and caps the page');
      },
    },

    {
      name: 'empty-text-is-refused-by-the-schema',

      async run({ http, assert }) {
        assert.isError(await http.as('notes-owner').post(ROUTE, { text: '' }), 400, 'an empty note is refused');
        assert.isError(await http.as('notes-owner').post(ROUTE, { text: '   ' }), 400, 'and so is a blank one');
        assert.isError(await http.as('notes-owner').delete(ROUTE, {}), 400, 'a delete names its note');
      },
    },

    {
      name: 'another-account-cannot-delete-the-note',

      async run({ http, assert, firestore, state }) {
        const response = await http.as('notes-other').delete(ROUTE, { id: state.id });

        assert.isError(response, 403, 'only the owner deletes a note');
        assert.ok(await firestore.exists(`notes/${state.id}`), 'and the note is still there');
      },
    },

    {
      name: 'the-owner-deletes-the-note',

      async run({ http, assert, firestore, state }) {
        const response = await http.as('notes-owner').delete(ROUTE, { id: state.id });

        assert.isSuccess(response, 'the owner deletes their note');
        assert.equal(await firestore.exists(`notes/${state.id}`), false, 'and it is gone');
        assert.isError(await http.as('notes-owner').delete(ROUTE, { id: state.id }), 404, 'a second delete finds nothing');
      },
    },
  ],
});
