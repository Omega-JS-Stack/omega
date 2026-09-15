// Minimal main-window renderer entry for the boot-layer self-test fixture.
const Manager = require('@omega.js/desktop/renderer');

const manager = new Manager();
manager.initialize();

// #925 pins that this renderer answers the lane's environment and not the word
// baked into the bundle, so the boot inspect needs a handle on the Manager the
// answer is given on.
window.__omegaManager = manager;

// #111 — pins that the vendored core module resolves through the renderer's
// `__main_assets__` alias AND runs: with no .omega-shell in this window the
// call registers the shell API on omega._library and returns early, so a
// module that throws on a vendored surface breaks this fixture's boot.
window.__omegaAppShell = require('__main_assets__/js/core/app-shell.js').default;
window.__omegaAppShell();
