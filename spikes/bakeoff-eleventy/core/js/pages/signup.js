/**
 * Core signup page module — 3-layer page-module slice, core layer.
 */
const WebManager = require('web-manager');

const manager = new WebManager();

document.querySelectorAll('form[data-form-manager="signup"]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    console.log('[omega:signup] submit via', manager.constructor.name);
  });
});
