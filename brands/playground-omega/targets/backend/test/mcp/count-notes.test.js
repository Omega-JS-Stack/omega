/**
 * The count_notes MCP handler tool (src/mcp.js) end to end: `tools/call
 * count_notes` on /omega/mcp, with a persona's `privateKey` as its Bearer,
 * answers THAT caller's `notes.created` off their own user document, 0 when
 * they have none, and a note POSTed over the real HTTP surface moves the owner's
 * answer alone (the counter src/events/notes/on-create.js keeps).
 *
 * The suite writes notes, so it runs as the two personas test/_init.js declares
 * for the notes suites (`notes-owner`, `notes-other`) and never as a shared one.
 *
 * Run (from this target): npx omega test mcp/count-notes
 */
const { defineCases } = require('@omega.js/backend/test');

// The streamable HTTP transport answers as SSE: the last `data:` line is the reply
function parseSSE(text) {
  const data = text.split('\n').filter((line) => line.startsWith('data: ')).pop();

  return JSON.parse(data ? data.slice(6) : text);
}

// count_notes as one persona: the JSON-RPC tools/call on this run's /omega/mcp
async function countNotes(config, account) {
  const response = await fetch(`${config.apiUrl}/omega/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${account.privateKey}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'count_notes', arguments: {} },
    }),
  });

  const result = parseSSE(await response.text()).result;

  // An error result is text, not a count: say what it was instead of a parse error
  if (!result || result.isError) {
    throw new Error(`count_notes failed: ${JSON.stringify(result)}`);
  }

  return JSON.parse(result.content[0].text).count;
}

// The auth hook seeds each persona's welcome note on its own schedule; waiting
// for it to be counted keeps a later trigger from moving a value a case set
function welcomeCounted(firestore, waitFor, account) {
  return waitFor(async () => {
    const user = await firestore.get(`users/${account.uid}`);
    return user?.notes?.created >= 1 ? user : null;
  }, 20000, 500);
}

module.exports = defineCases({
  description: 'MCP: count_notes answers the calling user\'s own note count',
  type: 'suite',
  timeout: 60000,

  tests: [
    {
      name: 'answers-the-callers-own-counter',

      async run({ expect, accounts, config, firestore, waitFor }) {
        const owner = accounts['notes-owner'];

        expect(owner.privateKey, 'the persona carries an API key').toBeTruthy();

        await welcomeCounted(firestore, waitFor, owner);
        await firestore.set(`users/${owner.uid}`, { notes: { created: 7 } }, { merge: true });

        expect(await countNotes(config, owner), 'the count is the caller\'s notes.created').toBe(7);
      },
    },

    {
      name: 'answers-zero-for-a-user-with-none',

      async run({ expect, accounts, config, firestore, waitFor, admin }) {
        const other = accounts['notes-other'];

        expect(other.privateKey, 'the persona carries an API key').toBeTruthy();

        await welcomeCounted(firestore, waitFor, other);
        await firestore.set(`users/${other.uid}`, { notes: admin.firestore.FieldValue.delete() }, { merge: true });

        expect(await countNotes(config, other), 'no notes counter reads as zero').toBe(0);
      },
    },

    {
      name: 'a-new-note-counts-for-its-owner-only',

      async run({ http, expect, accounts, config, waitFor }) {
        const owner = accounts['notes-owner'];
        const other = accounts['notes-other'];

        expect(await http.as('notes-owner').post('notes', { text: 'Counted over MCP' }), 'the owner creates a note').toBeSuccess();

        // The counter is bumped by the notesOnCreate trigger, after the write
        const ownerAfter = await waitFor(async () => {
          const count = await countNotes(config, owner);
          return count >= 8 ? count : null;
        }, 20000, 500);

        expect(ownerAfter, 'the owner counts the new note on top of the 7').toBe(8);
        expect(await countNotes(config, other), 'the other persona\'s count is unchanged').toBe(0);
      },
    },
  ],
});
