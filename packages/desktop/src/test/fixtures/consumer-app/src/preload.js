// Minimal preload for the boot-layer self-test fixture. Exposes window.desktop to the renderer.
const Manager = require('@omega.js/desktop/preload');

new Manager().initialize();
