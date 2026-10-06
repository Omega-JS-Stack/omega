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
const { defineCases } = require('@omega.js/backend/test');

const ROUTE = 'notes';
const WELCOME_TEXT = 'Welcome to the playground';

// Resolves once the wall clock has entered the next UNIX second
const nextSecond = () => new Promise((resolve) => setTimeout(resolve, 1000 - (Date.now() % 1000)));

module.exports = defineCases({
  description: 'Notes routes: create, list, delete, and their gates',
  type: 'suite',
  timeout: 30000,

  tests: [
    {
      name: 'signed-out-caller-is-refused',

      async run({ http, expect }) {
        expect(await http.as('none').get(ROUTE), 'listing needs a signed-in caller').toBeError(401);
        expect(await http.as('none').post(ROUTE, { text: 'Anonymous' }), 'so does creating').toBeError(401);
        expect(await http.as('none').delete(ROUTE, { id: 'any' }), 'and deleting').toBeError(401);
      },
    },

    {
      name: 'the-auth-hook-seeded-a-welcome-note',

      async run({ http, expect, waitFor }) {
        // The on-create hook runs in the auth trigger, after the persona was
        // created, so its write lands on its own schedule
        const welcome = await waitFor(async () => {
          const response = await http.as('notes-owner').get(ROUTE);
          return response.data?.notes?.find((note) => note.text === WELCOME_TEXT);
        }, 20000, 500);

        expect(welcome, 'the new account starts with the welcome note').toBeTruthy();
      },
    },

    {
      name: 'create-stores-the-note-under-the-caller',

      async run({ http, expect, firestore, accounts, state }) {
        // The list orders by metadata.created.timestampUNIX, the family's order
        // key, which has one-second resolution: a note created in the same
        // second as an earlier one (the MCP suite's) ties, and the tie breaks
        // by id. Landing this note in a fresh second is what makes it newest.
        await nextSecond();

        const response = await http.as('notes-owner').post(ROUTE, { text: '  First note  ', id: 'caller-picked-id' });

        expect(response, 'a signed-in caller creates a note').toBeSuccess();

        const note = response.data.note;

        expect(note.id, 'the schema mints the id, the caller cannot set it').not.toBe('caller-picked-id');
        expect(note.text, 'the text is trimmed').toBe('First note');

        const stored = await firestore.get(`notes/${note.id}`);

        expect(stored.owner, 'the note belongs to the caller').toBe(accounts['notes-owner'].uid);
        expect(stored.text, 'as sent').toBe('First note');
        expect(stored.metadata.created.timestampUNIX > 0, 'stamped under metadata.created').toBeTruthy();

        state.id = note.id;
      },
    },

    {
      name: 'list-returns-the-callers-notes-newest-first',

      async run({ http, expect, state }) {
        const response = await http.as('notes-owner').get(ROUTE);

        expect(response, 'the owner lists their notes').toBeSuccess();
        expect(response.data.notes[0].id, 'the newest note leads').toBe(state.id);

        const other = await http.as('notes-other').get(ROUTE);

        expect(other, 'another account lists its own').toBeSuccess();
        expect(!other.data.notes.some((note) => note.id === state.id), 'and never sees this one').toBeTruthy();
      },
    },

    {
      name: 'list-honours-the-limit',

      async run({ http, expect }) {
        const response = await http.as('notes-owner').get(ROUTE, { limit: 1 });

        expect(response, 'a limit is accepted').toBeSuccess();
        expect(response.data.notes.length, 'and caps the page').toBe(1);
      },
    },

    {
      name: 'empty-text-is-refused-by-the-schema',

      async run({ http, expect }) {
        expect(await http.as('notes-owner').post(ROUTE, { text: '' }), 'an empty note is refused').toBeError(400);
        expect(await http.as('notes-owner').post(ROUTE, { text: '   ' }), 'and so is a blank one').toBeError(400);
        expect(await http.as('notes-owner').delete(ROUTE, {}), 'a delete names its note').toBeError(400);
      },
    },

    {
      name: 'another-account-cannot-delete-the-note',

      async run({ http, expect, firestore, state }) {
        const response = await http.as('notes-other').delete(ROUTE, { id: state.id });

        expect(response, 'only the owner deletes a note').toBeError(403);
        expect(await firestore.exists(`notes/${state.id}`), 'and the note is still there').toBeTruthy();
      },
    },

    {
      name: 'the-owner-deletes-the-note',

      async run({ http, expect, firestore, state }) {
        const response = await http.as('notes-owner').delete(ROUTE, { id: state.id });

        expect(response, 'the owner deletes their note').toBeSuccess();
        expect(await firestore.exists(`notes/${state.id}`), 'and it is gone').toBe(false);
        expect(await http.as('notes-owner').delete(ROUTE, { id: state.id }), 'a second delete finds nothing').toBeError(404);
      },
    },
  ],
});
