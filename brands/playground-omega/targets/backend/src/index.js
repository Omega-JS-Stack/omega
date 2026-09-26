/*
  Initialize
*/
const omega = require('@omega.js/backend');

omega.initialize({
});

// Routes:  src/routes/<path>/<method>.js, served by the consumer's own function below at /<path> (node_modules/@omega.js/backend/docs/routes.md)
// Schemas: src/schemas/<path>/<method>.js, the input each route accepts (node_modules/@omega.js/backend/docs/schemas.md)
// Hooks:   src/hooks/auth/<event>.js and src/hooks/cron/<schedule>/<job>.js (node_modules/@omega.js/backend/docs/auth-hooks.md)
// Events:  src/events/<name>.js, run by a trigger below through omega.events.run (node_modules/@omega.js/backend/docs/routes.md)
// MCP:     src/mcp.js, consumer tools delegating to routes (node_modules/@omega.js/backend/docs/mcp.md)

/**
 * @route /notes
 *
 * @method GET    /notes    - List the caller's notes, newest first
 * @method POST   /notes    - Create a note
 * @method DELETE /notes    - Delete one of the caller's notes
 */
omega.functions.notes = omega.firebase.functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .region(omega.project.resourceZone)
  .https.onRequest((req, res) => omega.routes.run('notes', { req, res }));

omega.functions.notesOnCreate = omega.firebase.functions
  .firestore.document('notes/{id}')
  .onCreate((snapshot, context) => omega.events.run('notes/on-create', { snapshot, context }));

module.exports = omega.functions;
