/**
 * Run a framework's `omega test` verb in process under an outer log tee, the
 * one harness the desktop and extension verb-logs suites share.
 *
 * The verb's attach is DECLINED (CI set for the call) so it pushes no layer of
 * its own; the result says whether the tee underneath still receives after
 * the verb returns, which is what a blind detach would break.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');
const attachLogFile = require('../attach-log-file.js');

/**
 * @param {object} options
 * @param {string} options.commands - The framework's commands dir (holds test.js and lib/ensure-target.js)
 * @param {string} options.prefix - The tmpdir prefix for the empty consumer dir
 * @param {string[]} options.positionals - The verb's `_` after `test`
 * @returns {Promise<{ outer: string, exitCodes: number[] }>} The outer log and any process.exit codes
 */
async function runTestVerbUnderOuterTee({ commands, prefix, positionals }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test-verb-fixture' }));
  const outerPath = path.join(dir, 'outer.log');

  // ensureTarget scaffolds a real target; the verb destructures it at load.
  const ensurePath = require.resolve(path.join(commands, 'lib', 'ensure-target.js'));
  const cachedEnsure = require.cache[ensurePath];
  const stub = new Module(ensurePath);
  stub.filename = ensurePath;
  stub.loaded = true;
  stub.exports = { ensureTarget: async () => {} };
  require.cache[ensurePath] = stub;
  const verbPath = require.resolve(path.join(commands, 'test.js'));
  const cachedVerb = require.cache[verbPath];
  delete require.cache[verbPath];

  const prior = { cwd: process.cwd(), exitCode: process.exitCode, exit: process.exit, log: console.log, CI: process.env.CI };
  const exitCodes = [];
  const restoreTee = attachLogFile.mark();
  attachLogFile(outerPath, { env: {} });

  try {
    process.chdir(dir);
    console.log = () => {};
    // Stubbed only because the green path ends the process.
    process.exit = (code) => { exitCodes.push(code); };
    process.env.CI = 'true';
    await require(verbPath)({ _: ['test', ...positionals] });
    process.stdout.write('after the verb\n');
  } finally {
    if (prior.CI === undefined) delete process.env.CI;
    else process.env.CI = prior.CI;
    process.exit = prior.exit;
    console.log = prior.log;
    process.exitCode = prior.exitCode;
    process.chdir(prior.cwd);
    restoreTee();
    if (cachedEnsure) require.cache[ensurePath] = cachedEnsure;
    else delete require.cache[ensurePath];
    if (cachedVerb) require.cache[verbPath] = cachedVerb;
    else delete require.cache[verbPath];
  }

  const outer = fs.readFileSync(outerPath, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return { outer, exitCodes };
}

module.exports = { runTestVerbUnderOuterTee };
