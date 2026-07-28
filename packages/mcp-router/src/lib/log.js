/**
 * The router's log sink. Everything a router process says goes to STDERR —
 * stdout is the MCP wire, and one stray byte on it corrupts the protocol.
 */

/**
 * Write one line to stderr.
 *
 * @param {string} level - `info` | `warn` | `error` | `fatal`
 * @param {...*} args - Message parts, joined with a space
 * @returns {void}
 */
function log(level, ...args) {
  process.stderr.write(`[mcp-router ${level}] ${args.join(' ')}\n`);
}

module.exports = { log };
