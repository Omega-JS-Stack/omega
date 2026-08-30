// Build-layer tests for ensure-target's defaults scaffold — copyDefaults runs through
// the shared devkit defaults engine; these tests run the REAL copyDefaults (@omega.js/desktop's
// actual file map) into a temp consumer dir and verify the wiring: `_.` renames,
// `_mas/` archive skip, workflow templating, preserve-if-exists, marker merges,
// and idempotency.

const path = require('path');
const fs = require('fs');
const os = require('os');
const jetpack = require('fs-jetpack');

const Manager = require('../../../build.js');
const { renderSecretsBlock } = require('@omega.js/config/env-delivery');
const { copyDefaults } = require('../../../commands/lib/ensure-target.js');
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

        // No `.env` scaffolds ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)):
        // a target .env is a human-only override; keys live in the brand root
        // .env and every verb delivers them.
        ctx.expect(jetpack.exists(path.join(tmp, '.env'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(tmp, '.gitignore'))).toBeTruthy();
        // The agent-docs chain (#63): AGENTS.md carries the content, CLAUDE.md is
        // the one-line `@AGENTS.md` pointer.
        ctx.expect(jetpack.read(path.join(tmp, 'AGENTS.md'))).toContain('node_modules/@omega.js/AGENTS.md');
        ctx.expect(jetpack.read(path.join(tmp, 'CLAUDE.md')).trim()).toBe('@AGENTS.md');
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
      // GitHub runs workflows from the repo ROOT only, so the per-target copy a
      // brand monorepo used to get never fired (#265) — and the #627 secrets
      // block was rendering into that dead file. Web and the extension compose
      // into the brand root; desktop now does too.
      name: 'brand target scaffolds NO per-target .github/ — its CI composes into the brand root (#265)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-defaults-'));
        const brandRoot = path.join(tmp, 'brand');
        jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        const targetDir = path.join(brandRoot, 'targets', 'desktop');
        jetpack.dir(targetDir);

        await copyDefaults(targetDir);

        ctx.expect(jetpack.exists(path.join(targetDir, '.github'))).toBe(false);

        const composed = path.join(brandRoot, '.github', 'workflows', 'desktop-build.yml');
        ctx.expect(jetpack.exists(composed)).toBe('file');

        const contents = jetpack.read(composed);
        // Runs from the repo root, scoped to this target
        ctx.expect(contents).toContain('working-directory: targets/desktop');
        // The template pass runs on the COMPOSED copy too: the generated env
        // block is there, and no raw token survives — the composed file is the
        // only one CI executes, so an unrendered token would break every build.
        ctx.expect(contents).toContain(renderSecretsBlock('desktop', { indent: '  ' }));
        ctx.expect(contents.includes('{{ githubSecrets }}')).toBe(false);
        ctx.expect(contents).toContain(String(package.omega.nodeRuntime));
        ctx.expect(contents.includes('{{ versions')).toBe(false);

        // Idempotent: a rerun updates that one file, never adds another.
        await copyDefaults(targetDir);
        ctx.expect(jetpack.list(path.join(brandRoot, '.github', 'workflows'))).toEqual(['desktop-build.yml']);
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
      name: '.gitignore re-scaffold: custom lines survive the marker merge',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-defaults-'));
        jetpack.write(
          path.join(tmp, '.gitignore'),
          `${DEFAULT_MARKER}\nuser-added-dir/\n\n${CUSTOM_MARKER}\nmy-secret-dir/\n`
        );
        await copyDefaults(tmp);

        const gitignore = jetpack.read(path.join(tmp, '.gitignore'));
        const customPart = gitignore.slice(gitignore.indexOf(CUSTOM_MARKER));
        ctx.expect(customPart).toContain('my-secret-dir/');
        // Not in @omega.js/desktop's defaults → migrated below the Custom marker.
        ctx.expect(customPart).toContain('user-added-dir/');
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
      name: 'brand target scaffolds NO config file (cp121c/cp122d: brand targets.* is the home; local file = standalone escape hatch)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-defaults-'));
        jetpack.write(path.join(tmp, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        const targetDir = path.join(tmp, 'brand', 'targets', 'desktop');
        jetpack.dir(targetDir);

        // Fresh scaffold AND reruns: the local config never appears (the old
        // targets-only seed kept resurrecting deleted local files)
        await copyDefaults(targetDir);
        ctx.expect(jetpack.exists(path.join(targetDir, 'config', 'omega.json5'))).toBe(false);

        await copyDefaults(targetDir);
        ctx.expect(jetpack.exists(path.join(targetDir, 'config', 'omega.json5'))).toBe(false);
      },
    },
    {
      name: 'brand target scaffolds NO per-target docs (brand doc unification: the brand root is the doc home)',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-defaults-'));
        jetpack.write(path.join(tmp, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        const targetDir = path.join(tmp, 'brand', 'targets', 'desktop');
        jetpack.dir(targetDir);

        await copyDefaults(targetDir);
        ctx.expect(jetpack.exists(path.join(targetDir, 'AGENTS.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(targetDir, 'CLAUDE.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(targetDir, 'CHANGELOG.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(targetDir, 'docs'))).toBe(false);
        // The non-doc defaults still land.
        ctx.expect(jetpack.exists(path.join(targetDir, '.gitignore'))).toBeTruthy();
      },
    },
    {
      name: 'brand setup sweeps framework-owned per-target docs, preserves consumer content with a warning',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-defaults-'));
        const targetDir = path.join(tmp, 'brand', 'targets', 'desktop');
        jetpack.dir(targetDir);

        // Standalone scaffold first (no brand config yet) — per-target docs land.
        await copyDefaults(targetDir);
        ctx.expect(jetpack.exists(path.join(targetDir, 'AGENTS.md'))).toBeTruthy();
        ctx.expect(jetpack.exists(path.join(targetDir, 'CLAUDE.md'))).toBeTruthy();

        // Wrap it in a brand monorepo: the next setup sweeps the untouched docs.
        jetpack.write(path.join(tmp, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        await copyDefaults(targetDir);
        ctx.expect(jetpack.exists(path.join(targetDir, 'AGENTS.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(targetDir, 'CLAUDE.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(targetDir, 'CHANGELOG.md'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(targetDir, 'docs'))).toBe(false);

        // Consumer content is never destroyed: real notes below the Custom marker keep the file.
        jetpack.write(path.join(targetDir, 'AGENTS.md'),
          `${DEFAULT_MARKER}\nframework guidance\n\n${CUSTOM_MARKER}\nOur deploy needs the VPN up.\n`);
        await copyDefaults(targetDir);
        ctx.expect(jetpack.read(path.join(targetDir, 'AGENTS.md'))).toContain('VPN');
      },
    },
  ],
};
