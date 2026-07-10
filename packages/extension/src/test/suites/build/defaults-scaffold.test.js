// Build-layer tests for the defaults scaffold — the gulp task's guts now run through
// the shared devkit defaults engine; these tests run the REAL scaffold (BXM's actual
// FILE_MAP + site-token transform) into a temp consumer dir and verify the wiring:
// `_.` renames, omega.json5 defaults merge (consumer keys survive — the setup
// data-loss regression), preserve-if-exists rules, .nvmrc templating, convergence.

const path = require('path');
const fs = require('fs');
const os = require('os');
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');

const { scaffoldDefaults } = require('../../../gulp/tasks/defaults.js');

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'defaults scaffold (devkit engine)',
  tests: [
    {
      name: 'fresh scaffold: `_.` renames land, omega.json5 + CLAUDE.md ship, .nvmrc renders',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bxm-defaults-'));
        scaffoldDefaults({ outputDir: tmp });

        ctx.expect(jetpack.exists(path.join(tmp, '.env'))).toBeTruthy();
        ctx.expect(jetpack.exists(path.join(tmp, '.gitignore'))).toBeTruthy();
        ctx.expect(jetpack.exists(path.join(tmp, 'CLAUDE.md'))).toBeTruthy();
        ctx.expect(jetpack.exists(path.join(tmp, 'config', 'omega.json5'))).toBeTruthy();

        // .nvmrc template rendered ({{ versions.node }} → engines.node), no raw tokens left.
        const nvmrc = jetpack.read(path.join(tmp, '.nvmrc'));
        ctx.expect(nvmrc).toContain('v22');
        ctx.expect(nvmrc.includes('{{')).toBe(false);
      },
    },
    {
      name: 'omega.json5 merge: consumer values and consumer-only keys survive re-scaffold',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bxm-defaults-'));
        jetpack.write(path.join(tmp, 'config', 'omega.json5'), JSON5.stringify({
          brand: { id: 'my-brand' },
          liveReloadPort: 40000,
          targets: { extension: { custom: true } },
        }, null, 2));

        scaffoldDefaults({ outputDir: tmp });

        const merged = JSON5.parse(jetpack.read(path.join(tmp, 'config', 'omega.json5')));
        ctx.expect(merged.brand.id).toBe('my-brand');
        ctx.expect(merged.liveReloadPort).toBe(40000);
        ctx.expect(merged.targets.extension.custom).toBe(true);
        // Framework template sections the consumer lacked arrive in the merge.
        ctx.expect(typeof merged.theme).toBe('object');
      },
    },
    {
      name: 'preserve-if-exists rules: consumer config/description.md is never overwritten',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bxm-defaults-'));
        jetpack.write(path.join(tmp, 'config', 'description.md'), 'consumer description');

        scaffoldDefaults({ outputDir: tmp });

        ctx.expect(jetpack.read(path.join(tmp, 'config', 'description.md'))).toBe('consumer description');
      },
    },
    {
      // The legacy-1.7.4 regression: no FILE_MAP rule matched test/**, so shipped
      // test files fell through to the engine's overwrite: true default and every
      // setup rerun reset the consumer's fixture hook to the stub.
      name: 'test/** is copy-once: consumer test/_init.js survives re-scaffold',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bxm-defaults-'));
        scaffoldDefaults({ outputDir: tmp });

        // Seeded on first run
        ctx.expect(jetpack.exists(path.join(tmp, 'test', '_init.js'))).toBeTruthy();

        // Consumer customizes the fixture hook; a rerun must not clobber it
        jetpack.write(path.join(tmp, 'test', '_init.js'), '// consumer fixture hook\n');
        scaffoldDefaults({ outputDir: tmp });

        ctx.expect(jetpack.read(path.join(tmp, 'test', '_init.js'))).toBe('// consumer fixture hook\n');
      },
    },
    {
      name: 'converges: after the first re-run the tree is stable',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bxm-defaults-'));
        // Run 1 scaffolds; run 2 is the first merge pass (JSON5 comments strip on
        // merge-stringify — pre-existing behavior). Stable from then on.
        scaffoldDefaults({ outputDir: tmp });
        scaffoldDefaults({ outputDir: tmp });
        const snapshot = jetpack.inspectTree(tmp, { checksum: 'md5' });
        const third = scaffoldDefaults({ outputDir: tmp });

        ctx.expect(JSON.stringify(jetpack.inspectTree(tmp, { checksum: 'md5' })))
          .toBe(JSON.stringify(snapshot));
        ctx.expect(third.written.length).toBe(0);
      },
    },
  ],
};
