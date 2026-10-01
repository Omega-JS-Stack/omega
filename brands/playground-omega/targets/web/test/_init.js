/**
 * Test lifecycle hook for this project. Runs once before the suites, after the production build (not a test itself).
 * See @omega.js/manager/docs/web/test-framework.md → "test/_init.js".
 */

module.exports = ({ projectRoot }) => ({
  // Seed any fixture a suite needs before it runs.
  async setup() {
  },
});
