// cli-router test fixture — always fails, proving errors rethrow to the bin
module.exports = async () => {
  throw new Error('kaboom');
};
