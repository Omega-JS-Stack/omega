/**
 * Surface: event, a consumer Firestore trigger (notesOnCreate in src/index.js)
 * run through omega.events.run('notes/on-create'): bumps the owner's counter
 * Doc: node_modules/@omega.js/manager/docs/backend/routes.md (New Event Handler)
 */
const { FieldValue } = require('firebase-admin/firestore');

module.exports = async ({ ctx, omega, snapshot }) => {
  const note = snapshot.data();

  // Every writer (the notes route, the on-create auth hook, the owner through
  // the rules) stamps an owner, so a note without one is a writer bug
  if (!note.owner) {
    throw new Error(`notes/on-create: note ${snapshot.id} has no owner`);
  }

  // The counter lives beside the user doc, not on it: the account schema
  // resolves only the fields it declares, so a users/{uid}.notes key would never
  // reach the User a route or the browser reads
  await omega.firebase.admin.firestore().doc(`notes-stats/${note.owner}`).set({
    owner: note.owner,
    created: FieldValue.increment(1),
  }, { merge: true });

  ctx.log(`notes/on-create: counted note ${snapshot.id} for ${note.owner}`);
};
