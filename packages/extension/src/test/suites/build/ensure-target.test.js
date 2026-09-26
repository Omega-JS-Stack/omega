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
const build = require(path.join(SRC, 'build.js'));
const { ensureTarget } = require(path.join(SRC, 'commands', 'lib', 'ensure-target.js'));
const { deployPrecheck } = require(path.join(SRC, 'commands', 'lib', 'deploy-precheck.js'));
const cli = require(path.join(SRC, 'cli.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

const package = build.getPackage('main');

// The manifest of a consumer whose peer deps are already satisfied (the steady
// state, where ensurePeerDependencies installs nothing).
function consumerManifest() {
  const devDependencies = { [package.name]: `^${package.version}` };
  for (const [name, ver] of Object.entries(package.peerDependencies || {})) {
    devDependencies[name] = ver;
  }
  return `${JSON.stringify({ name: 'staged-app', version: '1.0.0', devDependencies }, null, 2)}\n`;
}

function stageConsumer() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-ensure-'));
  jetpack.write(path.join(tmp, 'package.json'), consumerManifest());
  return tmp;
}

// A BRAND tree: the target under targets/<name>, the config at the brand root.
// That is the shape findBrandRoot resolves, and the one the firefox id is
// pinned into (#893).
function stageBrand(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-ensure-brand-'));
  const target = path.join(root, 'targets', 'extension');

  jetpack.write(path.join(root, 'config', 'omega.json5'), config);
  jetpack.write(path.join(target, 'package.json'), consumerManifest());

  return { root, target, configPath: path.join(root, 'config', 'omega.json5') };
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

          // The rerun adds nothing and syncs one thing: the firefox id pin
          // (#893) reads the config the defaults scaffold only just wrote, so
          // on a FRESH standalone project it lands on pass two. (One further
          // caveat, pre-existing and named in `merged`: config/omega.json5 is
          // copied verbatim on the fresh pass and re-emitted in the
          // defaults-merge's normalized form on the next one.) Both converge on
          // pass three.
          const second = await ensureTarget({ projectDir: tmp });
          ctx.expect(second.written).toEqual([]);
          ctx.expect(second.changed).toEqual(['config/omega.json5']);

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
      name: 'pins the DERIVED firefox add-on id into the brand config, once (#893)',
      run: async (ctx) => {
        // The id is ours, not AMO's: the store adopts whatever gecko id the
        // packaged manifest carries. So the local scaffold writes the derived
        // value into the brand config before anything packages or publishes,
        // and the runner (a throwaway checkout of the mirror) never writes.
        const { root, target, configPath } = stageBrand(`{\n  brand: { id: 'staged-brand', name: 'Staged', url: 'https://staged.example.com' },\n  targets: { extension: { type: 'extension' } },\n}\n`);

        try {
          const lines = [];
          const first = await ensureTarget({ projectDir: target, log: (line) => lines.push(line) });

          const written = jetpack.read(configPath);
          ctx.expect(written).toContain('listings');
          ctx.expect(written).toContain('extension@staged.example.com');
          // The brand's own file is EDITED, never rewritten: every other key survives
          ctx.expect(written).toContain("name: 'Staged'");

          ctx.expect(first.changed.some((line) => line.includes('config/omega.json5'))).toBe(true);
          ctx.expect(lines.some((line) => line.includes('Pinned targets.extension.listings.firefox.id = extension@staged.example.com'))).toBe(true);

          // The rerun reads its own pin and changes nothing at all.
          const rerunLines = [];
          const second = await ensureTarget({ projectDir: target, log: (line) => rerunLines.push(line) });

          ctx.expect(jetpack.read(configPath)).toBe(written);
          ctx.expect(second.changed.some((line) => line.includes('config/omega.json5'))).toBe(false);
          ctx.expect(rerunLines.some((line) => line.includes('Pinned'))).toBe(false);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a DECLARED firefox listing id is left alone, byte for byte (#893)',
      run: async (ctx) => {
        const source = `{\n  brand: { id: 'staged-brand', name: 'Staged', url: 'https://staged.example.com' },\n  targets: { extension: { type: 'extension', listings: { firefox: { id: 'addon@declared.example.com' } } } },\n}\n`;
        const { root, target, configPath } = stageBrand(source);

        try {
          const lines = [];
          await ensureTarget({ projectDir: target, log: (line) => lines.push(line) });

          ctx.expect(jetpack.read(configPath)).toBe(source);
          ctx.expect(lines.some((line) => line.includes('Pinned'))).toBe(false);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
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
