/**
 * The socket-free contract, asserted rather than assumed: a plain `omega test`
 * arms the runner's connect trap before any suite runs, so nothing here can reach
 * the REAL Firebase project with whatever credentials the environment carries.
 * Nothing here is yours to fill in: leave it as shipped.
 */
const assert = require('node:assert/strict');
const net = require('node:net');
const dns = require('node:dns');
const defineCases = require('@omega.js/backend/dist/vendor/devkit/test/define-cases.js');

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
        assert.ok(
          globalThis.__omegaConnectTrap?.installed,
          'the connect trap is not armed: a plain run can reach the network',
        );
      },
    },

    {
      name: 'a-tcp-connect-past-loopback-is-refused',
      skip: STANDS_DOWN,

      run() {
        assert.throws(
          () => new net.Socket().connect(443, 'firestore.googleapis.com'),
          (e) => e.code === 'CONNECT_TRAP',
          'a TCP connect went through: the live Firestore is one call away',
        );
      },
    },

    {
      name: 'resolving-a-hostname-past-loopback-is-refused',
      skip: STANDS_DOWN,

      run() {
        assert.throws(
          () => dns.lookup('firestore.googleapis.com', () => {}),
          (e) => e.code === 'CONNECT_TRAP',
          'a DNS lookup went through',
        );
      },
    },
  ],
});
