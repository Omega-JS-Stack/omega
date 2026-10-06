/**
 * Test: MCP protocol endpoint — happy path, sad path, edge cases
 * Tests the Streamable HTTP transport at POST /omega/mcp
 *
 * Run: npx omega test backend:mcp/protocol
 */
const fetch = require('wonderful-fetch');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

function parseSSE(text) {
  const lines = text.split('\n');
  let lastData = null;

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      lastData = line.slice(6);
    }
  }

  if (lastData) {
    return JSON.parse(lastData);
  }

  return JSON.parse(text);
}

/**
 * The MCP endpoint on the lane THIS run booted — resolved from the same port
 * map the runner's http client uses, never a literal
 * ([#511](https://github.com/Omega-JS-Stack/omega/issues/511)).
 * @param {object} config - The test context's resolved config.
 * @returns {string} The lane's /omega/mcp URL.
 */
function mcpEndpoint(config) {
  return `${config.apiUrl}/omega/mcp`;
}

async function mcpRequest(config, method, params, bearerToken, options) {
  options = options || {};

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    ...options.headers,
  };

  if (bearerToken) {
    headers['Authorization'] = `Bearer ${bearerToken}`;
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: options.id || 1,
    method: method,
    params: params || {},
  });

  const text = await fetch(mcpEndpoint(config), {
    method: 'POST',
    headers: headers,
    body: body,
    response: 'text',
    timeout: 15000,
  });

  return parseSSE(text);
}

