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
      async run({ expect, config }) {
        const response = await fetch(`${config.apiUrl}/.well-known/oauth-authorization-server`, {
          method: 'GET',
          response: 'json',
          timeout: 10000,
        });

        expect(response, 'Discovery endpoint should return a response').toBeTruthy();
        expect(response.issuer, 'Should have issuer').toBeTruthy();
        expect(response.authorization_endpoint, 'Should have authorization_endpoint').toBeTruthy();
        expect(response.token_endpoint, 'Should have token_endpoint').toBeTruthy();
        expect(response.authorization_endpoint.includes('/omega/mcp/authorize'), 'authorization_endpoint should point to mcp/authorize').toBeTruthy();
        expect(response.token_endpoint.includes('/omega/mcp/token'), 'token_endpoint should point to mcp/token').toBeTruthy();
        expect(response.response_types_supported.includes('code'), 'Should support code response type').toBeTruthy();
        expect(response.code_challenge_methods_supported.includes('S256'), 'Should support PKCE S256').toBeTruthy();
      },
    },

    {
      name: 'oauth-protected-resource returns valid metadata',
      async run({ expect, config }) {
        const response = await fetch(`${config.apiUrl}/.well-known/oauth-protected-resource`, {
          method: 'GET',
          response: 'json',
          timeout: 10000,
        });

        expect(response, 'Protected resource endpoint should return a response').toBeTruthy();
        expect(response.resource, 'Should have resource').toBeTruthy();
        expect(response.resource.includes('/omega/mcp'), 'resource should point to MCP endpoint').toBeTruthy();
        expect(Array.isArray(response.authorization_servers), 'Should have authorization_servers array').toBeTruthy();
        expect(response.authorization_servers.length > 0, 'Should have at least one authorization server').toBeTruthy();
      },
    },
  ],
});
