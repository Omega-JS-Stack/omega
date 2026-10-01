const defineCases = require('../../../../../src/test/define-cases.js');

// The fake driver runs these in its "app"; a body here running on the host is a bug.
const hostRan = () => {
  throw new Error('an app case body ran on the host');
};

module.exports = defineCases({
  type: 'group',
  description: 'in-app suite',
  layer: 'background',
  tests: [
    { name: 'reports pass', run: hostRan },
    { name: 'reports fail', run: hostRan },
    { name: 'reports skip', run: hostRan },
  ],
});
