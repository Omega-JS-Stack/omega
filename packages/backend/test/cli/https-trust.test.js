/**
 * Test: the children of `omega emulator` and `omega serve` TRUST the local
 * certificate ([#795](https://github.com/Omega-JS-Stack/omega/issues/795)).
 *
 * Both commands used to hand their child `NODE_TLS_REJECT_UNAUTHORIZED=0` — a
 * blanket bypass Node warns about on every boot — because internal calls loop
 * back through the mkcert TLS proxy. They now hand it the mkcert root through
 * `NODE_EXTRA_CA_CERTS` (devkit's `mkcertCaRootPem`), the same variable an
 * `omega dev` leg gets, so the call VERIFIES instead of skipping.
 *
 * A source pin: the branch itself only runs with an https proxy up, which is a
 * booted emulator — nothing here boots, spawns or binds a port.
 *
 * Run: npx omega test backend:cli/https-trust
 */
const fs = require('fs');
const path = require('path');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

const COMMANDS = path.join(__dirname, '..', '..', 'dist', 'cli', 'commands');

module.exports = defineCases({
  description: 'HTTPS children trust the local certificate',
  type: 'group',
  tests: [
    {
      name: 'emulator-and-serve-hand-their-child-the-mkcert-root',
      async run({ assert }) {
        for (const file of ['emulator.js', 'serve.js']) {
          const source = fs.readFileSync(path.join(COMMANDS, file), 'utf8');

          assert.equal(source.includes('NODE_EXTRA_CA_CERTS'), true, `${file} hands its child the trust variable`);
          assert.equal(source.includes('mkcertCaRootPem'), true, `${file} resolves the root through devkit's one lookup`);
        }
      },
    },
  ],
});
