// Build-layer test for `omega deploy --direct`'s platform guard
// ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
//
// The local lane is now a FLAG, not a detection: a brand tree carrying a
// `file:` @omega.js spec used to switch itself here, which took the CI lane
// away from exactly the brands that need it most (a linked brand now packs its
// frameworks into the snapshot the runner installs).
//
// And a local publish can only build what THIS machine can build. Electron
// cross-building is what the CI matrix exists for, so a `--platforms` naming
// anything else is refused by name rather than quietly building the host's.
//
// The laptop and the runner are ONE pipeline in two environments (#865), so
// the last case PINS them to each other: the command the workflow's publishing
// legs run, the script that command expands to, and the call `--direct` makes
// are read from the files themselves rather than restated here.

const fs = require('fs');
const path = require('path');
const Module = require('module');
const defineCases = require('@omega.js/devkit/test/define-cases');
const attachLogFile = require('@omega.js/devkit/attach-log-file');
const deployRecord = require('@omega.js/devkit/deploy-record');

const COMMANDS = path.join(__dirname, '..', '..', '..', 'commands');
const DEPLOY = path.join(COMMANDS, 'deploy.js');
const WORKFLOW = path.join(__dirname, '..', '..', '..', 'defaults', '.github', 'workflows', 'build.yml');

// The scripts every target gets from the scaffold, read from the one place that
// declares them: expanding the workflow's command through THESE is what ties
// the runner's step to the verb this laptop runs.
const SCRIPTS = require(path.join(__dirname, '..', '..', '..', '..', 'package.json')).projectScripts;

const { directPlatform } = require(DEPLOY);

/**
 * The publishing legs of the CI build, read from the workflow the scaffold
 * writes: the mac and linux steps, which are the ones that publish (windows
 * packages unsigned and `finalize-release` closes its release). A step's own
 * command is ONE line; the `run: |` blocks around them are the leg's setup
 * (decoding the signing assets, installing snapcraft), never the publish.
 *
 * @returns {Array<{ os: string, command: string }>} Every publishing leg's command, in file order.
 */
function ciPublishLegs() {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n').map((line) => line.trim());
  const legs = [];
  let os = null;

  for (const line of lines) {
    // A `- ` opens the next step, so the leg an `if:` names ends there.
    if (line.startsWith('- ')) os = null;

    const gate = /^(?:- )?if: matrix\.os == '(macos-latest|ubuntu-latest)'$/.exec(line);
    if (gate) os = gate[1];

    const run = /^(?:- )?run: (.+)$/.exec(line);
    if (os && run && run[1] !== '|') legs.push({ os, command: run[1] });
  }

  return legs;
}

