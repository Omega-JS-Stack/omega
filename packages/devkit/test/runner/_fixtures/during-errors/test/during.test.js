const defineCases = require('../../../../../src/test/define-cases.js');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Each error lands while its own case is still running, outside what the case awaits.
module.exports = defineCases({
  type: 'group',
  description: 'errors during a case',
  tests: [
    {
      name: 'rejects a promise nobody awaits',
      async run() {
        Promise.reject(new Error('during reject'));
        await pause(50);
      },
    },
    {
      name: 'throws from a timer while running',
      async run() {
        setTimeout(() => {
          throw new Error('during throw');
        }, 5);
        await pause(50);
      },
    },
  ],
});
