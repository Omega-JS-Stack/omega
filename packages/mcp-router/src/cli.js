/**
 * `omega-mcp` — the management CLI for the router's upstream registry.
 *
 * It reads the LAYERED view (bundled defaults + overlay) and writes ONLY the
 * overlay at `~/.omega/mcp-router/servers/`: enabling, disabling, adding,
 * removing, and caching tool schemas all land there. A bundled default is
 * never edited, only shadowed — for a consumer it lives in node_modules.
 *
 * Registration is not this CLI's job: the omega Claude plugin declares the
 * router in its .mcp.json, so there is nothing to sync into a client config.
 */

const registry = require('./lib/registry.js');
const { resolveSpawn } = require('./lib/env.js');
// The one-shot spawn-connect-list-close the router's own refresh runs, so this
// CLI carries the same deadline, read budget, and failure cleanup. The helper
// requires the SDK only once that path is reached, so commands that don't need
// it (list, help) still work even when node_modules is missing.
const { listToolsOnce } = require('./lib/oneshot.js');

/**
 * Spawn an upstream once, read its tool list, and cache it to the overlay.
 *
 * @param {string} name - Upstream name
 * @param {object} layers - `{ bundledDir, overlayDir }`
 * @returns {Promise<number>} How many tools were cached
 */
async function fetchAndCacheSchema(name, layers) {
  const upstream = registry.loadUpstream(name, layers);
  if (!upstream) throw new Error(`Server "${name}" not found`);
  if (!upstream.command) throw new Error(`Server "${name}" has no command`);

  const spawn = resolveSpawn(upstream);
  const tools = await listToolsOnce({
    command: spawn.command,
    args: spawn.args,
    env: { ...process.env, ...spawn.env },
  });

  registry.patchOverlayEntry(name, { tools }, layers);
  return tools.length;
}

const HELP = `
Usage: omega-mcp <command> [name] [args...]

Commands:
  list, ls              List all upstream servers, status, and cached tool counts
  enable, on <name>     Enable an upstream (auto-refreshes schema cache)
                        --force overrides a "locked": true upstream
  disable, off <name>   Disable an upstream
  add <name> <cmd> ...  Add a private upstream (auto-refreshes schema cache)
  remove, rm <name>     Remove a private upstream (bundled defaults: disable instead)
  refresh <name>        Re-fetch and cache an upstream's tool schemas

Architecture:
  All upstreams are proxied through a single MCP server, "mcp-router".
  Tools surface to Claude as: mcp__mcp-router__<upstream>__<tool>
  Upstreams are lazy-spawned: no child processes until a tool is actually called.

  Config is layered: the defaults bundled with @omega.js/mcp-router, then your
  overlay at ~/.omega/mcp-router/servers/<name>/config.json, whose top-level
  keys win. Every command here writes the overlay only. Secrets go in
  ~/.omega/mcp-router/.env and reach a command as \${NAME} placeholders.

  Per-chat control (from inside Claude):
    router__list_upstreams, router__enable_upstream, router__disable_upstream,
    router__refresh_upstream

  Per-server config supports an optional "default": "auto" | "on-demand" field.
  "on-demand" upstreams require Claude to call router__enable_upstream before
  their tools become visible — useful for noisy servers.

  An overlay entry may also carry "locked": true. A locked upstream refuses
  every enable: this CLI's (unless you pass --force) and the per-chat
  router__enable_upstream, which has no override. Disable and remove stay open.

Examples:
  omega-mcp list
  omega-mcp enable chrome-devtools-extension
  omega-mcp disable chrome-devtools
  omega-mcp add my-server npx -y my-mcp-server@latest
  omega-mcp refresh chrome-devtools
`;

/**
 * Run one CLI invocation.
 *
 * @param {string[]} argv - Arguments after the bin name
 * @param {object} [options] - `{ bundledDir, overlayDir, out, err }` (tests inject all four)
 * @returns {Promise<number>} Process exit code
 */
