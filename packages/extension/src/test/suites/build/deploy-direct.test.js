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
const attachLogFile = require('@omega.js/devkit/attach-log-file');

const COMMANDS = path.join(__dirname, '..', '..', '..', 'commands');
const DEPLOY = path.join(COMMANDS, 'deploy.js');
const WORKFLOW = path.join(__dirname, '..', '..', '..', 'defaults', '.github', 'workflows', 'publish.yml');

// The scripts every target gets from the scaffold, read from the one place that
// declares them: expanding a command through THESE is what makes a second
// publish visible.
const SCRIPTS = require(path.join(__dirname, '..', '..', '..', '..', 'package.json')).projectScripts;

const { deployDirect } = require(DEPLOY);

/**
 * The CI lane, read from the workflow the scaffold writes: the publish flag its
 * env carries and the ONE command its build step runs. `--direct` runs exactly
 * this ([#865](https://github.com/Omega-JS-Stack/omega/issues/865)), so the
 * test takes both from the file instead of repeating them.
 *
 * @returns {{ flag: boolean, command: string }} The flag and the command CI runs.
 */
function ciPublishLane() {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n').map((line) => line.trim());

  return {
    flag: lines.includes(`OMEGA_IS_PUBLISH: 'true'`),
    // `- name: <step>` then `run: |` then the command.
    command: lines[lines.indexOf('- name: Build and publish extension') + 2],
  };
}

/**
 * How many times a command ENTERS the gulp publish task, expanded through the
 * target's real scripts. `omega build` ends in that task (`gulp/main.js`'s
 * `exports.build` closes with `exports.publish`) and the `publish` script IS
 * that task, so `npm run build && npm run publish` entered it twice: a local
 * deploy that published the same version to every store twice over
 * ([#865](https://github.com/Omega-JS-Stack/omega/issues/865)).
 *
 * @param {string} command - What the lane hands the shell.
 * @returns {number} entries into the publish task
 */
function publishEntries(command) {
  return command.split('&&').reduce((count, piece) => {
    // Leading `KEY=value` assignments are env, not the command.
    const part = piece.trim().replace(/^(\S+=\S+\s+)+/, '');

    if (part.endsWith('gulp -- publish')) return count + 1;
    if (part === 'omega build' || part.endsWith('gulp -- build')) return count + 1;

    const script = SCRIPTS[(part.match(/^npm run (\S+)$/) || [])[1]];

    return script ? count + publishEntries(script) : count;
  }, 0);
}

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

  // A target, not a bare directory: the verb runs the consumer's
  // `hooks/deploy/pre.js` on the way past ([#900](https://github.com/Omega-JS-Stack/omega/issues/900)),
  // and the package task that loads hooks reads the project from cwd.
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"extension-deploy-direct-test"}');

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
      name: '--direct runs the ONE command CI runs, so the publish task is entered ONCE (#865)',
      run: (ctx) => {
        const ran = [];
        inTempDir(() => deployDirect({ exec: (command, options) => ran.push({ command, env: (options || {}).env || {} }) }));
        const ci = ciPublishLane();

        // The two lanes are ONE command: the workflow's own build step, with the
        // publish flag set the way the workflow sets it (an env var on the one
        // process, never a second `npm run publish` behind it).
        ctx.expect(ci.flag).toBe(true);
        ctx.expect(publishEntries(ran[0].command)).toBe(1);
        ctx.expect(ran.map((entry) => entry.command)).toEqual([ci.command]);
        ctx.expect(ran[0].env.OMEGA_IS_PUBLISH).toBe('true');
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
          ctx.expect(ran).toEqual(['ensure-target', 'npm run build']);
        } finally {
          // The verb tees this process' writers now (#873): hand them back.
          attachLogFile.detach();
          for (const restore of restores) restore();
          if (cached) require.cache[resolved] = cached;
          else delete require.cache[resolved];
        }
      },
    },
  ],
});
