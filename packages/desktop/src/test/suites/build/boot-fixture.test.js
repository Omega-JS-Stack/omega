// The boot fixture's manifest is a CONTRACT with ensure-target
// ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
//
// Every gulp verb now runs ensureTarget first, and the boot runner builds the
// fixture with gulp — so the fixture is judged exactly like a real consumer:
// its peer deps must already be satisfied, and it must declare the framework.
// A fixture that declared NEITHER (its whole manifest was name/version/main)
// made every boot run npm-install electron-builder and gulp from the network,
// and then hard-fail on `No installed version of @omega.js/desktop found in
// dependencies or devDependencies` — 12 boot tests down, offline impossible.
//
// This is the fast-lane pin: a peer added to the framework fails HERE, in
// milliseconds, instead of quietly turning the boot layer back into a network
// install.

const path = require('path');

const Manager = require('../../../build.js');

const package = Manager.getPackage('main');
const fixture = require(path.join(__dirname, '..', '..', 'fixtures', 'consumer-app', 'package.json'));

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'boot fixture manifest — a converged consumer, so the boot layer runs offline',
  tests: [
    {
      name: 'the fixture declares the framework — ensureTarget\'s locality check refuses without it',
      run: (ctx) => {
        ctx.expect(Boolean(fixture.devDependencies[package.name] || (fixture.dependencies || {})[package.name])).toBe(true);
      },
    },
    {
      name: 'the fixture declares every peer the framework requires — nothing installs on a boot run',
      run: (ctx) => {
        const declared = { ...(fixture.dependencies || {}), ...fixture.devDependencies };

        for (const [peer, range] of Object.entries(package.peerDependencies || {})) {
          // The RANGE the framework asks for, verbatim: the peer check compares
          // the declared spec against it, so anything else re-opens the install.
          ctx.expect(declared[peer]).toBe(range);
        }
      },
    },
  ],
};
