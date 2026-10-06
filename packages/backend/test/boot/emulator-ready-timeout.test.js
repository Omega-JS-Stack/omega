/**
 * The emulator ready deadline ([#332](https://github.com/Omega-JS-Stack/omega/issues/332)):
 * a real boot can take past 60s when the port sweep stalls (lsof against a
 * network mount), so the cap is env-tunable with a default that absorbs a slow
 * boot. A junk value fails loudly instead of silently racing an unknown
 * deadline (the #211 junk-multiplier precedent).
 */

const EmulatorCommand = require('../../dist/cli/commands/emulator.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

module.exports = defineCases({
  description: 'Emulator ready deadline — env-tunable, junk fails loudly (#332)',
  type: 'group',

  tests: [
    {
      name: 'ready-timeout-defaults-high-enough-to-absorb-a-slow-port-sweep',
      async run({ expect }) {
        expect(EmulatorCommand.resolveReadyTimeout(undefined), 'no override reads the default').toBe(180000);
        expect(EmulatorCommand.resolveReadyTimeout(''), 'an empty override reads the default').toBe(180000);
      },
    },
    {
      name: 'ready-timeout-env-override-is-respected-in-ms',
      async run({ expect }) {
        expect(EmulatorCommand.resolveReadyTimeout('240000'), 'a numeric override wins').toBe(240000);
      },
    },
    {
      name: 'a-junk-override-fails-loudly-instead-of-racing-an-unknown-deadline',
      async run({ expect }) {
        for (const junk of ['soon', '-5', '0', 'NaN']) {
          let threw = null;
          try {
            EmulatorCommand.resolveReadyTimeout(junk);
          } catch (error) {
            threw = error;
          }
          expect(threw, `"${junk}" must throw instead of racing an unknown deadline`).toBeTruthy();
          expect(threw.message, 'the error names the knob').toMatch(/OMEGA_EMULATOR_READY_TIMEOUT/);
        }
      },
    },
  ],
});
