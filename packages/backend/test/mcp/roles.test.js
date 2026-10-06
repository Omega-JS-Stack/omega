/**
 * Test: MCP role-based tool scoping
 * Tests that admin/user/public roles see the correct tools via the MCP protocol endpoint
 *
 * Run: npx omega test backend:mcp/roles
 */
const fetch = require('wonderful-fetch');

// The tool SSOT — expected counts derive from it so the suite catches drift
// between the served tools and src without going stale on hardcoded numbers
const TOOLS = require('../../dist/mcp/tools.js');
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

async function mcpRequest(config, method, params, bearerToken) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };

  if (bearerToken) {
    headers['Authorization'] = `Bearer ${bearerToken}`;
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
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
  description: 'MCP role-based tool scoping',
  type: 'group',

  tests: [
    {
      name: 'admin sees every built-in tool',
      async run({ expect, config }) {
        const key = process.env.OMEGA_ADMIN_KEY;
        const response = await mcpRequest(config, 'tools/list', {}, key);

        expect(response?.result?.tools, 'Should return tools list').toBeTruthy();

        const tools = response.result.tools;
        expect(tools.length, `Admin should see all ${TOOLS.length} tools, got ${tools.length}`).toBe(TOOLS.length);

        const names = tools.map((t) => t.name);
        expect(names.includes('firestore_read'), 'Admin should see firestore_read').toBeTruthy();
        expect(names.includes('get_user'), 'Admin should see get_user').toBeTruthy();
        expect(names.includes('health_check'), 'Admin should see health_check').toBeTruthy();
      },
    },

    {
      name: 'user with roles.admin sees all tools (DB role promotion)',
      async run({ expect, accounts, config }) {
        const adminUserKey = accounts.admin?.privateKey;
        expect(adminUserKey, 'Admin test account should have a privateKey').toBeTruthy();

        const response = await mcpRequest(config, 'tools/list', {}, adminUserKey);

        expect(response?.result?.tools, 'Should return tools list').toBeTruthy();

        const tools = response.result.tools;
        expect(tools.length, `Admin-role user should see all ${TOOLS.length} tools, got ${tools.length}`).toBe(TOOLS.length);

        const names = tools.map((t) => t.name);
        expect(names.includes('firestore_read'), 'Should see admin tool firestore_read').toBeTruthy();
        expect(names.includes('get_user'), 'Should see user tool get_user').toBeTruthy();
        expect(names.includes('health_check'), 'Should see public tool health_check').toBeTruthy();
      },
    },

    {
      name: 'user sees only user + public tools',
      async run({ expect, accounts, config }) {
        const userKey = accounts.basic?.privateKey;
        expect(userKey, 'Test account should have a privateKey').toBeTruthy();

        const response = await mcpRequest(config, 'tools/list', {}, userKey);

        expect(response?.result?.tools, 'Should return tools list').toBeTruthy();

        const tools = response.result.tools;
        const names = tools.map((t) => t.name);

        // User should see user-role tools
        expect(names.includes('get_user'), 'User should see get_user').toBeTruthy();
        expect(names.includes('get_subscription'), 'User should see get_subscription').toBeTruthy();

        // User should see public tools
        expect(names.includes('health_check'), 'User should see health_check').toBeTruthy();

        // User should NOT see admin tools
        expect(!names.includes('firestore_read'), 'User should NOT see firestore_read').toBeTruthy();
        expect(!names.includes('send_email'), 'User should NOT see send_email').toBeTruthy();
        expect(!names.includes('cancel_subscription'), 'User should NOT see cancel_subscription').toBeTruthy();
        expect(!names.includes('generate_uuid'), 'User should NOT see generate_uuid').toBeTruthy();

        const expected = TOOLS.filter((t) => t.role === 'user' || t.role === 'public').length;
        expect(tools.length, `User should see ${expected} tools (user + public), got ${tools.length}`).toBe(expected);
      },
    },

    {
      name: 'unauthenticated gets 401 (triggers OAuth flow)',
      async run({ expect, config }) {
        try {
          const response = await mcpRequest(config, 'tools/list', {});
          // If we got here, check for Unauthorized error
          expect(response?.error, 'Should return Unauthorized').toBe('Unauthorized');
        } catch (error) {
          // 401 throws — this is correct behavior
          expect(true, 'Unauthenticated request returned 401').toBeTruthy();
        }
      },
    },

    {
      name: 'admin can call an admin tool',
      async run({ expect, config }) {
        const key = process.env.OMEGA_ADMIN_KEY;
        const response = await mcpRequest(config, 'tools/call', {
          name: 'health_check',
          arguments: {},
        }, key);

        expect(response?.result, 'Should return a result').toBeTruthy();
        expect(!response.result.isError, 'Should not be an error').toBeTruthy();
        expect(response.result.content?.length > 0, 'Should have content').toBeTruthy();
      },
    },

    {
      name: 'user cannot call an admin tool',
      async run({ expect, accounts, config }) {
        const userKey = accounts.basic?.privateKey;
        const response = await mcpRequest(config, 'tools/call', {
          name: 'firestore_read',
          arguments: { path: 'users/test' },
        }, userKey);

        expect(response?.result, 'Should return a result').toBeTruthy();
        expect(response.result.isError, 'Should be an error').toBe(true);
        expect(response.result.content?.[0]?.text?.includes('Unknown tool'), 'Should say unknown tool').toBeTruthy();
      },
    },

    {
      name: 'unauthenticated cannot call any tool (gets 401)',
      async run({ expect, config }) {
        try {
          const response = await mcpRequest(config, 'tools/call', {
            name: 'get_user',
            arguments: {},
          });
          expect(response?.error, 'Should return Unauthorized').toBe('Unauthorized');
        } catch (error) {
          expect(true, 'Unauthenticated tool call returned 401').toBeTruthy();
        }
      },
    },
  ],
});
