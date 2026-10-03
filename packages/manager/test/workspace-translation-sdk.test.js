// Tests for the workspace `translation-sdk` ensure op
// ([#168](https://github.com/Omega-JS-Stack/omega/issues/168)): a web target whose
// resolved config translates with the `claude` provider declares
// @anthropic-ai/claude-agent-sdk and gets it installed, the same converge-to-
// config way the other workspace ops reconcile brand files. Converged = zero
// mutation, dry run plans without writing, translation off / provider chatgpt
// is untouched, and the install runs through a recording fake (never npm).

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const translationSdkOp = require('../src/services/workspace/ensure/translation-sdk.js');

const SDK = '@anthropic-ai/claude-agent-sdk';
const { FALLBACK_RANGE } = translationSdkOp;

/**
 * Stage a brand monorepo with one website target. `translation` is the raw
 * section for the BRAND config (the shared layer every target inherits); `pkg`
 * overrides the target's package.json.
 */
function stageBrand({ translation, pkg, target = 'web' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-translation-sdk-'));

  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'fixture-brand',
    private: true,
    workspaces: ['targets/*'],
  }, null, 2)}\n`);

  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `${JSON.stringify({
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
    targets: { [target]: {} },
    ...(translation ? { translation } : {}),
  }, null, 2)}\n`);

  const targetName = target === 'web' ? 'website' : target;
  const targetPath = path.join(root, 'targets', targetName);
  fs.mkdirSync(targetPath, { recursive: true });
  fs.writeFileSync(path.join(targetPath, 'package.json'), `${JSON.stringify(pkg || {
    name: `fixture-${targetName}`,
    private: true,
    dependencies: { '@omega.js/web': '^0.1.0' },
  }, null, 2)}\n`);

  return { root, targetPath, targets: [{ name: targetName, dir: `targets/${targetName}`, path: targetPath, target }] };
}

/** Recording install fake: the op never shells out to npm in tests. */
function fakeRun(result = { success: true }) {
  const calls = [];
  const run = async (command, args, cwd) => {
    calls.push([command, args.join(' '), cwd]);
    return result;
  };
  run.calls = calls;
  return run;
}

const readPkg = (targetPath) => JSON.parse(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'));

const CLAUDE = { languages: ['es'] }; // enabled + provider default to on/claude

module.exports = defineCases({
  type: 'group',
  description: 'workspace-translation-sdk',
  tests: [
    // ─── Drift ───────────────────────────────────────────────────────────────────

    {
      name: 'translation-sdk: claude translation + no dep → package.json gains it and npm install runs',
      run: async (ctx) => {
        const { root, targetPath, targets } = stageBrand({ translation: CLAUDE });
        const run = fakeRun();

        const result = await translationSdkOp({ brandRoot: root, targets, runCommand: run });

        ctx.expect(result.output.translationSdk).toEqual({ added: ['website'], installed: true });

        const pkg = readPkg(targetPath);
        ctx.expect(pkg.dependencies[SDK], 'the fallback range (no web installed in this fixture)').toBe(FALLBACK_RANGE);
        ctx.expect(pkg.dependencies['@omega.js/web'], 'existing deps survive').toBe('^0.1.0');

        ctx.expect(run.calls).toEqual([['npm', 'install --no-audit --no-fund', root]]);
      },
    },

    {
      name: 'translation-sdk: the range comes from the INSTALLED web package\'s optional peer',
      run: async (ctx) => {
        const { root, targetPath, targets } = stageBrand({ translation: CLAUDE });
        const webRoot = path.join(root, 'node_modules', '@omega.js', 'web');
        fs.mkdirSync(webRoot, { recursive: true });
        fs.writeFileSync(path.join(webRoot, 'package.json'), JSON.stringify({
          name: '@omega.js/web',
          peerDependencies: { [SDK]: '>=9.9' },
        }));

        await translationSdkOp({ brandRoot: root, targets, runCommand: fakeRun() });

        ctx.expect(readPkg(targetPath).dependencies[SDK]).toBe('>=9.9');
      },
    },

    {
      name: 'translation-sdk: the fallback range still matches web\'s declared optional peer',
      run: (ctx) => {
        const webPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'package.json'), 'utf8'));

        ctx.expect(webPkg.peerDependencies[SDK], 'packages/web bumped its optional peer: update FALLBACK_RANGE in ensure/translation-sdk.js').toBe(FALLBACK_RANGE);
      },
    },

    {
      name: 'translation-sdk: explicit enabled + provider claude drifts the same way',
      run: async (ctx) => {
        const { root, targetPath, targets } = stageBrand({
          translation: { enabled: true, provider: 'claude', languages: ['fr'] },
        });

        const result = await translationSdkOp({ brandRoot: root, targets, runCommand: fakeRun() });

        ctx.expect(result.output.translationSdk.added).toEqual(['website']);
        ctx.expect(readPkg(targetPath).dependencies[SDK]).toBeTruthy();
      },
    },

    {
      name: 'translation-sdk: a failed install warns and the dep stays declared',
      run: async (ctx) => {
        const { root, targetPath, targets } = stageBrand({ translation: CLAUDE });

        const result = await translationSdkOp({
          brandRoot: root,
          targets,
          runCommand: fakeRun({ success: false, error: 'exit code 1' }),
        });

        ctx.expect(result.status).toBe('warned');
        ctx.expect(result.output.translationSdk).toEqual({ added: ['website'], installed: false, error: 'exit code 1' });
        ctx.expect(readPkg(targetPath).dependencies[SDK]).toBeTruthy();
      },
    },

    // ─── Converged ───────────────────────────────────────────────────────────────

    {
      name: 'translation-sdk: dep already declared → null return, byte-identical package.json, no install',
      run: async (ctx) => {
        const { root, targetPath, targets } = stageBrand({
          translation: CLAUDE,
          pkg: { name: 'fixture-website', dependencies: { '@omega.js/web': '^0.1.0', [SDK]: '^0.2.138' } },
        });
        const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');
        const run = fakeRun();

        ctx.expect(await translationSdkOp({ brandRoot: root, targets, runCommand: run })).toBe(null);
        ctx.expect(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8')).toBe(before);
        ctx.expect(run.calls).toEqual([]);
      },
    },

    {
      name: 'translation-sdk: a devDependency declaration counts as converged',
      run: async (ctx) => {
        const { root, targets } = stageBrand({
          translation: CLAUDE,
          pkg: { name: 'fixture-website', devDependencies: { [SDK]: '>=0.2' } },
        });
        const run = fakeRun();

        ctx.expect(await translationSdkOp({ brandRoot: root, targets, runCommand: run })).toBe(null);
        ctx.expect(run.calls).toEqual([]);
      },
    },

    {
      name: 'translation-sdk: a second pass over a healed target changes nothing',
      run: async (ctx) => {
        const { root, targetPath, targets } = stageBrand({ translation: CLAUDE });

        await translationSdkOp({ brandRoot: root, targets, runCommand: fakeRun() });
        const healed = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');

        const run = fakeRun();
        ctx.expect(await translationSdkOp({ brandRoot: root, targets, runCommand: run })).toBe(null);
        ctx.expect(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8')).toBe(healed);
        ctx.expect(run.calls).toEqual([]);
      },
    },

    // ─── Dry run ─────────────────────────────────────────────────────────────────

    {
      name: 'translation-sdk: dry run plans the add + install and writes nothing',
      run: async (ctx) => {
        const { root, targetPath, targets } = stageBrand({ translation: CLAUDE });
        const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');
        const run = fakeRun();

        const result = await translationSdkOp({ brandRoot: root, targets, options: { dryRun: true }, runCommand: run });

        ctx.expect(result.output).toEqual({ translationSdk: 'planned' });
        ctx.expect(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8')).toBe(before);
        ctx.expect(run.calls).toEqual([]);
      },
    },

    // ─── Gates ───────────────────────────────────────────────────────────────────

    {
      name: 'translation-sdk: translation off (no languages, or enabled false) is untouched',
      run: async (ctx) => {
        for (const translation of [undefined, { languages: [] }, { enabled: false, languages: ['es'] }]) {
          const { root, targetPath, targets } = stageBrand({ translation });
          const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');
          const run = fakeRun();

          ctx.expect(await translationSdkOp({ brandRoot: root, targets, runCommand: run })).toBe(null);
          ctx.expect(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8')).toBe(before);
          ctx.expect(run.calls).toEqual([]);
        }
      },
    },

    {
      name: 'translation-sdk: the chatgpt provider needs no SDK, so the target is untouched',
      run: async (ctx) => {
        const { root, targetPath, targets } = stageBrand({
          translation: { languages: ['es'], providers: { chatgpt: {} } },
        });
        const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');
        const run = fakeRun();

        ctx.expect(await translationSdkOp({ brandRoot: root, targets, runCommand: run })).toBe(null);
        ctx.expect(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8')).toBe(before);
        ctx.expect(run.calls).toEqual([]);
      },
    },

    {
      name: 'translation-sdk: an unreadable translation section warns instead of halting the walk',
      run: async (ctx) => {
        const { root, targetPath, targets } = stageBrand({ translation: { languages: ['zz'] } });
        const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');
        const run = fakeRun();

        const result = await translationSdkOp({ brandRoot: root, targets, runCommand: run });

        ctx.expect(result.status, 'the workspace runner is stopOnError, so this must not throw').toBe('warned');
        ctx.expect(result.output.findings.length).toBe(1);
        ctx.expect(result.output.findings[0]).toMatch(/^website: Unknown translation language\(s\): zz/);
        ctx.expect(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'), 'the target is left alone').toBe(before);
        ctx.expect(run.calls).toEqual([]);
      },
    },

    {
      name: 'translation-sdk: non-web targets are untouched (their framework ships the SDK)',
      run: async (ctx) => {
        const { root, targetPath, targets } = stageBrand({ translation: CLAUDE, target: 'extension' });
        const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');
        const run = fakeRun();

        ctx.expect(await translationSdkOp({ brandRoot: root, targets, runCommand: run })).toBe(null);
        ctx.expect(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8')).toBe(before);
        ctx.expect(run.calls).toEqual([]);
      },
    },
  ],
});
