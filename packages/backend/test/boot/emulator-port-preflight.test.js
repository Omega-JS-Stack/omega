/**
 * The emulator boot's port handling ([#332](https://github.com/Omega-JS-Stack/omega/issues/332)):
 *
 *   1. The sweeps map a port to a pid with `lsof`, which stats every mounted
 *      filesystem before it answers (seconds per call against an smbfs Time
 *      Machine volume) and used to run once per port whether or not anything
 *      was listening. A free port cannot have a holder, so the lookup is now
 *      gated behind a bind probe and only a HELD port is ever looked up.
 *   2. A boot whose plan cannot work says so before it spawns firebase,
 *      naming the ports somebody else holds, instead of stalling until the
 *      ready deadline expires.
 */

const net = require('net');
const os = require('os');
const EmulatorCommand = require('../../dist/cli/commands/emulator.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// A command instance needs nothing from the project to sweep ports.
function makeCommand() {
  const command = new EmulatorCommand({ firebaseProjectPath: os.tmpdir(), argv: {}, options: {} });
  command.log = () => {};
  return command;
}

module.exports = defineCases({
  description: 'Emulator port preflight and the gated port sweep (#332)',
  type: 'group',

  tests: [
    {
      name: 'the-shutdown-sweep-is-gated-the-same-way',
      async run({ expect }) {
        const command = makeCommand();
        const lookedUp = [];

        await command.terminateOrphanedEmulatorProcesses({ functions: 5001, firestore: 8080, https: 5002 }, {
          sweepShared: true,
          isFree: async (port) => port !== 4400,
          listPids: (port) => {
            lookedUp.push(port);
            return [];
          },
        });

        expect(lookedUp, 'the shared hub port was the only one held, so it was the only lookup').toEqual([4400]);
      },
    },
    {
      name: 'held-ports-are-the-only-ones-the-probe-reports',
      async run({ expect }) {
        const held = await EmulatorCommand.heldPorts([5001, 8080, 5001], async (port) => port === 5001);

        expect(held, 'free ports drop out and duplicates collapse').toEqual([8080]);
        expect(await EmulatorCommand.heldPorts([5001, 8080], async () => true), 'an all-clear sweep has nothing to look up').toEqual([]);
      },
    },
    {
      name: 'the-plan-is-every-port-the-child-will-bind-with-the-resolved-values-winning',
      async run({ expect }) {
        const planned = EmulatorCommand.plannedEmulatorPorts(
          { auth: 9099, functions: 5001, eventarc: 9299, ui: 4050 },
          { auth: 9100, functions: 5001, https: 5002 },
        );

        expect(planned, 'a bumped port replaces its declared value, an unmanaged declared port stays, and https (this process own proxy) is out').toEqual([
          { name: 'auth', port: 9100 },
          { name: 'functions', port: 5001 },
          { name: 'eventarc', port: 9299 },
          { name: 'ui', port: 4050 },
        ]);
      },
    },
    {
      name: 'a-held-port-fails-the-boot-with-a-report-naming-it',
      async run({ expect }) {
        const planned = [{ name: 'auth', port: 9099 }, { name: 'pubsub', port: 8085 }];
        let threw = null;

        try {
          await EmulatorCommand.assertPlannedPortsFree(planned, async (port) => port !== 8085);
        } catch (error) {
          threw = error;
        }

        expect(threw, 'a held port must stop the boot instead of stalling until the ready deadline').toBeTruthy();
        expect(threw.message, 'the report names the held port').toMatch(/8085/);
        expect(threw.message, 'the report names the emulator that wanted it').toMatch(/pubsub/);
        expect(!/9099/.test(threw.message), 'a free port is not reported as a blocker').toBeTruthy();
        expect(threw.message, 'the report says which other dev stack to stop').toMatch(/omega dev/);
      },
    },
    {
      name: 'an-all-clear-plan-proceeds',
      async run({ expect }) {
        const planned = [{ name: 'auth', port: 9099 }, { name: 'pubsub', port: 8085 }];
        let threw = null;

        try {
          await EmulatorCommand.assertPlannedPortsFree(planned, async () => true);
        } catch (error) {
          threw = error;
        }

        expect(threw, 'nothing holds a planned port, so the boot proceeds').toBe(null);
      },
    },
    {
      name: 'the-emulator-running-check-reads-a-real-listener-without-shelling-out',
      async run({ expect }) {
        const server = net.createServer();
        const port = await new Promise((resolve) => {
          server.listen(0, '127.0.0.1', () => resolve(server.address().port));
        });

        const command = makeCommand();

        expect(await command.isPortInUse(port), 'a live listener reads as in use').toBe(true);

        await new Promise((resolve) => server.close(resolve));

        expect(await command.isPortInUse(port), 'the released port reads as free').toBe(false);
      },
    },
  ],
});
