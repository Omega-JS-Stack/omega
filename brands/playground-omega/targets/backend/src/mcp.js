/**
 * Surface: consumer MCP tools, both kinds: route delegation (both transports),
 * whose `path` is the HTTP path as served (`/notes`, the consumer's own
 * function, never `/omega/notes`), and a handler tool (HTTP transport only)
 * that runs its code directly as the caller the MCP request resolved
 * Doc: node_modules/@omega.js/backend/docs/mcp.md (Consumer MCP Tools)
 */
module.exports = [
  {
    name: 'list_notes',
    description: 'List the signed-in user\'s notes, newest first',
    role: 'user',
    method: 'GET',
    path: '/notes',
    annotations: { title: 'List my notes', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many notes to return (default 20, max 100)' },
      },
    },
  },
  {
    name: 'create_note',
    description: 'Create a note for the signed-in user',
    role: 'user',
    method: 'POST',
    path: '/notes',
    annotations: { title: 'Create a note', readOnlyHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The note, up to 280 characters' },
      },
      required: ['text'],
    },
  },
  {
    // A handler tool runs with the request's Context and the resolved caller,
    // so it counts the signed-in user's own notes
    name: 'count_notes',
    description: 'Count the notes the signed-in user has created',
    role: 'user',
    annotations: { title: 'Count my notes', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async ({ omega, user }) => {
      // notes-stats/{uid}.created is the counter src/events/notes/on-create.js bumps
      const stats = await omega.firebase.admin.firestore().doc(`notes-stats/${user.uid}`).get();

      // A user who never created a note has no counter doc yet
      return { count: stats.exists ? stats.data().created : 0 };
    },
  },
];