async function run(argv, options = {}) {
  const layers = registry.layers(options);
  const out = options.out || ((line) => console.log(line));
  const err = options.err || ((line) => console.error(line));

  // `--force` is a flag on the command, never part of an added upstream's own
  // command line, so it is stripped for the command/name positions only, and
  // `add` keeps reading the RAW argv for the command it is being handed.
  const force = argv.includes('--force');
  const positional = argv.filter((arg) => arg !== '--force');
  const command = positional[0];
  const name = positional[1];

  /**
   * Best-effort cache refresh — report failure but never abort the caller.
   *
   * @param {string} target - Upstream name
   * @returns {Promise<void>} Always resolves
   */
  const tryRefresh = async (target) => {
    try {
      const count = await fetchAndCacheSchema(target, layers);
      out(`Cached ${count} tool(s) for "${target}"`);
    } catch (error) {
      err(`Warning: could not cache schema for "${target}": ${error.message}`);
      err(`Run \`omega-mcp refresh ${target}\` later to retry.`);
    }
  };

  if ((command === 'enable' || command === 'on' || command === 'disable' || command === 'off') && name) {
    const upstream = registry.loadUpstream(name, layers);
    if (!upstream) {
      err(`Server "${name}" not found`);
      return 1;
    }
    const enabled = command === 'enable' || command === 'on';
    // A lock guards WAKING an upstream only: disable stays open.
    if (enabled && upstream.locked && !force) {
      err(registry.lockedRefusal(name));
      return 1;
    }
    registry.patchOverlayEntry(name, { enabled }, layers);
    out(`${enabled ? 'Enabled' : 'Disabled'} ${name}`);
    if (enabled) await tryRefresh(name);
    return 0;
  }

  if (command === 'add') {
    const commandArgs = argv.slice(2);
    if (!name || commandArgs.length === 0) {
      err('Usage: omega-mcp add <name> <command> [args...]');
      err('Example: omega-mcp add firebase npx -y firebase-tools@latest mcp');
      return 1;
    }
    if (registry.loadUpstream(name, layers)) {
      err(`Server "${name}" already exists. Remove it first or edit its config.json directly.`);
      return 1;
    }
    registry.patchOverlayEntry(name, { enabled: true, command: commandArgs[0], args: commandArgs.slice(1) }, layers);
    out(`Added ${name}`);
    await tryRefresh(name);
    return 0;
  }

  if ((command === 'remove' || command === 'rm') && name) {
    if (!registry.removeOverlayEntry(name, layers)) {
      if (registry.isBundled(name, layers)) {
        err(`Server "${name}" is a bundled default and cannot be removed. Run \`omega-mcp disable ${name}\` instead.`);
      } else {
        err(`Server "${name}" not found`);
      }
      return 1;
    }
    out(registry.isBundled(name, layers)
      ? `Removed your overrides for ${name} — the bundled default is back in effect`
      : `Removed ${name}`);
    return 0;
  }

  if (command === 'refresh' && name) {
    try {
      const count = await fetchAndCacheSchema(name, layers);
      out(`Cached ${count} tool(s) for "${name}"`);
      return 0;
    } catch (error) {
      err(`Refresh failed for "${name}": ${error.message}`);
      return 1;
    }
  }

  if (command === 'list' || command === 'ls') {
    out('\nMCP Servers (proxied through mcp-router):\n');
    for (const upstream of Object.values(registry.loadUpstreams(layers))) {
      const status = upstream.enabled_on_disk ? '\x1b[32m●\x1b[0m' : '\x1b[90m○\x1b[0m';
      const mode = upstream.default === 'on-demand' ? ' [on-demand]' : '';
      const locked = upstream.locked ? ' [locked]' : '';
      const source = upstream.bundled ? (upstream.overlaid ? ' (bundled, overridden)' : ' (bundled)') : ' (yours)';
      const tools = upstream.tools.length ? ` (${upstream.tools.length} tools cached)` : ' (no cache)';
      out(`  ${status} ${upstream.name}${mode}${locked}${source}${tools}`);
    }
    out('');
    return 0;
  }

  if (command === 'help' || !command) {
    out(HELP);
    return 0;
  }

  err(`Unknown command: ${command}`);
  err('Run "omega-mcp help" for usage information.');
  return 1;
}

/**
 * The bin entry — run argv and set the process exit code.
 *
 * @returns {void}
 */
function main() {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err && err.stack ? err.stack : String(err));
      process.exitCode = 1;
    });
}

module.exports = { run, main, fetchAndCacheSchema };
