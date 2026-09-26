/**
 * Test: the MCP tool call (src/mcp/call-tool.js): a consumer handler tool runs
 * with the request's Context and the caller it resolved, a route tool goes
 * through the client
 *
 * Run: npx omega test backend:mcp/call-tool
 *
 * The Context is REAL, built on an Omega instance booted from the bundled
 * fixture (test/helpers/_boot-omega.js), with its caller set the way
 * authenticate() stores one, so the file runs with or without an emulator. The
 * route case stubs the client: its wire is pinned by helpers/mcp-client.
 */
const Context = require('../../dist/omega/context.js');
const { User } = require('../../dist/omega/helpers/account.js');
const { callTool } = require('../../dist/mcp/call-tool.js');
const { bootOmega } = require('../helpers/_boot-omega.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

let booted = null;
const omega = () => (booted = booted || bootOmega());

// A client that records its calls and answers a fixed body
function recordingClient(answer) {
  const calls = [];

  return {
    calls,
    async call(method, path, params) {
      calls.push({ method, path, params });
      return answer;
    },
  };
}

module.exports = defineCases({
  description: 'MCP callTool(): handler tools get the caller, route tools the client',
  type: 'group',

  tests: [
    {
      name: 'a-handler-tool-receives-the-context-and-its-caller',
      async run({ assert }) {
        const ctx = new Context(omega());

        // Where authenticate() stores the caller it resolved
        ctx._services.user = new User({ auth: { uid: 'u1', email: 'u1@example.com' } });

        const seen = [];
        const client = recordingClient({});
        const tool = {
          name: 'whoami',
          _consumer: true,
          handler: async (received) => {
            seen.push(received);
            return { uid: received.user.uid };
          },
        };

        const result = await callTool({ tool, ctx, user: ctx.user, omega: omega(), client, args: { a: 1 } });

        assert.equal(seen.length, 1, 'the handler ran once');
        assert.equal(seen[0].ctx, ctx, 'ctx is the request\'s Context');
        assert.equal(seen[0].user.uid, 'u1', 'user is the caller the Context holds');
        assert.equal(seen[0].user.authenticated, true, 'a signed-in caller');
        assert.equal(seen[0].omega, omega(), 'omega is the instance');
        assert.deepEqual(seen[0].params, { a: 1 }, 'params are the tool arguments');
        assert.equal(client.calls.length, 0, 'a handler tool never goes over HTTP');
        assert.deepEqual(JSON.parse(result.content[0].text), { uid: 'u1' }, 'the answer is the text content');
      },
    },

    {
      name: 'a-route-tool-goes-through-the-client',
      async run({ assert }) {
        const ctx = new Context(omega());
        const client = recordingClient({ ok: true });
        const tool = { name: 'list_notes', _consumer: true, method: 'GET', path: '/notes' };

        const result = await callTool({ tool, ctx, user: ctx.user, omega: omega(), client, args: { limit: 5 } });

        assert.deepEqual(client.calls, [{ method: 'GET', path: '/notes', params: { limit: 5 } }], 'one call, as declared');
        assert.deepEqual(JSON.parse(result.content[0].text), { ok: true }, 'the answer is the text content');
        assert.equal(result.isError, undefined, 'not an error');
      },
    },

    {
      name: 'a-throw-becomes-an-error-result-naming-the-tool',
      async run({ assert }) {
        const ctx = new Context(omega());
        const tool = {
          name: 'boom',
          _consumer: true,
          handler: async () => {
            throw new Error('it broke');
          },
        };

        const result = await callTool({ tool, ctx, user: ctx.user, omega: omega(), client: recordingClient({}), args: {} });

        assert.equal(result.isError, true, 'flagged as an error');
        assert.equal(result.content[0].text, 'Error calling boom: it broke', 'naming the tool and the message');
      },
    },
  ],
});
