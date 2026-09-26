/**
 * Test lifecycle hook for this project. Runs before any test (not a test itself).
 * See @omega.js/backend/docs/test-framework.md → "test/_init.js".
 */

module.exports = ({ config }) => ({
  // Extra test accounts (one per lifecycle this project exercises):
  // { id, uid, email, properties }. email may use the {domain} placeholder.
  // The notes suites write notes, so they own their accounts rather than
  // borrowing the shared personas.
  accounts: [
    { id: 'notes-owner', uid: '_test-notes-owner', email: '_test.notes-owner@{domain}', properties: {} },
    { id: 'notes-other', uid: '_test-notes-other', email: '_test.notes-other@{domain}', properties: {} },
  ],

  // Seed fixtures into the freshly-flushed emulator, after accounts are created.
  async setup({ admin, accounts }) {
  },
});
