/**
 * MCP Tool Call (both transports)
 *
 * Runs one tools/call for handler.js (HTTP) and index.js (stdio), which have
 * already checked the tool exists and is visible to the caller's role:
 * - A consumer handler tool runs in-process with `{ ctx, omega, user, params }`:
 *   the request's Context and the caller it resolved (a `User`)
 * - Every other tool is a route, called over HTTP through the BEMClient built
 *   with the caller's token
 *
 * Either answer becomes the MCP text content; a throw becomes an isError result
 * naming the tool.
 */

/**
 * Call one tool.
 * @param {object} options
 * @param {object} options.tool - the tool definition (built-in or consumer).
 * @param {Context} options.ctx - the request's Context.
 * @param {User} options.user - the resolved caller (signed out when the token matched no account).
 * @param {object} options.omega - the @omega.js/backend instance.
 * @param {BEMClient} options.client - the HTTP client a route tool calls through.
 * @param {object} [options.args] - the tool's arguments.
 * @returns {Promise<object>} the MCP CallTool result.
 */
async function callTool({ tool, ctx, user, omega, client, args }) {
  try {
    // A consumer handler tool runs here, outside the route pipeline; every
    // other tool is a route the client calls over HTTP
    const result = tool.handler && tool._consumer
      ? await tool.handler({ ctx, omega, user, params: args || {} })
      : await client.call(tool.method, tool.path, args || {});

    const text = typeof result === 'string'
      ? result
      : JSON.stringify(result, null, 2);

    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    const message = error.response
      ? JSON.stringify(error.response, null, 2)
      : error.message;

    return {
      content: [{ type: 'text', text: `Error calling ${tool.name}: ${message}` }],
      isError: true,
    };
  }
}

module.exports = { callTool };
