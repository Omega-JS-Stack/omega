const fs = require('node:fs');

module.exports = () => ({
  async setup() {
    fs.appendFileSync(process.env.FIXTURE_OUT, 'setup\n');
  },
});
