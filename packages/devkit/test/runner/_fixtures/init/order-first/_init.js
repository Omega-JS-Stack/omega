module.exports = ({ record }) => ({
  async setup() {
    record.push('first');
  },
});
