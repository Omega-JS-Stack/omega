// Optional consumer extension hook — called AFTER the release publishes successfully (after
// electron-builder finishes). No-op by default.
//
// Use this for: posting to Slack/Discord, kicking off downstream workflows, updating a
// changelog page on your marketing site, sending notification emails.

module.exports = async (ctx) => {
  // ctx = { manager, projectRoot, artifacts }   // artifacts: array of release/ paths
};
