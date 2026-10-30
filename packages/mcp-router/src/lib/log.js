/**
 * The router's log sink, the ONE every process this package starts writes
 * through. Everything goes to STDERR: stdout is the MCP wire, and one stray
 * byte on it corrupts the protocol. Every line carries the family tag,
 * `[@omega.js/mcp-router:<module>]`.
 */

/**
 * A logger for one module of the router.
 *
 * @param {string} module - The tag's module segment (`router`, `omega-extension`).
 * @returns {function(string, ...*): void} `log(level, ...args)`, parts joined with a space.
 */
function createLog(module) {
  const tag = `[@omega.js/mcp-router:${module}]`;
  return (level, ...args) => {
    process.stderr.write(`${tag} ${level}: ${args.join(' ')}\n`);
  };
}

/**
 * The router's own lines.
 *
 * @param {string} level - `info` | `warn` | `error` | `fatal`
 * @param {...*} args - Message parts, joined with a space
 * @returns {void}
 */
const log = createLog('router');

module.exports = { log, createLog };
