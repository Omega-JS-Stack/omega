// Build-layer tests for the setup defaults scaffold — copyDefaults now runs through
// the shared devkit defaults engine; these tests run the REAL copyDefaults (@omega.js/desktop's
// actual file map) into a temp consumer dir and verify the wiring: `_.` renames,
// `_mas/` archive skip, workflow templating, preserve-if-exists, marker merges,
// and idempotency.

const path = require('path');
const fs = require('fs');
const os = require('os');
const jetpack = require('fs-jetpack');

const Manager = require('../../../build.js');
const { copyDefaults } = require('../../../commands/setup.js');
const package = Manager.getPackage('main');

const DEFAULT_MARKER = '# ========== Default Values ==========';
const CUSTOM_MARKER = '# ========== Custom Values ==========';

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'defaults scaffold (devkit engine)',
  tests: [
    {
      name: 'fresh scaffold: `_.` renames, `_mas/` archive skipped, workflow YAML rendered',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-defaults-'));
        await copyDefaults(tmp);

        ctx.expect(jetpack.exists(path.join(tmp, '.env'))).toBeTruthy();
        ctx.expect(jetpack.exists(path.join(tmp, '.gitignore'))).toBeTruthy();
        ctx.expect(jetpack.exists(path.join(tmp, 'CLAUDE.md'))).toBeTruthy();
        ctx.expect(jetpack.exists(path.join(tmp, '_mas'))).toBe(false);
        // `_`-prefixed FILENAMES are not archives — test/_init.js ships.
        ctx.expect(jetpack.exists(path.join(tmp, 'test', '_init.js'))).toBeTruthy();

        // Workflow rendered with @omega.js/desktop's pinned nodeRuntime; GitHub's `${{ }}` tokens survive.
        const workflow = jetpack.read(path.join(tmp, '.github', 'workflows', 'build.yml'));
        ctx.expect(workflow).toContain(String(package.omega.nodeRuntime));
        ctx.expect(workflow.includes('{{ versions')).toBe(false);
      },
    },
    {
      name: 'preserve-if-exists: consumer files are never overwritten',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-defaults-'));
        jetpack.write(path.join(tmp, 'src', 'main.js'), '// consumer-owned main');
        await copyDefaults(tmp);

        ctx.expect(jetpack.read(path.join(tmp, 'src', 'main.js'))).toBe('// consumer-owned main');
      },
    },
    {
      name: '.env re-scaffold: custom values survive, user default-section keys migrate to custom',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-defaults-'));
        jetpack.write(
          path.join(tmp, '.env'),
          `${DEFAULT_MARKER}\nUSER_ADDED_KEY="mine"\n\n${CUSTOM_MARKER}\nCUSTOM_KEY="kept"\n`
        );
        await copyDefaults(tmp);

        const env = jetpack.read(path.join(tmp, '.env'));
        const customPart = env.slice(env.indexOf(CUSTOM_MARKER));
        ctx.expect(customPart).toContain('CUSTOM_KEY="kept"');
        // Not in @omega.js/desktop's defaults → migrated below the Custom marker.
        ctx.expect(customPart).toContain('USER_ADDED_KEY="mine"');
      },
    },
    {
      name: 'converges: after the first re-run the tree is stable',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-defaults-'));
        // Run 1 scaffolds; run 2 is the first merge pass, which normalizes marker
        // files whose template carries a preamble ABOVE the Default marker (the
        // protocol moves it below — pre-existing behavior). Stable from then on.
        await copyDefaults(tmp);
        await copyDefaults(tmp);
        const snapshot = jetpack.inspectTree(tmp, { checksum: 'md5' });
        await copyDefaults(tmp);

        ctx.expect(JSON.stringify(jetpack.inspectTree(tmp, { checksum: 'md5' })))
          .toBe(JSON.stringify(snapshot));
      },
    },
    {
      name: 'brand app scaffolds NO config file (cp121c/cp122d: brand targets.* is the home; app file = standalone escape hatch)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-defaults-'));
        jetpack.write(path.join(tmp, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        const appDir = path.join(tmp, 'brand', 'apps', 'desktop');
        jetpack.dir(appDir);

        // Fresh scaffold AND reruns: the app config never appears (the old
        // targets-only seed kept resurrecting deleted app files)
        await copyDefaults(appDir);
        ctx.expect(jetpack.exists(path.join(appDir, 'config', 'omega.json5'))).toBe(false);

        await copyDefaults(appDir);
        ctx.expect(jetpack.exists(path.join(appDir, 'config', 'omega.json5'))).toBe(false);
      },
    },
    {
      name: 'brand app scaffolds NO per-app docs (brand doc unification: the brand root is the doc home)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-defaults-'));
        jetpack.write(path.join(tmp, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        const appDir = path.join(tmp, 'brand', 'apps', 'desktop');
        jetpack.dir(appDir);

        await copyDefaults(appDir);
        ctx.expect(jetpack.exists(path.join(appDir, 'CLAUDE.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(appDir, 'CHANGELOG.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(appDir, 'docs'))).toBe(false);
        // The non-doc defaults still land.
        ctx.expect(jetpack.exists(path.join(appDir, '.env'))).toBeTruthy();
      },
    },
    {
      name: 'brand setup sweeps framework-owned per-app docs, preserves consumer content with a warning',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-defaults-'));
        const appDir = path.join(tmp, 'brand', 'apps', 'desktop');
        jetpack.dir(appDir);

        // Standalone scaffold first (no brand config yet) — per-app docs land.
        await copyDefaults(appDir);
        ctx.expect(jetpack.exists(path.join(appDir, 'CLAUDE.md'))).toBeTruthy();

        // Wrap it in a brand monorepo: the next setup sweeps the untouched docs.
        jetpack.write(path.join(tmp, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        await copyDefaults(appDir);
        ctx.expect(jetpack.exists(path.join(appDir, 'CLAUDE.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(appDir, 'CHANGELOG.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(appDir, 'docs'))).toBe(false);

        // Consumer content is never destroyed: real notes below the Custom marker keep the file.
        jetpack.write(path.join(appDir, 'CLAUDE.md'),
          `${DEFAULT_MARKER}\nframework guidance\n\n${CUSTOM_MARKER}\nOur deploy needs the VPN up.\n`);
        await copyDefaults(appDir);
        ctx.expect(jetpack.read(path.join(appDir, 'CLAUDE.md'))).toContain('VPN');
      },
    },
  ],
};
