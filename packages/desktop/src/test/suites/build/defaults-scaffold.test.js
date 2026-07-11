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
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-defaults-'));
        await copyDefaults(tmp);

        ctx.expect(jetpack.exists(path.join(tmp, '.env'))).toBeTruthy();
        ctx.expect(jetpack.exists(path.join(tmp, '.gitignore'))).toBeTruthy();
        ctx.expect(jetpack.exists(path.join(tmp, 'CLAUDE.md'))).toBeTruthy();
        ctx.expect(jetpack.exists(path.join(tmp, '_mas'))).toBe(false);
        // `_`-prefixed FILENAMES are not archives — test/_init.js ships.
        ctx.expect(jetpack.exists(path.join(tmp, 'test', '_init.js'))).toBeTruthy();

        // Workflow rendered with @omega.js/desktop's engines.node; GitHub's `${{ }}` tokens survive.
        const workflow = jetpack.read(path.join(tmp, '.github', 'workflows', 'build.yml'));
        ctx.expect(workflow).toContain(String(package.engines.node));
        ctx.expect(workflow.includes('{{ versions')).toBe(false);
      },
    },
    {
      name: 'preserve-if-exists: consumer files are never overwritten',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-defaults-'));
        jetpack.write(path.join(tmp, 'src', 'main.js'), '// consumer-owned main');
        await copyDefaults(tmp);

        ctx.expect(jetpack.read(path.join(tmp, 'src', 'main.js'))).toBe('// consumer-owned main');
      },
    },
    {
      name: '.env re-scaffold: custom values survive, user default-section keys migrate to custom',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-defaults-'));
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
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-defaults-'));
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
      name: 'brand-app seed (friction #1): targets-only config inside a brand monorepo, template stays out',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'em-defaults-'));
        jetpack.write(path.join(tmp, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        const appDir = path.join(tmp, 'brand', 'apps', 'desktop');
        jetpack.dir(appDir);

        await copyDefaults(appDir);
        const seeded = jetpack.read(path.join(appDir, 'config', 'omega.json5'));
        ctx.expect(seeded).toContain('targets');
        ctx.expect(seeded.includes('myapp')).toBe(false);

        // Rerun converges — the full template never lands over the slim seed.
        await copyDefaults(appDir);
        ctx.expect(jetpack.read(path.join(appDir, 'config', 'omega.json5'))).toBe(seeded);
      },
    },
  ],
};
