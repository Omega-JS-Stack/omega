// The source text of devkit's run-case.js and expect.js, the one place desktop
// reads them: a page has no `require`, so its engine (renderer-entry.js)
// evaluates both texts and runs its suites through them.
const jetpack = require('fs-jetpack');

/**
 * Both engine modules as text.
 * @returns {{runCase: string, expect: string}} The two sources.
 */
function engineSources() {
  return {
    runCase: jetpack.read(require.resolve('@omega.js/devkit/test/run-case')),
    expect: jetpack.read(require.resolve('@omega.js/devkit/test/expect')),
  };
}

module.exports = { engineSources };
