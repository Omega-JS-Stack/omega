/**
 * Core signin page module — 3-layer page-module slice, core layer.
 * Boots the real web-manager (@omega.js/client, aliased by the esbuild config)
 * and binds the FormManager-style auth form.
 */
const WebManager = require('web-manager');

const manager = new WebManager();

document.querySelectorAll('form[data-form-manager]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    console.log('[omega:signin] submit via', manager.constructor.name, new FormData(form).get('email'));
  });
});
