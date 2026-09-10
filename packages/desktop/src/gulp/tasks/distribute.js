// STUB — stage consumer src/ + @omega.js/desktop dist/ into .desktop-build/ for the `bundle` task to consume.
const Manager = new (require('../../build.js'));
const logger = Manager.logger('distribute');

module.exports = function distribute(done) {
  logger.log('distribute (stub)');
  done();
};
