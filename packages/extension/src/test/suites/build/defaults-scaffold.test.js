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

const SRC = path.join(__dirname, '..', '..', '..');

// The defaults task reads the consumer config from cwd at REQUIRE time, so a
// case that needs a REAL brand config stages one, chdirs in, and requires the
// task fresh — the same model as package-task.test.js's inProject().
function scaffoldWithBrand(brand) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-defaults-brand-'));
  jetpack.write(path.join(tmp, 'config', 'omega.json5'), `${JSON.stringify({ brand, targets: { extension: {} } }, null, 2)}\n`);

  const oldCwd = process.cwd();
  const flush = () => {
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(SRC + path.sep)) delete require.cache[key];
    }
  };

  flush();
  try {
    process.chdir(tmp);
    require(path.join(SRC, 'gulp', 'tasks', 'defaults.js')).scaffoldDefaults({ outputDir: tmp });
  } finally {
    process.chdir(oldCwd);
    flush();
  }

  return tmp;
}

// The scaffolded config/messages.json is JSON5 — read it the way the build does.
function readMessages(dir) {
  return JSON5.parse(jetpack.read(path.join(dir, 'config', 'messages.json')));
}

function readAppDescription(dir) {
  return readMessages(dir).appDescription.message;
}

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'defaults scaffold (devkit engine)',
  tests: [
    {
      name: 'fresh scaffold: `_.` renames land, omega.json5 + the agent-docs chain ship, .nvmrc renders',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-defaults-'));
        scaffoldDefaults({ outputDir: tmp });

        ctx.expect(jetpack.exists(path.join(tmp, '.env'))).toBeTruthy();
        ctx.expect(jetpack.exists(path.join(tmp, '.gitignore'))).toBeTruthy();
        // The agent-docs chain (#63): AGENTS.md carries the content, CLAUDE.md is
        // the one-line `@AGENTS.md` pointer.
        ctx.expect(jetpack.read(path.join(tmp, 'AGENTS.md'))).toContain('node_modules/@omega.js/AGENTS.md');
        ctx.expect(jetpack.read(path.join(tmp, 'CLAUDE.md')).trim()).toBe('@AGENTS.md');
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
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-defaults-'));
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
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-defaults-'));
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
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-defaults-'));
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
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-defaults-'));
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
    {
      name: 'brand target scaffolds NO config file (cp121c/cp122d: brand targets.* is the home; local file = standalone escape hatch)',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-defaults-'));
        jetpack.write(path.join(tmp, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        const targetDir = path.join(tmp, 'brand', 'targets', 'extension');
        jetpack.dir(targetDir);

        // Fresh scaffold AND every-build reruns: the local config never appears
        // (the old targets-only seed kept resurrecting deleted local files)
        scaffoldDefaults({ outputDir: targetDir });
        ctx.expect(jetpack.exists(path.join(targetDir, 'config', 'omega.json5'))).toBe(false);

        scaffoldDefaults({ outputDir: targetDir });
        ctx.expect(jetpack.exists(path.join(targetDir, 'config', 'omega.json5'))).toBe(false);
      },
    },
    {
      name: 'brand target scaffolds NO per-target docs (brand doc unification: the brand root is the doc home)',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-defaults-'));
        jetpack.write(path.join(tmp, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        const targetDir = path.join(tmp, 'brand', 'targets', 'extension');
        jetpack.dir(targetDir);

        scaffoldDefaults({ outputDir: targetDir });
        ctx.expect(jetpack.exists(path.join(targetDir, 'AGENTS.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(targetDir, 'CLAUDE.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(targetDir, 'CHANGELOG.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(targetDir, 'docs'))).toBe(false);
        // The non-doc defaults still land.
        ctx.expect(jetpack.exists(path.join(targetDir, '.env'))).toBeTruthy();
      },
    },
    {
      name: 'brand setup sweeps framework-owned per-target docs, preserves consumer content with a warning',
      run: (ctx) => {
        const DEFAULT_MARKER = '# ========== Default Values ==========';
        const CUSTOM_MARKER = '# ========== Custom Values ==========';
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-defaults-'));
        const targetDir = path.join(tmp, 'brand', 'targets', 'extension');
        jetpack.dir(targetDir);

        // Standalone scaffold first (no brand config yet) — per-target docs land.
        scaffoldDefaults({ outputDir: targetDir });
        ctx.expect(jetpack.exists(path.join(targetDir, 'AGENTS.md'))).toBeTruthy();
        ctx.expect(jetpack.exists(path.join(targetDir, 'CLAUDE.md'))).toBeTruthy();

        // Wrap it in a brand monorepo: the next scaffold sweeps the untouched docs.
        jetpack.write(path.join(tmp, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        const swept = scaffoldDefaults({ outputDir: targetDir });
        ctx.expect(swept.removed.slice().sort().join(',')).toBe('AGENTS.md,CHANGELOG.md,CLAUDE.md,docs/README.md');
        ctx.expect(jetpack.exists(path.join(targetDir, 'AGENTS.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(targetDir, 'CLAUDE.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(targetDir, 'docs'))).toBe(false);

        // Consumer content is never destroyed: real notes below the Custom marker keep the file.
        jetpack.write(path.join(targetDir, 'AGENTS.md'),
          `${DEFAULT_MARKER}\nframework guidance\n\n${CUSTOM_MARKER}\nOur deploy needs the VPN up.\n`);
        scaffoldDefaults({ outputDir: targetDir });
        ctx.expect(jetpack.read(path.join(targetDir, 'AGENTS.md'))).toContain('VPN');
      },
    },
    {
      // GitHub runs workflows from the repo root ONLY, so the per-target copy a
      // brand monorepo used to get never fired: no CI build, no store publish (#265).
      name: 'brand target scaffolds NO per-target .github/ — its CI composes into the brand root',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-defaults-'));
        const brandRoot = path.join(tmp, 'brand');
        jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        const targetDir = path.join(brandRoot, 'targets', 'extension');
        jetpack.dir(targetDir);

        scaffoldDefaults({ outputDir: targetDir });

        ctx.expect(jetpack.exists(path.join(targetDir, '.github'))).toBe(false);

        const composed = path.join(brandRoot, '.github', 'workflows', 'extension-publish.yml');
        ctx.expect(jetpack.exists(composed)).toBe('file');

        const contents = jetpack.read(composed);
        // Runs from the repo root, scoped to this target
        ctx.expect(contents).toContain('working-directory: targets/extension');
        // The site-token pass still renders (the pinned consumer Node version)
        ctx.expect(contents).toContain(`NODE_VERSION: '22'`);
        ctx.expect(contents.includes('[versions.node]')).toBe(false);

        // Idempotent: a setup rerun updates that one file, never adds another
        scaffoldDefaults({ outputDir: targetDir });
        ctx.expect(jetpack.list(path.join(brandRoot, '.github', 'workflows'))).toEqual(['extension-publish.yml']);
      },
    },
    {
      name: 'standalone project keeps its own .github/workflows (its target dir IS the repo root)',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-defaults-'));

        scaffoldDefaults({ outputDir: tmp });

        ctx.expect(jetpack.exists(path.join(tmp, '.github', 'workflows', 'publish.yml'))).toBe('file');
      },
    },
    {
      name: 'appDescription seeds from brand.description when it fits the store cap (#573)',
      run: (ctx) => {
        // A description with an apostrophe: the seed is a single-quoted JSON5
        // string, so an unescaped one would make the scaffolded file unparseable
        const description = `Save what you find — the world's tidiest clipper.`;
        const tmp = scaffoldWithBrand({ id: 'acme', name: 'Acme', description });

        ctx.expect(readAppDescription(tmp)).toBe(description);
      },
    },
    {
      name: 'appDescription falls back to today\'s phrasing over the cap, or with no description (#573)',
      run: (ctx) => {
        const tooLong = `${'x'.repeat(201)}`;
        const overCap = scaffoldWithBrand({ id: 'acme', name: 'Acme', description: tooLong });
        const none    = scaffoldWithBrand({ id: 'acme', name: 'Acme' });

        ctx.expect(readAppDescription(overCap)).toBe('The official Acme browser extension.');
        ctx.expect(readAppDescription(none)).toBe('The official Acme browser extension.');
      },
    },
    {
      name: 'every seeded message escapes the brand name — an apostrophe keeps the file parseable (#592)',
      run: (ctx) => {
        // #573 escaped the description path only; appName/appNameShort/btnTooltip
        // rendered `[ site.brand.name ]` raw into the same single-quoted JSON5.
        const name = `Ian's Clipper`;
        const messages = readMessages(scaffoldWithBrand({ id: 'acme', name }));

        ctx.expect(messages.appName.message).toBe(name);
        ctx.expect(messages.appNameShort.message).toBe(name);
        ctx.expect(messages.btnTooltip.message).toBe(name);
        ctx.expect(messages.appDescription.message).toBe(`The official ${name} browser extension.`);
      },
    },
  ],
};
