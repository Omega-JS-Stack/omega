const { test } = require('node:test');

function x() {
  return true;
}

test('a', (t) => {
  t.after(() => x());
  t.diagnostic;
});
