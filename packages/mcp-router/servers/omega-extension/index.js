#!/usr/bin/env node

/**
 * @file The `omega-extension` upstream's MCP server.
 *
 * Bridges an MCP client (over stdio) to the OMEGA Companion browser extension
 * (automation over WebSocket). Each MCP tool call becomes an OMEGA_AUTOMATE
 * message on the socket, and the extension's answer becomes the tool result.
 *
 * It ships INSIDE the router ([#927](https://github.com/Omega-JS-Stack/omega/issues/927)):
 * it used to live in `@omega.js/manager`'s `extension/` tree, which that
 * package never publishes, so the upstream could not start on any install but
 * a monorepo checkout. Everything it imports is a router dependency.
 *
 * Transport: it dials `ws://localhost:<OMEGA_EXTENSION_PORT | 9876>` as a
 * client, and hosts a minimal WS server on that port when nobody answers, so
 * the extension can connect to it directly. The port name and default are
 * @omega.js/manager's (`src/lib/automation-client.js`): one name, one number,
 * whichever side is holding the socket. The extension always dials 9876, an
 * extension being unable to read an environment variable.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const WebSocket = require('ws');
const { TOOLS } = require('./tools.js');

const DEFAULT_PORT = 9876;
const PORT = Number(process.env.OMEGA_EXTENSION_PORT) || DEFAULT_PORT;
const WS_URL = `ws://localhost:${PORT}`;
const RECONNECT_INTERVAL = 3000;
const RESPONSE_TIMEOUT = 60000;

// ---------------------------------------------------------------------------
// Logging (stderr only — stdout is reserved for MCP JSON-RPC)
// ---------------------------------------------------------------------------

const log = (level, ...args) => {
  process.stderr.write(`[omega-extension ${level}] ${args.join(' ')}\n`);
};

// ---------------------------------------------------------------------------
// WebSocket connection management
// ---------------------------------------------------------------------------

let ws = null;
let wsServer = null;
let extensionSocket = null;
let reconnectTimer = null;

// Pending requests: id → { resolve, reject, timer }
const pending = new Map();
let nextId = 1;

function generateId() {
  return `mcp_${nextId++}`;
}

/**
 * Send an automation message and return a promise for the result.
 */
function sendAutomation(message) {
  return new Promise((resolve, reject) => {
    const socket = ws || extensionSocket;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(new Error(`Not connected to the extension. Install the OMEGA Companion from the Chrome Web Store, or load omega-omega/targets/extension/packaged/chrome/raw/ unpacked, and make sure it is enabled: it dials port ${PORT}, which this server is holding open.`));
      return;
    }

    const timer = setTimeout(() => {
      pending.delete(message.id);
      reject(new Error(`Timeout waiting for response to ${message.id}`));
    }, RESPONSE_TIMEOUT);

    pending.set(message.id, { resolve, reject, timer });
    socket.send(JSON.stringify(message));
  });
}

/**
 * Handle an incoming message (response or progress) from the extension.
 */
function handleIncoming(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  // Progress messages — log but don't resolve
  if (message.type === 'OMEGA_AUTOMATE_PROGRESS') {
    log('info', `Progress: step ${message.step + 1}/${message.totalSteps} (${message.command})`);
    return;
  }

  // Result messages — resolve the matching pending request
  if (message.type === 'OMEGA_AUTOMATE_RESULT' && message.id && pending.has(message.id)) {
    const { resolve, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    resolve(message);
    return;
  }

  // Extension may also send back bare results (without OMEGA_AUTOMATE_RESULT wrapper)
  // when the response comes directly from the background service worker
  if (message.id && pending.has(message.id)) {
    const { resolve, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    resolve(message);
  }
}

/**
 * Try to connect as a WebSocket client to the manager's automation server.
 * On failure, fall back to hosting our own server.
 */
function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }

  try {
    const socket = new WebSocket(WS_URL);

    socket.on('open', () => {
      ws = socket;
      log('info', `Connected to ${WS_URL}`);
      clearReconnectTimer();
    });

    socket.on('message', (data) => handleIncoming(data.toString()));

    socket.on('close', () => {
      ws = null;
      log('info', 'Disconnected from WebSocket server');
      if (!wsServer) {
        startOwnServer();
      }
    });

    socket.on('error', () => {
      ws = null;
      if (!wsServer) {
        startOwnServer();
      }
    });
  } catch {
    if (!wsServer) {
      startOwnServer();
    }
  }
}