/**
 * Swap ONE module for a recorder and hand back the undo. The precheck is the
 * network boundary (it publishes this target's signing certs as Actions
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

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'deploy --direct: the host platform, and only the host platform',
  tests: [
    {
      name: 'no --platforms builds the host, in the workflow input vocabulary',
      run: (ctx) => {
        ctx.expect(directPlatform(undefined, 'darwin')).toBe('mac');
        ctx.expect(directPlatform(undefined, 'win32')).toBe('windows');
        ctx.expect(directPlatform(undefined, 'linux')).toBe('linux');
      },
    },
    {
      name: 'the host platform in OMEGA\'s own vocabulary is accepted, in any case (#867)',
      run: (ctx) => {
        ctx.expect(directPlatform('mac', 'darwin')).toBe('mac');
        ctx.expect(directPlatform('MAC', 'darwin')).toBe('mac');
        ctx.expect(directPlatform('windows', 'win32')).toBe('windows');
        ctx.expect(directPlatform('WINDOWS', 'win32')).toBe('windows');
        ctx.expect(directPlatform('linux', 'linux')).toBe('linux');
      },
    },
    {
      name: 'a host NAME from another vocabulary is refused, naming the one OMEGA speaks (#867)',
      run: (ctx) => {
        // The flag speaks mac | windows | linux and nothing else: the node and
        // runner spellings of the SAME host are foreign words here, and a
        // refusal names the host in the vocabulary the flag does accept.
        ctx.expect(() => directPlatform('darwin', 'darwin')).toThrow(/can only build mac: darwin/);
        ctx.expect(() => directPlatform('win32', 'win32')).toThrow(/can only build windows: win32/);
        ctx.expect(() => directPlatform('ubuntu', 'linux')).toThrow(/can only build linux: ubuntu/);
      },
    },
    {
      name: 'a platform this machine cannot build is REFUSED, never silently swapped for the host',
      run: (ctx) => {
        ctx.expect(() => directPlatform('windows', 'darwin')).toThrow(/CI-only/);
        ctx.expect(() => directPlatform('mac,linux', 'darwin')).toThrow(/linux/);
        // 'all' names three platforms, and a laptop is one of them
        ctx.expect(() => directPlatform('all', 'darwin')).toThrow(/CI-only/);
      },
    },
    {
      name: 'an unknown host refuses too, pointing at the CI lane',
      run: (ctx) => {
        ctx.expect(() => directPlatform(undefined, 'aix')).toThrow(/Dispatch the CI build/);
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

          // A platform no host can build: the direct lane refuses it, which is
          // the proof the run REACHED that lane. What must not have happened on
          // the way is the precheck, which publishes the signing certs to the
          // repo's Actions secrets and needs a `gh` session to do it.
          await ctx.expect(() => deploy({ direct: true, platforms: 'atari' })).toThrow(/CI-only/);
          ctx.expect(ran).toEqual(['ensure-target']);
        } finally {
          // The verb tees this process' writers now (#873): hand them back.
          attachLogFile.detach();
          for (const restore of restores) restore();
          if (cached) require.cache[resolved] = cached;
          else delete require.cache[resolved];
        }
      },
    },
    {
      // One pipeline, two environments (Ian on #865): the runner's publishing
      // legs and this laptop's `--direct` run the SAME publish, so the three
      // links between them are read from the files here. Nothing pinned them
      // before, and the workflow step, the script and the verb could each move
      // without the other two.
      name: '--direct runs the ONE publish CI runs: the workflow\'s release:local script, local flag and all (#865)',
      run: async (ctx) => {
        // 1. What the runner runs, taken from the workflow the scaffold writes.
        const legs = ciPublishLegs();

        ctx.expect(legs).toEqual([
          { os: 'macos-latest', command: 'npm run release:local' },
          { os: 'ubuntu-latest', command: 'npm run release:local' },
        ]);

        // 2. Expanded through the target's own scripts, that command IS the
        // publish verb under the local flag.
        const script = SCRIPTS[legs[0].command.replace(/^npm run /, '')];

        ctx.expect(script).toBe('omega publish --local');

        // 3. And `--direct` calls the very same publish, in process.
        const ran = [];
        const published = [];
        const restores = [
          stubModule(path.join(COMMANDS, 'lib', 'ensure-target.js'), { ensureTarget: async () => ran.push('ensure-target') }),
          stubModule(path.join(COMMANDS, 'lib', 'deploy-precheck.js'), { deployPrecheck: async () => ran.push('precheck') }),
          stubModule(path.join(COMMANDS, 'publish.js'), async (options) => {
            ran.push('publish');
            published.push(options);
          }),
        ];
        // A real run stamps the brand's deploy record, and a test must never
        // write one into the tree it happens to be standing in.
        const recordDeploy = deployRecord.recordDeploy;
        deployRecord.recordDeploy = () => {};
        const resolved = require.resolve(DEPLOY);
        const cached = require.cache[resolved];
        delete require.cache[resolved];

        try {
          const deploy = require(resolved);

          // This machine's platform, in the vocabulary the flag speaks: the
          // direct lane builds the host and only the host, whichever host is
          // running the suite.
          await deploy({ direct: true, platforms: directPlatform(undefined, process.platform) });

          // The publish ran once, under the local flag, and the precheck (the
          // network boundary) never did.
          ctx.expect(ran).toEqual(['ensure-target', 'publish']);
          ctx.expect(published.length).toBe(1);
          ctx.expect(published[0].local).toBe(true);

          // 4. The two ends meet at that flag. `src/cli-run.js` is what maps
          // one to the other: it declares `local` boolean and hands the parsed
          // options to the router, so the script's `--local` arrives at the
          // verb as `{ local: true }`. The parse itself is pinned in
          // build/cli.test.js; this pin names the flag on both sides.
          ctx.expect(script.split(' ').filter((word) => word.startsWith('--'))).toEqual(['--local']);
        } finally {
          // The verb tees this process' writers now (#873): hand them back.
          attachLogFile.detach();
          deployRecord.recordDeploy = recordDeploy;
          for (const restore of restores) restore();
          if (cached) require.cache[resolved] = cached;
          else delete require.cache[resolved];
        }
      },
    },
  ],
});
