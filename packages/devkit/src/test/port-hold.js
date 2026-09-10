/**
 * Classic-port holding — how an e2e lane owns a whole stack without ever
 * disturbing the one a developer has running.
 *
 * The N7 allocator starts from the CLASSIC defaults and bumps past anything
 * taken. So a lane that HOLDS every classic port for its own run forces both
 * of its children onto fresh numbers, and a live `omega dev` on :4000 keeps
 * serving. A classic port that is already busy is somebody else's stack: the
 * hold fails, the allocator bumps around it exactly the same, and nothing of
 * theirs is touched.
 *
 * "Held" means all THREE addresses. Node sets SO_REUSEADDR, so a wildcard
 * listener does not stop a 127.0.0.1 bind (and vice versa), and the
 * allocator's own probe composes the same set — anything less is a port that
 * still reads as free.
 */

// Libraries
const net = require('net');
const { CLASSIC_PORTS } = require('@omega.js/config');

// The classics the allocator starts from, plus the two internal ports the
// HTTPS proxies want (web's 4443, the backend's 5443) — holding those too
// keeps a bumped stack from landing back on a number a developer's stack uses.
const CLASSIC_HOLD_PORTS = [...new Set([...Object.values(CLASSIC_PORTS), 4443, 5443])];

// A bind that fails because the ADDRESS FAMILY is not there (no IPv6 on this
// host) is not a busy port — there is nothing to hold and nothing to collide
// with. Same three codes @omega.js/config's own probe forgives, so the hold and
// the allocator read a host the same way. Anything else (EADDRINUSE, EACCES) is
// a real occupant.
const FAMILY_UNAVAILABLE = ['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EINVAL'];

/**
 * Hold one address of one port.
 *
 * @param {number} port - Port to hold
 * @param {string|null} host - Bind address (null = wildcard)
 * @returns {Promise<{ status: 'held'|'busy'|'unavailable', server?: net.Server }>}
 */
function holdAddress(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => resolve({
      status: FAMILY_UNAVAILABLE.includes(error.code) ? 'unavailable' : 'busy',
    }));
    server.listen(host ? { port, host } : { port }, () => resolve({ status: 'held', server }));
  });
}

/**
 * Hold every classic port for the run's duration.
 *
 * @param {number[]} [ports] - Ports to hold (defaults to CLASSIC_HOLD_PORTS)
 * @param {object} [options]
 * @param {Function} [options.bind] - The per-address bind (the test seam)
 * @returns {Promise<{ servers: net.Server[], held: number[], busy: number[] }>}
 */
async function holdClassicPorts(ports = CLASSIC_HOLD_PORTS, { bind = holdAddress } = {}) {
  const servers = [];
  const held = [];
  const busy = [];

  for (const port of ports) {
    const bound = [];
    let occupied = false;

    for (const host of ['127.0.0.1', '::1', null]) {
      const result = await bind(port, host);
      if (result.status === 'held') bound.push(result.server);
      // 'unavailable' is a family this host does not have: nothing to hold
      // there, and nothing anyone else can collide with either.
      if (result.status === 'busy') occupied = true;
    }

    // A port nobody else owns binds on every address this host HAS; a single
    // busy one means a live listener is there — leave it alone, the allocator
    // bumps around it. "Alone" means CLOSING the partial binds too:
    // SO_REUSEADDR lets a more-specific socket win, so keeping a 127.0.0.1
    // bind next to someone else's live listener would steal their localhost
    // traffic for the run.
    if (!occupied && bound.length > 0) {
      held.push(port);
      servers.push(...bound);
    } else {
      busy.push(port);
      releasePorts(bound);
    }
  }

  return { servers, held, busy };
}

/**
 * Release held listeners. Safe to call twice.
 *
 * @param {net.Server[]} servers - The listeners from holdClassicPorts
 */
function releasePorts(servers) {
  for (const server of servers || []) {
    try { server.close(); } catch (e) { /* already closed */ }
  }
}

module.exports = { holdClassicPorts, releasePorts, holdAddress, CLASSIC_HOLD_PORTS, FAMILY_UNAVAILABLE };
