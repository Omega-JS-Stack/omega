// '@omega.js/backend/ensure-target': resolvable without an exports map (this
// package deliberately has none). The scaffold the brand-root deploy fan-out
// calls in-process, the one subpath every framework exposes (#901).
module.exports = require('./dist/cli/utils/ensure-target.js');
