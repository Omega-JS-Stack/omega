// cli-router test fixture — records its run on the options object
module.exports = async (options) => {
  options.__ran = 'install';
};
