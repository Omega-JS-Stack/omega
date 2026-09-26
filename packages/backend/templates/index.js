/*
  Initialize
*/
const omega = require('@omega.js/backend');

omega.initialize({
});

/*
  Routes
  Add custom routes below. Built-in routes (auth, payments, newsletters,
  usage, etc.) are registered automatically by OMEGA Backend.
*/

module.exports = omega.functions;
