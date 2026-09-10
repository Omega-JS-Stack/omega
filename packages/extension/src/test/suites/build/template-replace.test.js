// The `%%%key%%%` substitution, extension bundle lane
// ([#738](https://github.com/Omega-JS-Stack/omega/issues/738)).
//
// Consumer and framework browser code writes build-time tokens (`%%%version%%%`,
// `%%%brand.name%%%`) and the build fills them with the project's own facts.
// webpack did it as a processAssets hook that
// rewrote every emitted asset; esbuild has no mutate-then-rewrite pass, so the
// bundle task fills the emitted files itself. What that has to survive is
// MINIFICATION — a production bundle is minified before anything sees it, and a
// token that came out mangled would be an unreplaced marker shipped to a store.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FRAMEWORK_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { bundle } = require('@omega.js/devkit/bundle');
const task = require(path.join(FRAMEWORK_ROOT, 'src', 'gulp', 'tasks', 'bundle.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

const FIXTURE = [
  "export const stamp = 'v%%%version%%% of %%%brand.name%%%';",
  "export const spaced = '%%% environment %%%';",
  'globalThis.probe = { stamp, spaced };',
  '',
].join('\n');

// Bundle the fixture the way the extension lane bundles a component entry — a
// PRODUCTION build, so the tokens go through esbuild's minifier before the
// substitution runs.
async function buildFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-extension-template-'));
  fs.writeFileSync(path.join(dir, 'entry.js'), FIXTURE);
  const outfile = path.join(dir, 'dist', 'entry.bundle.js');

  await bundle({
    frameworkRoot: FRAMEWORK_ROOT,
    entries: [path.join(dir, 'entry.js')],
    outfile,
    platform: 'browser',
    format: 'iife',
    dev: false,
  });

  return { dir, outfile };
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'template-replace — the bundle lane fills %%%key%%% tokens in the emitted bundles',
  timeout: 60000,
  tests: [
    {
      name: 'tokens survive minification and are filled with the project facts',
      run: async (ctx) => {
        const { dir, outfile } = await buildFixture();

        try {
          ctx.expect(fs.readFileSync(outfile, 'utf8')).toContain('%%%version%%%');

          task.substituteTemplates([outfile], {
            version: '9.9.9',
            brand: { name: 'Fixture Brand' },
            environment: 'production',
          });

          const after = fs.readFileSync(outfile, 'utf8');
          ctx.expect(after).toContain('v9.9.9 of Fixture Brand');
          ctx.expect(after).toContain('production');
          ctx.expect(after.includes('%%%')).toBe(false);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      name: 'a token nothing answers is left intact rather than emptied',
      run: async (ctx) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-extension-template-miss-'));
        const file = path.join(dir, 'entry.bundle.js');
        fs.writeFileSync(file, "var a = '%%%version%%%';\nvar b = '%%%nothingAnswersThis%%%';\n");

        try {
          task.substituteTemplates([file], { version: '1.0.0' });

          const after = fs.readFileSync(file, 'utf8');
          ctx.expect(after).toContain("var a = '1.0.0';");
          ctx.expect(after).toContain('%%%nothingAnswersThis%%%');
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },

    {
      // The keys the build promises consumer code (packages/extension/docs/build-system.md):
      // the substitution being wired proves nothing if the set it fills from lost
      // a key. `webManagerConfiguration` was in this set and is gone (#743): it
      // composed a SECOND, diverging copy of the @omega.js/client runtime blob
      // for a token no source file anywhere carried — the snapshot the contexts
      // actually read is the one bundle.js bakes.
      name: 'the replacement set carries the keys the build promises',
      run: (ctx) => {
        const options = task.getTemplateReplaceOptions();

        ctx.expect(options).toHaveProperty('environment');
        ctx.expect(options).toHaveProperty('version');
        ctx.expect(typeof options.liveReloadPort).toBe('number');
        ctx.expect(typeof options.firebaseVersion).toBe('string');
        ctx.expect(options.webManagerConfiguration).toBeUndefined();
      },
    },
  ],
});
