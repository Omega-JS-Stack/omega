// '@omega.js/backend/migrate': resolvable without an exports map (this package
// deliberately has none). The leg the brand root's `omega migrate` runs
// in-process, the one subpath every framework exposes.
module.exports = require('./dist/cli/utils/migrate.js');
