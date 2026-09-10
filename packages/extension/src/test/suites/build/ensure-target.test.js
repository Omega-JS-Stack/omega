// ensure-target + deploy-precheck — the two halves `omega setup` used to be
// ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)): the local half
// runs on every verb and is idempotent, the network half is a deploy precheck
// with one opt-out flag.
//
// The fixture is a real consumer manifest that already satisfies the peer
// dependencies, so nothing installs — a satisfied target installing nothing is
// exactly what makes ensureTarget safe on every verb.

const path = require('path');
const fs = require('fs');
const os = require('os');
const jetpack = require('fs-jetpack');

const SRC = path.join(__dirname, '..', '..', '..');
const Manager = require(path.join(SRC, 'build.js'));
const { ensureTarget } = require(path.join(SRC, 'commands', 'lib', 'ensure-target.js'));
const { deployPrecheck } = require(path.join(SRC, 'commands', 'lib', 'deploy-precheck.js'));
const cli = require(path.join(SRC, 'cli.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

const package = Manager.getPackage('main');

// A consumer whose peer deps are already satisfied — the steady state.
function stageConsumer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-ensure-'));
  const devDependencies = { [package.name]: `^${package.version}` };
  for (const [name, ver] of Object.entries(package.peerDependencies || {})) {
    devDependencies[name] = ver;
  }
  jetpack.write(path.join(tmp, 'package.json'), `${JSON.stringify({ name: 'staged-app', version: '1.0.0', devDependencies }, null, 2)}\n`);
  return tmp;
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'ensure-target — the local half every verb runs (#675)',
  tests: [
    {
      name: 'writes on a fresh target, no-op on the rerun',
      run: async (ctx) => {
        const tmp = stageConsumer();

        try {
          const first = await ensureTarget({ projectDir: tmp });

          ctx.expect(first.written.length > 0).toBe(true);
          ctx.expect(first.changed.some((line) => line.startsWith('package.json'))).toBe(true);
          // No `.env` scaffolds ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)):
          // a target .env is a human-only override; keys live in the brand root .env.
          ctx.expect(jetpack.exists(path.join(tmp, '.env'))).toBe(false);

          const manifest = jetpack.read(path.join(tmp, 'package.json'), 'json');
          ctx.expect(manifest.private).toBe(true);
          // The synced scripts never mention the retired command
          ctx.expect(JSON.stringify(manifest.scripts).includes('omega setup')).toBe(false);

          // The rerun adds nothing and syncs nothing. (One caveat, pre-existing
          // and named in `merged`: config/omega.json5 is copied verbatim on the
          // fresh pass and re-emitted in the defaults-merge's normalized form on
          // the next one, so it converges on pass three.)
          const second = await ensureTarget({ projectDir: tmp });
          ctx.expect(second.written).toEqual([]);
          ctx.expect(second.changed).toEqual([]);

          const third = await ensureTarget({ projectDir: tmp });
          ctx.expect(third).toEqual({ written: [], merged: [], changed: [] });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'refuses a workspace root, loudly, without writing a single file (#699)',
      run: async (ctx) => {
        // The accident: `omega deploy` at a workspace root scaffolded a whole
        // extension target into it — src/, hooks/, workflows, rewritten root
        // scripts — before failing anyway. Parity with the same case in
        // @omega.js/desktop's suite (#706).
        const tmp = stageConsumer();
        const manifestPath = path.join(tmp, 'package.json');
        const manifest = jetpack.read(manifestPath, 'json');
        manifest.workspaces = ['packages/*'];
        jetpack.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        const before = jetpack.read(manifestPath);

        try {
          let refusal = null;
          try {
            await ensureTarget({ projectDir: tmp });
          } catch (e) {
            refusal = e;
          }

          ctx.expect(refusal).toBeTruthy();
          ctx.expect(refusal.message).toMatch(/refusing to scaffold into/);
          ctx.expect(refusal.message).toMatch(/declares "workspaces"/);
          ctx.expect(refusal.message.includes(tmp)).toBe(true);

          // Nothing scaffolded, and the manifest is byte-identical.
          ctx.expect(jetpack.list(tmp)).toEqual(['package.json']);
          ctx.expect(jetpack.read(manifestPath)).toBe(before);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'deploy precheck: --no-secrets skips every step, bare deploy runs it',
      run: async (ctx) => {
        const quiet = { log() {}, warn() {}, error() {} };
        const ran = [];
        const steps = [{ name: 'framework-freshness', run: () => { ran.push('framework-freshness'); } }];

        const skipped = await deployPrecheck({ projectDir: '/tmp/x', options: { secrets: false }, logger: quiet, steps });
        ctx.expect(skipped).toEqual({ skipped: 'opt-out' });
        ctx.expect(ran).toEqual([]);

        const result = await deployPrecheck({ projectDir: '/tmp/x', options: {}, logger: quiet, steps });
        ctx.expect(ran).toEqual(['framework-freshness']);
        ctx.expect(result.ran).toEqual(ran);
      },
    },
    {
      name: 'cli: no `setup` command, a bare invocation resolves to help, migrate stays its own command',
      run: (ctx) => {
        const { commandsDir, aliases, defaultCommand } = cli.config;

        ctx.expect(defaultCommand).toBe('help');
        ctx.expect('setup' in aliases).toBe(false);
        ctx.expect(jetpack.exists(path.join(commandsDir, 'setup.js'))).toBe(false);

        // The one-time hook-layout migration is a deliberate verb, not a step
        // every build repeats.
        ctx.expect(Boolean(aliases.migrate)).toBe(true);
        ctx.expect(jetpack.exists(path.join(commandsDir, 'migrate.js'))).toBeTruthy();
      },
    },
  ],
});
