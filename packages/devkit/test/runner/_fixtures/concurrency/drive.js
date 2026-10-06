/**
 * Runs one createRunner config over a fixture in this folder and writes
 * `{ result, error }` to the out file; the reporter prints to this process's
 * own output. Usage: node drive.js <config json> <outFile>
 * The config is `{ fixture, roots?, reporter?, targets?, node?, ...createRunner keys }`,
 * each root `{ dir, cwd? }` relative to the fixture; `node` is the version this
 * process reports as its own.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRunner } = require('../../../../src/test/runner.js');

const [configJson, outFile] = process.argv.slice(2);
const { fixture, roots = [{ dir: 'test' }], reporter = 'json', targets = [], node, ...knobs } = JSON.parse(configJson);
const projectRoot = path.join(__dirname, fixture);

if (node) {
  Object.defineProperty(process.versions, 'node', { ...Object.getOwnPropertyDescriptor(process.versions, 'node'), value: node });
}

function rootOf({ dir, cwd }) {
  const root = { source: 'project', dir: path.join(projectRoot, dir) };
  if (cwd) root.cwd = path.join(projectRoot, cwd);
  return root;
}

async function main() {
  let result = null;
  let error = null;
  try {
    const runner = createRunner({
      framework: 'node',
      title: `Fixture ${fixture}`,
      projectRoot,
      roots: roots.map(rootOf),
      drivers: {},
      log: `${outFile}.log`,
      defaultTimeout: 10000,
      packageName: `fixture-conc-${fixture}`,
      frameworkAliases: [],
      ...knobs,
    });
    result = await runner.run({ targets, reporter });
  } catch (e) {
    error = { message: e.message };
  }
  fs.writeFileSync(outFile, JSON.stringify({ result, error }));
  process.exit(0);
}

main();