/**
 * Start our own WebSocket server for the extension to connect to.
 */
function startOwnServer() {
  if (wsServer) {
    return;
  }

  const port = PORT;

  try {
    wsServer = new WebSocket.Server({ port });

    wsServer.on('listening', () => {
      log('info', `Hosting WebSocket server on port ${port} (extension can connect here)`);
    });

    wsServer.on('connection', (socket) => {
      log('info', 'Extension connected to our WebSocket server');
      extensionSocket = socket;

      socket.on('message', (data) => handleIncoming(data.toString()));

      socket.on('close', () => {
        if (extensionSocket === socket) {
          extensionSocket = null;
          log('info', 'Extension disconnected');
        }
      });
    });

    wsServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Port became occupied (the manager's automation server started) — switch to client mode
        log('info', `Port ${port} now in use, switching to client mode`);
        wsServer = null;
        scheduleReconnect();
      } else {
        log('error', `WebSocket server error: ${err.message}`);
      }
    });
  } catch {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  reconnectTimer = setTimeout(connectWebSocket, RECONNECT_INTERVAL);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'omega-extension', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  // Session management uses a different message type
  if (name === 'session') {
    const id = generateId();
    const message = {
      type: 'OMEGA_AUTOMATE_SESSION',
      id,
      action: args.action,
      target: args.target,
    };

    try {
      const result = await sendAutomation(message);
      return formatResult(name, result);
    } catch (err) {
      return errorResult(err.message);
    }
  }

  // Tabs command — no target extraction needed
  if (name === 'tabs') {
    const id = generateId();
    const { url, title, active, currentWindow } = args;
    const message = {
      type: 'OMEGA_AUTOMATE',
      id,
      command: 'tabs',
      params: { url, title, active, currentWindow },
    };

    try {
      const result = await sendAutomation(message);
      return formatResult(name, result);
    } catch (err) {
      return errorResult(err.message);
    }
  }

  // Standard automation commands
  const id = generateId();
  const { target, ...params } = args;
  const message = {
    type: 'OMEGA_AUTOMATE',
    id,
    command: name,
    params,
    target,
  };

  try {
    const result = await sendAutomation(message);
    return formatResult(name, result);
  } catch (err) {
    return errorResult(err.message);
  }
});

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

function formatResult(toolName, response) {
  if (!response.success) {
    const errMsg = response.error?.message || response.error || 'Unknown error';
    const errCode = response.error?.code || 'ERROR';
    return errorResult(`[${errCode}] ${errMsg}`);
  }

  // Screenshot returns an image content block
  if (toolName === 'screenshot' && response.result?.data) {
    const format = response.result.format || 'png';
    const mimeType = `image/${format === 'jpg' ? 'jpeg' : format}`;

    return {
      content: [
        {
          type: 'image',
          mimeType,
          data: response.result.data,
        },
        {
          type: 'text',
          text: `Screenshot captured (${format})`,
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response.result || response, null, 2),
      },
    ],
  };
}

function errorResult(text) {
  return {
    isError: true,
    content: [{ type: 'text', text }],
  };
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

const main = async () => {
  // Try connecting as client first; falls back to hosting
  connectWebSocket();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'MCP server ready on stdio');
};

main().catch((err) => {
  log('error', `Fatal: ${err.message}`);
  process.exit(1);
});
