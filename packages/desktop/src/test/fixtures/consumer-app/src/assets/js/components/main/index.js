// Minimal main-window renderer entry for the boot-layer self-test fixture.
import omega from '@omega.js/desktop/renderer';

omega.initialize();

// #925 pins that this renderer answers the lane's environment and not the word
// baked into the bundle, so the boot inspect needs a handle on the instance the
// answer is given on.
window.__omegaInstance = omega;

// #111 pins that a vendored core module resolves through the renderer's
// `__main_assets__` alias: an alias that does not resolve fails this fixture's
// build, and the boot inspect reads the export it bound.
window.__omegaCreateShell = require('__main_assets__/js/core/app-shell.js').createShell;
