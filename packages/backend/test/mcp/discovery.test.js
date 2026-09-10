/**
 * Test: MCP OAuth discovery endpoints
 * Tests .well-known/oauth-authorization-server and .well-known/oauth-protected-resource
 *
 * Run: npx omega test backend:mcp/discovery
 */
const fetch = require('wonderful-fetch');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'MCP OAuth discovery endpoints',
  type: 'group',

  tests: [
    {
      name: 'oauth-authorization-server returns valid metadata',
      async run({ assert, config }) {
        const response = await fetch(`${config.apiUrl}/.well-known/oauth-authorization-server`, {
          method: 'GET',
          response: 'json',
          timeout: 10000,
        });

        assert.ok(response, 'Discovery endpoint should return a response');
        assert.ok(response.issuer, 'Should have issuer');
        assert.ok(response.authorization_endpoint, 'Should have authorization_endpoint');
        assert.ok(response.token_endpoint, 'Should have token_endpoint');
        assert.ok(response.authorization_endpoint.includes('/omega/mcp/authorize'), 'authorization_endpoint should point to mcp/authorize');
        assert.ok(response.token_endpoint.includes('/omega/mcp/token'), 'token_endpoint should point to mcp/token');
        assert.ok(response.response_types_supported.includes('code'), 'Should support code response type');
        assert.ok(response.code_challenge_methods_supported.includes('S256'), 'Should support PKCE S256');
      },
    },

    {
      name: 'oauth-protected-resource returns valid metadata',
      async run({ assert, config }) {
        const response = await fetch(`${config.apiUrl}/.well-known/oauth-protected-resource`, {
          method: 'GET',
          response: 'json',
          timeout: 10000,
        });

        assert.ok(response, 'Protected resource endpoint should return a response');
        assert.ok(response.resource, 'Should have resource');
        assert.ok(response.resource.includes('/omega/mcp'), 'resource should point to MCP endpoint');
        assert.ok(Array.isArray(response.authorization_servers), 'Should have authorization_servers array');
        assert.ok(response.authorization_servers.length > 0, 'Should have at least one authorization server');
      },
    },
  ],
});
