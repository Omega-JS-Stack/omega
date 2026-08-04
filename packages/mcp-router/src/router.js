#!/usr/bin/env node
/**
 * The router — ONE stdio MCP server that proxies many upstream MCP servers.
 *
 * A session pays for one always-loaded endpoint; every upstream's tools come
 * from a cached schema on disk, and its child process is spawned LAZILY, on
 * the first tool call that needs it. Tools surface to the client as
 * `<upstream>__<tool>` (a Claude session sees `mcp__mcp-router__<upstream>__<tool>`).
 *
 * Per-session control lives in the `router__*` meta-tools: activating or
 * deactivating an upstream changes THIS session's visible tool list and never
 * touches disk. Disk state is the layered registry (bundled defaults +
 * `~/.omega/mcp-router/servers/`), managed by the `omega-mcp` CLI.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const { log } = require('./lib/log.js');
const { resolveSpawn } = require('./lib/env.js');
const { connectWithDeadline, listToolsOnce } = require('./lib/oneshot.js');
const registry = require('./lib/registry.js');

// ---------- Upstream registry (from disk) ----------

const { bundledDir, overlayDir } = registry.layers();
const upstreams = registry.loadUpstreams();
log('info', `Loaded ${Object.keys(upstreams).length} upstream configs (bundled ${bundledDir} + overlay ${overlayDir})`);

// ---------- Per-session in-memory state ----------

const session = {};
for (const [name, upstream] of Object.entries(upstreams)) {
  session[name] = {
    active: upstream.enabled_on_disk && upstream.default === 'auto',
    client: null,
    transport: null,
    spawning: null,
    lastError: null,
    envOverride: null,
  };
}

// ---------- Lazy spawn ----------

/**
 * Spawn one upstream's child process and connect a proxy client to it.
 *
 * @param {string} name - Upstream name
 * @returns {Promise<void>} Resolves once the client is connected
 * @throws {Error} When the handshake does not finish within the spawn deadline
 */
const spawnUpstream = async (name) => {
  const upstream = upstreams[name];
  if (!upstream) throw new Error(`Unknown upstream: ${name}`);

  const spawn = resolveSpawn(upstream);
  const transport = new StdioClientTransport({
    command: spawn.command,
    args: spawn.args,
    // Session env override (router__enable_upstream {env}) wins over config env.
    env: { ...process.env, ...spawn.env, ...(session[name].envOverride || {}) },
    stderr: 'inherit',
  });

  const client = new Client({ name: 'mcp-router-proxy', version: '1.0.0' }, { capabilities: {} });

  transport.onclose = () => {
    log('warn', `Upstream "${name}" transport closed (pid was ${transport.pid})`);
    if (session[name].transport === transport) {
      session[name].client = null;
      session[name].transport = null;
    }
  };

  try {
    await connectWithDeadline(client, transport);
  } catch (err) {
    // The helper terminated the child; record the failure for
    // router__list_upstreams. Rejecting is what clears `spawning` (the
    // caller's .finally), so the next call spawns fresh.
    session[name].lastError = err.message;
    log('error', `Spawn of upstream "${name}" failed: ${err.message}`);
    throw err;
  }

  session[name].client = client;
  session[name].transport = transport;
  log('info', `Spawned upstream "${name}" (pid=${transport.pid})`);
};

/**
 * Close an upstream's child, force-killing it if it outlives the grace period.
 *
 * @param {string} name - Upstream name
 * @returns {Promise<void>} Resolves once close() has been attempted
 */
const killUpstream = async (name) => {
  const state = session[name];
  if (!state || !state.transport) return;
  try {
    await state.client.close();
  } catch (err) {
    log('warn', `client.close() for "${name}" threw: ${err.message}`);
  }
  // close() should terminate the child; force-kill after grace period if needed.
  const transport = state.transport;
  state.client = null;
  state.transport = null;
  setTimeout(() => {
    if (transport.pid) {
      try {
        process.kill(transport.pid, 0);
        log('warn', `Upstream "${name}" still alive after close(); SIGKILL`);
        process.kill(transport.pid, 'SIGKILL');
      } catch {
        // process is gone — fine
      }
    }
  }, 2000).unref();
};

// ---------- MCP Server ----------

const server = new Server(
  { name: 'mcp-router', version: '1.0.0' },
  { capabilities: { tools: { listChanged: true } } },
);

// ---------- Meta-tools ----------

