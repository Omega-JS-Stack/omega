/**
 * The count_notes MCP handler tool (src/mcp.js) end to end: a note POSTed over
 * the real HTTP surface bumps its owner's notes-stats counter
 * (src/events/notes/on-create.js), and `tools/call count_notes` on /omega/mcp,
 * with a persona's `privateKey` as its Bearer, answers THAT caller's count.
 *
 * The suite writes notes, so it runs as the two personas test/_init.js declares
 * for the notes suites (`notes-owner`, `notes-other`) and never as a shared one.
 *
 * Run (from this target): npx omega test mcp/count-notes
 */
const defineCases = require('@omega.js/backend/dist/vendor/devkit/test/define-cases.js');

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

module.exports = defineCases({
  description: 'MCP: count_notes answers the calling user\'s own note count',
  type: 'suite',
  timeout: 60000,

  tests: [
    {
      name: 'a-new-note-counts-for-its-owner-only',

      async run({ http, assert, accounts, config, waitFor }) {
        const owner = accounts['notes-owner'];
        const other = accounts['notes-other'];

        assert.ok(owner.privateKey && other.privateKey, 'both personas carry an API key');

        // The auth hook seeds each persona's welcome note on its own schedule;
        // waiting for the other's to be counted keeps its baseline from moving
        const otherBefore = await waitFor(async () => {
          const count = await countNotes(config, other);
          return count >= 1 ? count : null;
        }, 20000, 500);
        const ownerBefore = await countNotes(config, owner);

        assert.isSuccess(await http.as('notes-owner').post('notes', { text: 'Counted over MCP' }), 'the owner creates a note');

        // The counter is bumped by the notesOnCreate trigger, after the write
        const ownerAfter = await waitFor(async () => {
          const count = await countNotes(config, owner);
          return count >= ownerBefore + 1 ? count : null;
        }, 20000, 500);

        assert.ok(ownerAfter >= 1, `the owner counts at least the new note (${ownerAfter})`);
        assert.equal(await countNotes(config, other), otherBefore, 'the other persona\'s count is unchanged');
      },
    },
  ],
});
