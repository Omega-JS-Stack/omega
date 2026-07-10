const BaseTest = require('./base-test');
const jetpack = require('fs-jetpack');
const _ = require('lodash');

// The expected source pattern for omega_api hosting rewrite
// Includes /omega/* routes, the legacy /backend-manager/* alias (kept so
// migrating brands’ in-the-wild clients keep working), and root-level MCP
// OAuth paths that Claude Chat sends directly (e.g. /authorize, /token, /.well-known/*)
const OMEGA_API_SOURCE = '{/omega,/omega/**,/backend-manager,/backend-manager/**,/mcp,/mcp/**,/.well-known/oauth-protected-resource,/.well-known/oauth-authorization-server,/authorize,/token,/register}';

class HostingRewritesTest extends BaseTest {
  getName() {
    return 'hosting rewrites have omega_api';
  }

  async run() {
    const rewrites = this.self.firebaseJSON?.hosting?.rewrites || [];
    const firstRewrite = rewrites[0];

    // Check first rule is correct (matches current expected pattern)
    const firstIsCorrect = firstRewrite?.source === OMEGA_API_SOURCE && firstRewrite?.function === 'omega_api';

    // Check no duplicates exist (only one omega_api rule allowed)
    const omegaApiCount = rewrites.filter(r => r.function === 'omega_api').length;

    return firstIsCorrect && omegaApiCount === 1;
  }

  async fix() {
    const hosting = this.self.firebaseJSON?.hosting || {};

    // Set default
    hosting.rewrites = hosting.rewrites || [];

    // Remove any existing omega_api rewrites (handles legacy single-pattern rewrites too)
    hosting.rewrites = hosting.rewrites.filter(rewrite => rewrite.function !== 'omega_api');

    // Add to top with full pattern including MCP OAuth paths
    hosting.rewrites.unshift({
      source: OMEGA_API_SOURCE,
      function: 'omega_api',
    });

    // Set
    _.set(this.self.firebaseJSON, 'hosting.rewrites', hosting.rewrites);

    // Write
    jetpack.write(`${this.self.firebaseProjectPath}/firebase.json`, JSON.stringify(this.self.firebaseJSON, null, 2));
  }
}

module.exports = HostingRewritesTest;
