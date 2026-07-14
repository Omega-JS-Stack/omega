#!/usr/bin/env node

/**
 * @omega.js/backend MCP Server (Stdio Transport)
 *
 * Exposes OMEGA Backend routes as MCP tools so Claude (or any MCP client)
 * can interact with a running @omega.js/backend instance — local or production.
 *
 * Usage:
 *   npx bm mcp                       # admin (uses OMEGA_ADMIN_KEY)
 *   npx bm mcp --token <api-key>     # user-level (uses API key)
 *   npx bm mcp                       # public-only (no key, no token)
 *
 * Environment variables:
 *   OMEGA_BACKEND_URL              - @omega.js/backend server URL (default: http://localhost:5002)
 *   OMEGA_ADMIN_KEY  - Admin API key for authentication
 */
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const BEMClient = require('./client.js');
const builtinTools = require('./tools.js');
const { resolveAuthInfo, filterToolsByRole, loadConsumerTools, buildToolMap } = require('./utils.js');
const packageJSON = require('../../package.json');

/**
 * Start the MCP server
 * @param {object} options
 * @param {string} options.baseUrl - @omega.js/backend server URL
 * @param {string} options.adminKey - Admin API key
 * @param {string} options.userToken - User API key (for user-level connections)
 * @param {string} options.cwd - Consumer project functions directory (for consumer tool discovery)
 */
async function startServer(options) {
  options = options || {};

  const baseUrl = options.baseUrl
    || process.env.OMEGA_BACKEND_URL
    || 'http://localhost:5002';
  const adminKey = options.adminKey
    || process.env.OMEGA_ADMIN_KEY
    || '';
  const userToken = options.userToken || '';

  // Determine auth role
  const token = adminKey || userToken || '';
  const authInfo = resolveAuthInfo(token);

  if (authInfo.role === 'public') {
    console.error('[@omega.js/backend MCP] No key or token set. Only public tools will be available.');
  }

  // Build client with appropriate auth
  const client = new BEMClient({
    baseUrl,
    adminKey: authInfo.role === 'admin' ? token : '',
    userToken: authInfo.role === 'user' ? token : '',
  });

  // Load and merge consumer tools (consumer overrides win)
  const consumerTools = loadConsumerTools(options.cwd);
  const toolMap = buildToolMap(builtinTools, consumerTools);
  const allTools = Array.from(toolMap.values());

  // Filter by role
  const visibleTools = filterToolsByRole(allTools, authInfo.role);

  // Create the MCP server
  const server = new Server(
    {
      name: 'omega-backend',
      version: packageJSON.version,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Handle tools/list — return role-filtered tool definitions
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: visibleTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
      })),
    };
  });

  // Handle tools/call — execute the requested tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = toolMap.get(name);

    if (!tool || !visibleTools.some((t) => t.name === name)) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // Handler-based consumer tools require HTTP transport
    if (tool.handler && !tool.path) {
      return {
        content: [{ type: 'text', text: `Tool "${name}" requires HTTP transport (handler-based tools cannot run over stdio).` }],
        isError: true,
      };
    }

    try {
      const response = await client.call(tool.method, tool.path, args || {});

      const text = typeof response === 'string'
        ? response
        : JSON.stringify(response, null, 2);

      return {
        content: [{ type: 'text', text }],
      };
    } catch (error) {
      const message = error.response
        ? JSON.stringify(error.response, null, 2)
        : error.message;

      return {
        content: [{ type: 'text', text: `Error calling ${tool.path}: ${message}` }],
        isError: true,
      };
    }
  });

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error(`[@omega.js/backend MCP] Server running — connected to ${baseUrl}`);
  console.error(`[@omega.js/backend MCP] Role: ${authInfo.role} | ${visibleTools.length}/${allTools.length} tools available`);

  if (consumerTools.length > 0) {
    console.error(`[@omega.js/backend MCP] ${consumerTools.length} consumer tool(s) loaded`);
  }
}

// Allow direct execution or require
if (require.main === module) {
  startServer().catch((error) => {
    console.error('[@omega.js/backend MCP] Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { startServer };