const META_TOOLS = [
  {
    name: 'router__list_upstreams',
    description:
      'List all upstream MCP servers registered with the router, including their on-disk enabled state, locked state, per-session active state, and cached tool count.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'router__enable_upstream',
    description:
      'Activate an upstream for THIS chat session only. The upstream must be enabled on disk (via `omega-mcp enable <name>`) and not locked (an upstream with "locked": true in its overlay config refuses to activate, and there is no override from here). Adds its tools to the visible tool list. Optional env vars apply to the child process for this session (e.g. a debug port); passing env restarts a running child so the values take effect.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Upstream name (e.g. "chrome-devtools")' },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Per-session env vars for the child process (e.g. {"OMEGA_CDP_PORT": "9222"}). Cleared by router__disable_upstream.',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'router__disable_upstream',
    description:
      'Deactivate an upstream for THIS chat session only. Removes its tools and kills any running child process. Does NOT modify disk config.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'router__refresh_upstream',
    description:
      'Force-spawn an upstream, re-read its tool list, and persist it to the overlay cache at ~/.omega/mcp-router/servers/<name>/config.json. Use when the cached schema is stale.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
];

const textResult = (text) => ({ content: [{ type: 'text', text }] });
const errorResult = (text) => ({ isError: true, content: [{ type: 'text', text }] });

/**
 * Run one `router__*` meta-tool.
 *
 * @param {string} name - Meta-tool name
 * @param {object} args - Tool arguments
 * @returns {Promise<object>} An MCP tool result
 */
const callMetaTool = async (name, args) => {
  if (name === 'router__list_upstreams') {
    const rows = Object.values(upstreams).map((upstream) => ({
      name: upstream.name,
      enabled_on_disk: upstream.enabled_on_disk,
      default: upstream.default,
      locked: upstream.locked,
      active_this_session: session[upstream.name].active,
      spawned: session[upstream.name].client != null,
      tool_count: upstream.tools.length,
      last_error: session[upstream.name].lastError,
    }));
    return textResult(JSON.stringify(rows, null, 2));
  }

  if (name === 'router__enable_upstream') {
    const target = args?.name;
    const upstream = upstreams[target];
    if (!upstream) return errorResult(`Unknown upstream: ${target}`);
    // The overlay may have changed since router startup (an enable flip, a
    // lock written mid-session) — re-read the LAYERED state so the "then call
    // this tool again" retry succeeds and a fresh lock is honored even on an
    // upstream that was already enabled on disk.
    const fresh = registry.loadUpstream(target);
    if (fresh) Object.assign(upstream, fresh);
    // A lock outranks the disabled hint: there is no force path from a chat.
    if (upstream.locked) return errorResult(registry.lockedRefusal(target));
    if (!upstream.enabled_on_disk) {
      return errorResult(
        `Upstream "${target}" is disabled on disk. Run \`omega-mcp enable ${target}\` from the shell to make it available, then call this tool again.`,
      );
    }
    // Optional per-session env override for the child (e.g. a debug port).
    // A running child was spawned WITHOUT it — restart so the values apply.
    let envNote = '';
    if (args?.env && typeof args.env === 'object' && !Array.isArray(args.env)) {
      const bad = Object.entries(args.env).find(([, value]) => typeof value !== 'string');
      if (bad) return errorResult(`env values must be strings (got ${typeof bad[1]} for "${bad[0]}")`);
      session[target].envOverride = { ...args.env };
      // An in-flight cold spawn would complete with the OLD env and pin a live
      // client — settle it first so the kill below always lands.
      if (session[target].spawning) await session[target].spawning.catch(() => {});
      const hadChild = session[target].client != null;
      if (hadChild) await killUpstream(target);
      envNote = ` Env override set (${Object.keys(args.env).join(', ')})${hadChild ? '; child restarted' : ''}.`;
    }
    session[target].active = true;
    await server.sendToolListChanged();
    return textResult(`Enabled "${target}" for this session (${upstream.tools.length} tools).${envNote}`);
  }

  if (name === 'router__disable_upstream') {
    const target = args?.name;
    if (!upstreams[target]) return errorResult(`Unknown upstream: ${target}`);
    session[target].active = false;
    session[target].envOverride = null;
    await killUpstream(target);
    await server.sendToolListChanged();
    return textResult(`Disabled "${target}" for this session and stopped child process.`);
  }

  if (name === 'router__refresh_upstream') {
    const target = args?.name;
    const upstream = upstreams[target];
    if (!upstream) return errorResult(`Unknown upstream: ${target}`);
    // The config may have changed since router startup (a re-pointed command,
    // new args), so re-read the LAYERED state: the spawn below must use what
    // is on disk NOW, which is the whole point of refreshing without a restart.
    const fresh = registry.loadUpstream(target);
    if (fresh) Object.assign(upstream, fresh);
    try {
      // Spawn a one-shot client to fetch tools (don't disturb running session
      // client). The helper is the same one `omega-mcp refresh` runs, so both
      // surfaces carry the same deadline, read budget, and failure cleanup; the
      // outer catch answers the caller.
      const spawn = resolveSpawn(upstream);
      const tools = await listToolsOnce({
        command: spawn.command,
        args: spawn.args,
        // The session override applies here too — without it a refresh of an
        // upstream that only starts with the override (Electron port) fails.
        env: { ...process.env, ...spawn.env, ...(session[target].envOverride || {}) },
      });
      session[target].lastError = null;

      // The cache lands in the OVERLAY — the bundled dir is read-only.
      registry.patchOverlayEntry(target, { tools });
      upstream.tools = tools;
      await server.sendToolListChanged();
      return textResult(`Refreshed "${target}" — ${tools.length} tools cached to ${overlayDir}/${target}/config.json.`);
    } catch (err) {
      // Same record as a failed spawn: without it router__list_upstreams shows
      // a clean upstream after a refresh that failed.
      session[target].lastError = err.message;
      log('error', `Refresh of upstream "${target}" failed: ${err.message}`);
      return errorResult(`Refresh failed for "${target}": ${err.message}`);
    }
  }

  return errorResult(`Unknown meta-tool: ${name}`);
};

