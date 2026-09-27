// '@omega.js/backend/cli' — resolvable without an exports map (this package
// deliberately has none). Used by the omega/omg cross-framework dispatcher.
module.exports = require('./dist/cli/run.js');

// Runnable as a file: the package's own `npm test` calls it directly, never through the dispatcher
if (require.main === module) module.exports.run();