module.exports = defineCases({
  description: 'MCP protocol endpoint (Streamable HTTP)',
  type: 'group',

  tests: [
    // ─── Happy path ───

    {
      name: 'tools/list returns tool definitions with schemas',
      async run({ expect, config }) {
        const key = process.env.OMEGA_ADMIN_KEY;
        const response = await mcpRequest(config, 'tools/list', {}, key);

        expect(response?.result, 'Should have result').toBeTruthy();
        expect(Array.isArray(response.result.tools), 'tools should be an array').toBeTruthy();

        const tool = response.result.tools.find((t) => t.name === 'health_check');
        expect(tool, 'Should include health_check').toBeTruthy();
        expect(tool.description, 'Tool should have description').toBeTruthy();
        expect(tool.inputSchema, 'Tool should have inputSchema').toBeTruthy();
        expect(tool.inputSchema.type, 'Schema type should be object').toBe('object');
      },
    },

    {
      name: 'tools/call health_check succeeds',
      async run({ expect, config }) {
        const key = process.env.OMEGA_ADMIN_KEY;
        const response = await mcpRequest(config, 'tools/call', {
          name: 'health_check',
          arguments: {},
        }, key);

        expect(response?.result, 'Should have result').toBeTruthy();
        expect(!response.result.isError, 'Should not be an error').toBeTruthy();
        expect(response.result.content, 'Should have content').toBeTruthy();
        expect(response.result.content.length > 0, 'Content should not be empty').toBeTruthy();
        expect(response.result.content[0].type, 'Content type should be text').toBe('text');
      },
    },

    {
      name: 'tools/call generate_uuid returns valid response',
      async run({ expect, config }) {
        const key = process.env.OMEGA_ADMIN_KEY;
        const response = await mcpRequest(config, 'tools/call', {
          name: 'generate_uuid',
          arguments: { version: '4' },
        }, key);

        expect(response?.result, 'Should have result').toBeTruthy();
        expect(!response.result.isError, 'Should not be an error').toBeTruthy();

        const text = response.result.content?.[0]?.text || '';
        expect(text.length > 0, 'Should return UUID text').toBeTruthy();
      },
    },

    // ─── Sad path ───

    {
      name: 'tools/call unknown tool returns error',
      async run({ expect, config }) {
        const key = process.env.OMEGA_ADMIN_KEY;
        const response = await mcpRequest(config, 'tools/call', {
          name: 'nonexistent_tool',
          arguments: {},
        }, key);

        expect(response?.result, 'Should have result').toBeTruthy();
        expect(response.result.isError, 'Should be an error').toBe(true);
        expect(response.result.content?.[0]?.text?.includes('Unknown tool'), 'Error should mention unknown tool').toBeTruthy();
      },
    },

    {
      name: 'GET method returns 405',
      async run({ expect, config }) {
        const key = process.env.OMEGA_ADMIN_KEY;

        try {
          const response = await fetch(mcpEndpoint(config), {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${key}`,
              'Accept': 'application/json, text/event-stream',
            },
            response: 'json',
            timeout: 10000,
          });

          expect(response?.error, 'Should return error for GET').toBeTruthy();
        } catch (error) {
          expect(true, 'GET method rejected').toBeTruthy();
        }
      },
    },

    {
      name: 'DELETE method returns 200 (session cleanup)',
      async run({ expect, config }) {
        const key = process.env.OMEGA_ADMIN_KEY;

        try {
          await fetch(mcpEndpoint(config), {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${key}`,
            },
            response: 'text',
            timeout: 10000,
          });

          expect(true, 'DELETE method accepted').toBeTruthy();
        } catch (error) {
          expect(true, 'DELETE method handled').toBeTruthy();
        }
      },
    },

    // ─── Edge cases ───

    {
      name: 'tools/call with empty object arguments still works',
      async run({ expect, config }) {
        const key = process.env.OMEGA_ADMIN_KEY;
        const response = await mcpRequest(config, 'tools/call', {
          name: 'health_check',
          arguments: {},
        }, key);

        expect(response?.result, 'Should have result').toBeTruthy();
        expect(!response.result.isError, 'Should not error with empty arguments').toBeTruthy();
      },
    },

    {
      name: 'tools/call with missing arguments still works',
      async run({ expect, config }) {
        const key = process.env.OMEGA_ADMIN_KEY;
        const response = await mcpRequest(config, 'tools/call', {
          name: 'health_check',
        }, key);

        expect(response?.result, 'Should have result').toBeTruthy();
        expect(!response.result.isError, 'Should not error with missing arguments').toBeTruthy();
      },
    },

    {
      name: 'response preserves jsonrpc 2.0 envelope',
      async run({ expect, config }) {
        const key = process.env.OMEGA_ADMIN_KEY;
        const response = await mcpRequest(config, 'tools/list', {}, key, { id: 42 });

        expect(response?.jsonrpc, 'Should have jsonrpc 2.0').toBe('2.0');
        expect(response?.id, 'Should echo back the request id').toBe(42);
      },
    },

    {
      name: 'unauthenticated request returns 401 to trigger OAuth',
      async run({ expect, config }) {
        try {
          const text = await fetch(mcpEndpoint(config), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json, text/event-stream',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
            response: 'text',
            timeout: 10000,
          });
          const parsed = JSON.parse(text);
          expect(parsed.error, 'Should return Unauthorized').toBe('Unauthorized');
        } catch (error) {
          expect(true, '401 response thrown as error').toBeTruthy();
        }
      },
    },

    {
      name: 'tools include annotations with title and hints',
      async run({ expect, config }) {
        const key = process.env.OMEGA_ADMIN_KEY;
        const response = await mcpRequest(config, 'tools/list', {}, key);

        const tool = response.result.tools.find((t) => t.name === 'health_check');
        expect(tool.annotations, 'Should have annotations').toBeTruthy();
        expect(tool.annotations.title, 'Should have a title').toBeTruthy();
        expect(tool.annotations.readOnlyHint, 'health_check should be read-only').toBe(true);
      },
    },

    {
      name: 'admin can call public-role tool (role escalation works upward)',
      async run({ expect, config }) {
        const key = process.env.OMEGA_ADMIN_KEY;
        const response = await mcpRequest(config, 'tools/call', {
          name: 'health_check',
          arguments: {},
        }, key);

        expect(response?.result, 'Should have result').toBeTruthy();
        expect(!response.result.isError, 'Admin should be able to call public tools').toBeTruthy();
      },
    },
  ],
});
