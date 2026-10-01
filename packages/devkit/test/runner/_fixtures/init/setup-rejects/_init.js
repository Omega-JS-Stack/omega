module.exports = () => ({
  async setup() {
    throw new Error('setup rejected boom');
  },
});
