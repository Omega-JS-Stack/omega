/**
 * Test: a plain run discovers test/unit/ and arms the runner's connect trap
 * (loopback passes, anything else throws); `--extended` and `--lane=` stand it
 * down. Run: npx omega test backend:cli/runner-connect-trap
 */
const fs = require('node:fs');
const { stageProject, runRunnerChild } = require('./_runner-child.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// A unit suite that reports the trap state it sees and, when armed, proves the rule
const PROBE = `
const net = require('node:net');
module.exports = {
  description: 'connect-trap probe',
  type: 'group',
  tests: [{
    name: 'trap-state',
    async run({ assert }) {
      const expected = process.env.PROBE_EXPECT_TRAP === 'true';
      assert.equal(Boolean(globalThis.__omegaConnectTrap?.installed), expected, 'the trap state');
      if (!expected) return;

      const server = net.createServer((socket) => socket.end());
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      await new Promise((resolve, reject) => {
        const socket = net.connect(server.address().port, '127.0.0.1', () => { socket.end(); resolve(); });
        socket.on('error', reject);
      });
      server.close();

      let code = null;
      try { new net.Socket().connect(443, 'firestore.googleapis.com'); } catch (error) { code = error.code; }
      assert.equal(code, 'CONNECT_TRAP', 'a non-loopback connect is refused');
    },
  }],
};
`;

/** Run the probe with the given lane env and return the child's result. */
function probe(env) {
  const dir = stageProject({ 'unit/probe.test.js': PROBE });
  try {
    return runRunnerChild(dir, env);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = defineCases({
  description: 'The runner installs the connect trap on a plain run, and stands it down for extended and lane runs',
  type: 'group',
  timeout: 90000,

  tests: [
    {
      name: 'a-plain-run-discovers-unit-and-arms-the-trap-with-loopback-allowed',
      auth: 'none',

      async run({ assert }) {
        const run = probe({ PROBE_EXPECT_TRAP: 'true' });
        assert.equal(run.status, 0, run.output);
        assert.ok(run.output.includes('trap-state'), `test/unit/ was discovered: ${run.output}`);
      },
    },
    {
      name: 'an-extended-run-stands-the-trap-down',
      auth: 'none',

      async run({ assert }) {
        const run = probe({ PROBE_EXPECT_TRAP: 'false', TEST_EXTENDED_MODE: 'true' });
        assert.equal(run.status, 0, run.output);
      },
    },
    {
      name: 'a-lane-run-stands-the-trap-down',
      auth: 'none',

      async run({ assert }) {
        const run = probe({ PROBE_EXPECT_TRAP: 'false', OMEGA_TEST_LANE: 'stripe-live' });
        assert.equal(run.status, 0, run.output);
      },
    },
  ],
});
