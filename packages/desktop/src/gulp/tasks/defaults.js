// The LOCAL half of the retired `omega setup`, on the gulp lane
// ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
//
// This task is the first step of the gulp `build` series, so `npm start` (the
// dev lane, which is gulp and nothing else) and every gulp-driven verb heal the
// consumer tree on the way past — scripts, .nvmrc, peer deps, the defaults
// tree, the locality warning. Idempotent and quiet: a converged target writes
// nothing. The non-gulp verbs (`omega test`, `omega deploy`) call ensureTarget
// themselves.
const build = require('../../build.js');
const logger = build.logger('defaults');
const { ensureTarget } = require('../../commands/lib/ensure-target.js');

module.exports = async function defaults() {
  await ensureTarget({
    projectDir: build.getRootPath('project'),
    log: (line) => logger.log(line),
    warn: (line) => logger.warn(line),
  });
};
