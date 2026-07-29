// Minimal main-window renderer entry for the boot-layer self-test fixture.
const Manager = require('@omega.js/desktop/renderer');

new Manager().initialize();

// #111 — pins that the vendored core module resolves through the renderer's
// `__main_assets__` alias AND runs: with no .omega-shell in this window the
// call registers the shell API on omega._ujLibrary and returns early, so a
// module that throws on a vendored surface breaks this fixture's boot.
window.__omegaAppShell = require('__main_assets__/js/core/app-shell.js').default;
window.__omegaAppShell();
