/**
 * The socket-free contract, asserted rather than assumed: a plain `omega test`
 * arms the runner's connect trap before any suite runs, so nothing here can reach
 * the REAL Firebase project with whatever credentials the environment carries.
 * Nothing here is yours to fill in: leave it as shipped.
 */
const net = require('node:net');
const dns = require('node:dns');
const { defineCases, expect } = require('@omega.js/backend/test');

// `--extended` and `--lane=` runs exist to reach real services, so the runner arms no trap there
const STANDS_DOWN = process.env.TEST_EXTENDED_MODE || process.env.OMEGA_TEST_LANE
  ? 'the connect trap stands down under --extended and --lane='
  : false;

module.exports = defineCases({
  description: 'Socket-free: the connect trap is armed and refuses',
  type: 'group',

  tests: [
    {
      name: 'the-connect-trap-is-armed',
      skip: STANDS_DOWN,

      run() {
        expect(globalThis.__omegaConnectTrap?.installed, 'the connect trap is not armed: a plain run can reach the network').toBeTruthy();
      },
    },

    {
      name: 'a-tcp-connect-past-loopback-is-refused',
      skip: STANDS_DOWN,

      run() {
        expect(() => new net.Socket().connect(443, 'firestore.googleapis.com'), 'a TCP connect went through: the live Firestore is one call away').toThrow((e) => e.code === 'CONNECT_TRAP');
      },
    },

    {
      name: 'resolving-a-hostname-past-loopback-is-refused',
      skip: STANDS_DOWN,

      run() {
        expect(() => dns.lookup('firestore.googleapis.com', () => {}), 'a DNS lookup went through').toThrow((e) => e.code === 'CONNECT_TRAP');
      },
    },
  ],
});