// ---------- Request handlers ----------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [...META_TOOLS];
  for (const [name, upstream] of Object.entries(upstreams)) {
    if (!session[name].active || !upstream.enabled_on_disk) continue;
    if (upstream.tools.length === 0) {
      log('warn', `Upstream "${name}" active but has no cached tools; skipping. Run \`omega-mcp refresh ${name}\`.`);
      continue;
    }
    for (const tool of upstream.tools) {
      tools.push({
        name: `${name}__${tool.name}`,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    }
  }
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const fullName = request.params.name;
  const args = request.params.arguments || {};

  if (fullName.startsWith('router__')) {
    return callMetaTool(fullName, args);
  }

  const separator = fullName.indexOf('__');
  if (separator === -1) {
    return errorResult(`Tool name "${fullName}" is not in <upstream>__<tool> format`);
  }

  const upstreamName = fullName.slice(0, separator);
  const toolName = fullName.slice(separator + 2);
  const upstream = upstreams[upstreamName];

  if (!upstream) return errorResult(`Unknown upstream: ${upstreamName}`);
  if (!upstream.enabled_on_disk) {
    return errorResult(
      `Upstream "${upstreamName}" is disabled on disk. Run \`omega-mcp enable ${upstreamName}\` to enable it.`,
    );
  }
  if (!session[upstreamName].active) {
    return errorResult(
      `Upstream "${upstreamName}" is inactive in this session. Call router__enable_upstream first.`,
    );
  }

  try {
    if (!session[upstreamName].client) {
      // Concurrent cold calls share ONE in-flight spawn — otherwise both would
      // spawn a child and the loser's process would leak.
      if (!session[upstreamName].spawning) {
        session[upstreamName].spawning = spawnUpstream(upstreamName).finally(() => {
          session[upstreamName].spawning = null;
        });
      }
      await session[upstreamName].spawning;
    }
    const result = await session[upstreamName].client.callTool({ name: toolName, arguments: args });
    session[upstreamName].lastError = null;
    return result;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    session[upstreamName].lastError = message;
    log('error', `callTool "${fullName}" failed: ${message}`);
    return errorResult(`Upstream "${upstreamName}" failed: ${message}`);
  }
});

// ---------- Startup ----------

const main = async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'Router ready on stdio');
};

main().catch((err) => {
  log('fatal', err && err.stack ? err.stack : String(err));
  process.exit(1);
});

// Graceful shutdown — kill any spawned upstreams.
const shutdown = async () => {
  log('info', 'Shutting down; closing upstreams');
  await Promise.all(Object.keys(session).map((name) => killUpstream(name)));
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
