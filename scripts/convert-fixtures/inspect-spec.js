/**
 * Print the spec a converted suite file exports, as JSON on stdout: the
 * shape convert-suites.test.js asserts. Each function becomes its source text.
 * Usage: node inspect-spec.js <file>
 */
const path = require('node:path');

function source(fn) {
  return typeof fn === 'function' ? fn.toString() : null;
}

function describeCase(entry) {
  return {
    name: entry.name,
    keys: Object.keys(entry).sort(),
    nested: Array.isArray(entry.tests),
    skip: entry.skip,
    timeout: entry.timeout,
    run: source(entry.run),
  };
}

const spec = require(path.resolve(process.argv[2]));

process.stdout.write(JSON.stringify({
  type: spec.type,
  description: spec.description,
  setup: source(spec.setup),
  cleanup: source(spec.cleanup),
  tests: Array.isArray(spec.tests) ? spec.tests.map(describeCase) : null,
}));
