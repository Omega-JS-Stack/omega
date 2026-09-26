const path = require('path');

const ROLE_HIERARCHY = {
  admin: ['admin', 'user', 'public'],
  user: ['user', 'public'],
  public: ['public'],
};

/**
 * Classify a Bearer token into a role without hitting the database.
 * Actual validation happens at the route level when a tool is called.
 */
function resolveAuthInfo(token) {
  const configKey = process.env.OMEGA_ADMIN_KEY || '';

  if (token && configKey && token === configKey) {
    return { role: 'admin', authType: 'adminKey', token };
  }

  if (token) {
    return { role: 'user', authType: 'userToken', token };
  }

  return { role: 'public', authType: 'none', token: '' };
}

/**
 * Filter tools to only those visible for a given role.
 * admin → all, user → user + public, public → public only.
 */
function filterToolsByRole(tools, role) {
  const allowed = ROLE_HIERARCHY[role] || ROLE_HIERARCHY.public;

  return tools.filter((tool) => allowed.includes(tool.role || 'admin'));
}

/**
 * Load consumer MCP tools from `functions/mcp.js` if it exists.
 * Returns an empty array if the file doesn't exist or fails to load.
 * A route tool's `path` is the HTTP path as served (`/notes`); one without the
 * leading slash throws by name, since the client prefixes nothing.
 */
function loadConsumerTools(cwd) {
  if (!cwd) {
    return [];
  }

  const mcpPath = path.join(cwd, 'mcp.js');
  let consumerTools;

  try {
    const jetpack = require('fs-jetpack');

    if (!jetpack.exists(mcpPath)) {
      return [];
    }

    consumerTools = require(mcpPath);
  } catch (error) {
    console.error(`[@omega.js/backend MCP] Failed to load consumer tools from ${mcpPath}:`, error.message);
    return [];
  }

  if (!Array.isArray(consumerTools)) {
    console.error(`[@omega.js/backend MCP] Consumer mcp.js must export an array, got ${typeof consumerTools}`);
    return [];
  }

  for (const tool of consumerTools) {
    if (!tool.name || !tool.description) {
      console.error(`[@omega.js/backend MCP] Consumer tool missing name or description:`, tool);
      return [];
    }

    if (!tool.path && !tool.handler) {
      console.error(`[@omega.js/backend MCP] Consumer tool "${tool.name}" must have a path or handler`);
      return [];
    }

    // A relative path would reach the host root unprefixed and 404 on every call
    if (tool.path && !String(tool.path).startsWith('/')) {
      throw new Error(`[@omega.js/backend:mcp] Consumer tool "${tool.name}" path "${tool.path}" must be the HTTP path as served, starting with "/" (e.g. "/notes")`);
    }

    tool.role = tool.role || 'admin';
    tool._consumer = true;
  }

  return consumerTools;
}

/**
 * Merge built-in and consumer tools into a Map.
 * Consumer tools with the same name override built-ins.
 */
function buildToolMap(builtinTools, consumerTools) {
  const map = new Map();

  for (const tool of builtinTools) {
    map.set(tool.name, tool);
  }

  for (const tool of consumerTools) {
    map.set(tool.name, tool);
  }

  return map;
}

/**
 * Answer a request with a JSON body (the MCP HTTP surface's one JSON door:
 * handler.js and oauth.js both answer through it).
 */
function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

module.exports = {
  resolveAuthInfo,
  filterToolsByRole,
  loadConsumerTools,
  buildToolMap,
  sendJson,
  ROLE_HIERARCHY,
};
