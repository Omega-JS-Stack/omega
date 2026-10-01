const defineCases = require('../../../../../src/test/define-cases.js');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The first two cases pass but leave errors that land while the slow cases still run.
module.exports = defineCases({
  type: 'group',
  description: 'late errors',
  tests: [
    {
      name: 'leaves a late throw',
      run() {
        setTimeout(() => {
          throw new Error('late throw');
        }, 20);
      },
    },
    {
      name: 'leaves a late reject',
      run() {
        setTimeout(() => {
          Promise.reject(new Error('late reject'));
        }, 20);
      },
    },
    { name: 'slow one', run: () => pause(100) },
    { name: 'slow two', run: () => pause(100) },
  ],
});
