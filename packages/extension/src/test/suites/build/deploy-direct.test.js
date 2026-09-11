// Build-layer test for `omega deploy --direct`
// ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
//
// The local lane is now a FLAG, not a detection: a brand tree carrying a
// `file:` @omega.js spec used to switch itself here, which took the CI lane
// away from exactly the brands that need it most (a linked brand now packs its
// frameworks into the snapshot the runner installs). `--direct` is how a human
// asks for the build-and-store-publish-from-here lane instead.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const defineCases = require('@omega.js/devkit/test/define-cases');

const COMMANDS = path.join(__dirname, '..', '..', '..', 'commands');
const DEPLOY = path.join(COMMANDS, 'deploy.js');

const { deployDirect } = require(DEPLOY);

/**
 * Swap ONE module for a recorder and hand back the undo. The precheck is the
 * network boundary (it publishes this target's store credentials as Actions
 * secrets), so proving `--direct` never reaches it means standing exactly
 * there: everything else in the verb is the real code.
 *
 * @param {string} file - The module to replace.
 * @param {object} exports - What it exports for the duration.
 * @returns {Function} The restore.
 */
function stubModule(file, exports) {
  const resolved = require.resolve(file);
  const previous = require.cache[resolved];
  const stub = new Module(resolved);

  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[resolved] = stub;

  return () => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  };
}

/**
 * Run the lane from a throwaway cwd: a real run stamps the brand's deploy
 * record, and a test must never write one into the brand it happens to be
 * standing in.
 */
function inTempDir(run) {
  const previous = process.cwd();
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'extension-deploy-direct-')));

  process.chdir(tmp);
  try {
    return run();
  } finally {
    process.chdir(previous);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The same, for a lane that awaits: the cwd goes back only once it is DONE. */
async function inTempDirAsync(run) {
  const previous = process.cwd();
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'extension-deploy-direct-')));

  process.chdir(tmp);
  try {
    return await run();
  } finally {
    process.chdir(previous);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'deploy --direct: the local build + store publish, on request',
  tests: [
    {
      name: '--direct runs the release script from this machine',
      run: (ctx) => {
        const ran = [];
        inTempDir(() => deployDirect({ exec: (command) => ran.push(command) }));

        ctx.expect(ran).toEqual(['npm run release']);
      },
    },
    {
      name: 'a dry run prints the plan and runs nothing',
      run: (ctx) => {
        const ran = [];
        inTempDir(() => deployDirect({ dryRun: true, exec: (command) => ran.push(command) }));

        ctx.expect(ran).toEqual([]);
      },
    },
    {
      name: '--direct never runs the NETWORK precheck: a local deploy publishes no secrets (#872)',
      run: async (ctx) => {
        const ran = [];
        const restores = [
          stubModule(path.join(COMMANDS, 'lib', 'ensure-target.js'), { ensureTarget: async () => ran.push('ensure-target') }),
          stubModule(path.join(COMMANDS, 'lib', 'deploy-precheck.js'), { deployPrecheck: async () => ran.push('precheck') }),
        ];
        const resolved = require.resolve(DEPLOY);
        const cached = require.cache[resolved];
        delete require.cache[resolved];

        try {
          const deploy = require(resolved);
          await inTempDirAsync(() => deploy({ direct: true, exec: (command) => ran.push(command) }));

          // The precheck publishes this target's store credentials to the repo's
          // Actions secrets over a `gh` session, and a local deploy asks CI for
          // nothing, so it must never run here.
          ctx.expect(ran).toEqual(['ensure-target', 'npm run release']);
        } finally {
          for (const restore of restores) restore();
          if (cached) require.cache[resolved] = cached;
          else delete require.cache[resolved];
        }
      },
    },
  ],
});
