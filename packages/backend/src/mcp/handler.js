/**
 * MCP HTTP Handler (Stateless + OAuth + Role-Based Scoping)
 *
 * Routes all MCP-related requests:
 * - OAuth discovery (.well-known endpoints)
 * - OAuth authorize + token + register (oauth.js)
 * - MCP protocol (stateless Streamable HTTP transport, role-filtered tools)
 *
 * Compatible with serverless environments like Firebase Functions.
 */
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const builtinTools = require('./tools.js');
const BEMClient = require('./client.js');
const Context = require('../omega/context.js');
const { handleAuthorize, handleToken, handleRegister } = require('./oauth.js');
const { callTool } = require('./call-tool.js');
const { resolveAuthInfo, filterToolsByRole, loadConsumerTools, buildToolMap, sendJson } = require('./utils.js');
const packageJSON = require('../../package.json');

// Consumer tools are cached at module scope (loaded once per cold start)
let _consumerToolsCache = null;
let _consumerToolsCwd = null;

function getConsumerTools(cwd) {
  if (_consumerToolsCwd === cwd && _consumerToolsCache !== null) {
    return _consumerToolsCache;
  }

  _consumerToolsCache = loadConsumerTools(cwd);
  _consumerToolsCwd = cwd;

  return _consumerToolsCache;
}

/**
 * Route all MCP-related requests
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {object} options
 * @param {object} options.omega - the @omega.js/backend instance
 * @param {string} options.routePath - Resolved route path (e.g. "mcp", "mcp/authorize")
 */
async function handleMcpRoute(req, res, options) {
  const { omega, routePath } = options;
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const baseUrl = `${protocol}://${host}`;

  // --- OAuth Discovery ---
  // issuer = root (no path) so RFC 8414 discovery resolves to /.well-known/oauth-authorization-server
  if (routePath === '.well-known/oauth-protected-resource') {
    return sendJson(res, 200, {
      resource: `${baseUrl}/omega/mcp`,
      authorization_servers: [baseUrl],
    });
  }

  if (routePath === '.well-known/oauth-authorization-server') {
    return sendJson(res, 200, {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/omega/mcp/authorize`,
      token_endpoint: `${baseUrl}/omega/mcp/token`,
      registration_endpoint: `${baseUrl}/omega/mcp/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  }

  // --- OAuth Dynamic Client Registration (RFC 7591) ---
  if (routePath === 'mcp/register') {
    return handleRegister(req, res);
  }

  // --- OAuth Authorize ---
  if (routePath === 'mcp/authorize') {
    return handleAuthorize(req, res, options, baseUrl);
  }

  // --- OAuth Token ---
  if (routePath === 'mcp/token') {
    return handleToken(req, res, options);
  }

  // --- MCP Protocol ---
  if (routePath === 'mcp') {
    return handleMcpProtocol(req, res, options);
  }

  sendJson(res, 404, { error: 'Not found' });
}

/**
 * MCP Protocol — stateless Streamable HTTP transport with role-based tool filtering
 */
async function handleMcpProtocol(req, res, options) {
  const { omega } = options;

  // Extract Bearer token
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  // No token → 401 to trigger the OAuth flow (MCP spec requires this)
  if (!token) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const baseUrl = `${protocol}://${host}`;
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
    });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // Classify the token: the BEMClient below sends the admin key as its own
  // header and any other token as the caller's Bearer
  const authInfo = resolveAuthInfo(token);

  // ONE caller resolution, the Context's. The admin key is authenticate()'s
  // own lane; any other token is its Bearer lane (the API-key lookup), called
  // bare so the answer settles once and a handler's ctx.usage reuses it
  const ctx = new Context(omega, { req, res });
  const user = await ctx.authenticate(authInfo.authType === 'adminKey' ? { adminKey: token } : undefined);

  // The role is the resolved caller's: a token that matched no account is public
  const role = user.roles.admin
    ? 'admin'
    : (user.authenticated ? 'user' : 'public');

  // Load and merge consumer tools (consumer overrides win)
  const cwd = omega.cwd || '';
  const consumerTools = getConsumerTools(cwd);
  const toolMap = buildToolMap(builtinTools, consumerTools);
  const allTools = Array.from(toolMap.values());

  // Filter by role
  const visibleTools = filterToolsByRole(allTools, role);

  // Only POST supported in stateless mode
  if (req.method !== 'POST') {
    if (req.method === 'DELETE') {
      res.writeHead(200);
      res.end();
      return;
    }
    return sendJson(res, 405, {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use POST.' },
    });
  }

  // Build client with appropriate auth
  const apiUrl = omega.getApiUrl();
  const client = new BEMClient({
    baseUrl: apiUrl,
    adminKey: authInfo.authType === 'adminKey' ? token : '',
    userToken: authInfo.authType === 'userToken' ? token : '',
  });

  // Create a fresh stateless transport
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  // Create MCP server
  const server = new Server(
    {
      name: '@omega.js/backend',
      version: packageJSON.version,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // List tools — role-filtered
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

  // Call tools
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = toolMap.get(name);

    // Defense-in-depth: tool must exist AND be in the visible set
    if (!tool || !visibleTools.some((t) => t.name === name)) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    return callTool({ tool, ctx, user, omega, client, args });
  });

  // Connect and handle
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);

  // Clean up
  await transport.close();
  await server.close();
}

module.exports = { handleMcpRoute };
