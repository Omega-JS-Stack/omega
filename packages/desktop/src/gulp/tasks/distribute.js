// STUB — stage consumer src/ + @omega.js/desktop dist/ into .desktop-build/ for the `bundle` task to consume.
const build = require('../../build.js');
const logger = build.logger('distribute');

module.exports = function distribute(done) {
  logger.log('distribute (stub)');
  done();
};
