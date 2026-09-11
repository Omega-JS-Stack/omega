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

const path = require('path');
const Module = require('module');
const defineCases = require('@omega.js/devkit/test/define-cases');

const COMMANDS = path.join(__dirname, '..', '..', '..', 'commands');
const DEPLOY = path.join(COMMANDS, 'deploy.js');

const { directPlatform } = require(DEPLOY);

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
      name: 'every spelling of the host platform the dispatch input accepts is accepted here',
      run: (ctx) => {
        ctx.expect(directPlatform('mac', 'darwin')).toBe('mac');
        ctx.expect(directPlatform('darwin', 'darwin')).toBe('mac');
        ctx.expect(directPlatform('WINDOWS', 'win32')).toBe('windows');
        ctx.expect(directPlatform('ubuntu', 'linux')).toBe('linux');
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
          stubModule(path.join(COMMANDS, '..', 'utils', 'deliver-certs.js'), { deliverTargetCerts: () => ran.push('deliver-certs') }),
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
          ctx.expect(ran).toEqual(['ensure-target', 'deliver-certs']);
        } finally {
          for (const restore of restores) restore();
          if (cached) require.cache[resolved] = cached;
          else delete require.cache[resolved];
        }
      },
    },
  ],
});
