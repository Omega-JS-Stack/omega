// Build-layer tests for the release pipeline modules.
// We don't actually run electron-builder or signtool — those are external tools.
// We verify the modules load cleanly, export the right shape, and dispatch correctly.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const defineCases = require('@omega.js/devkit/test/define-cases');

// Helper: stage a consumer dir with config/omega.json5 containing the given
// platforms.windows.signing.strategy (under targets.desktop in the raw file). Returns the
// abs path to the temp dir; caller is responsible for chdir'ing into it and cleaning up.
function stageStrategyConfig({ strategy, cloudProvider }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-sign-'));
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
  const signing = { strategy };
  if (cloudProvider) signing.cloud = { provider: cloudProvider };
  fs.writeFileSync(
    path.join(tmp, 'config', 'omega.json5'),
    JSON.stringify({ targets: { desktop: { type: 'desktop', platforms: { windows: { signing } } } } }),
  );
  return tmp;
}

// Helper: stage a brand monorepo with one desktop target, so the seed-mode walk
// (config/omega.json5 at the root, the target under targets/) sees a real brand.
// Returns { brandRoot, targetDir }.
function stageBrand(config) {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-brand-'));
  const targetDir = path.join(brandRoot, 'targets', 'desktop');
  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), JSON.stringify(config));
  return { brandRoot, targetDir };
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'release pipeline — package / release / sign-windows / notarize hook',
  tests: [

    {
      name: 'deploy-precheck: provisions <org>/<brand.id>-releases PUBLIC through the devkit ensureRepo (#799, #883)',
      run: async (ctx) => {
        const { provisionReleaseRepos } = require(path.join(__dirname, '..', '..', '..', 'commands', 'lib', 'deploy-precheck.js'));
        const calls = [];
        const lines = [];

        await provisionReleaseRepos({
          log: (line) => lines.push(line),
          warn: (line) => lines.push(line),
          config: { brand: { id: 'omega-playground' }, repo: { provider: 'github', org: 'Omega-JS-Stack' }, releases: {} },
          // The ONE github boundary (#883): `gh` with an argv array, so the
          // create is readable here exactly as it runs.
          execFn: (file, args) => {
            calls.push({ file, args });
            if (args[0] === 'api') throw new Error('gh api failed: 404 Not Found');
            return '';
          },
        });

        const create = calls.find((call) => call.args[0] === 'repo');
        ctx.expect(create.file).toBe('gh');
        ctx.expect(create.args.slice(0, 4)).toEqual(['repo', 'create', 'Omega-JS-Stack/omega-playground-releases', '--public']);
        // A release needs a tag and a tag needs a commit: this is the one repo
        // that is created WITH one.
        ctx.expect(create.args).toContain('--add-readme');
        ctx.expect(lines.join('\n')).toContain('Omega-JS-Stack/omega-playground-releases');
      },
    },

    {
      name: 'deploy-precheck: a config that names no org warns and creates nothing (#883)',
      run: async (ctx) => {
        const { provisionReleaseRepos } = require(path.join(__dirname, '..', '..', '..', 'commands', 'lib', 'deploy-precheck.js'));
        const lines = [];

        await provisionReleaseRepos({
          log: (line) => lines.push(line),
          warn: (line) => lines.push(line),
          config: { brand: { id: 'acme' }, releases: {} },
          execFn: () => { throw new Error('gh must not run'); },
        });

        ctx.expect(lines.join('\n')).toContain('repo.org');
      },
    },
    {
      name: 'finalize-release: --publish flips the release in the config\'s releases repo (#799)',
      run: async (ctx) => {
        const finalizeRelease = require(path.join(__dirname, '..', '..', '..', 'commands', 'finalize-release.js'));
        const { brandRoot, targetDir } = stageBrand({
          brand: { id: 'acme' },
          repo: { provider: 'github', org: 'Acme-Org' },
          targets: { desktop: { type: 'desktop', releases: {} } },
        });
        fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'acme-desktop', version: '1.2.3' }));

        const asked = [];
        const flipped = [];
        const octokit = {
          // The release is found by LISTING, drafts included (#810).
          paginate: async (route, args) => {
            asked.push(`${args.owner}/${args.repo}`);
            return [{ id: 7, tag_name: 'v1.2.3', draft: true, prerelease: false, created_at: '2026-09-08T01:31:00Z' }];
          },
          rest: {
            repos: {
              listReleases: () => {},
              updateRelease: async (args) => { flipped.push(args.release_id); return { data: {} }; },
              listReleaseAssets: async () => ({ data: [{ name: 'latest.yml' }, { name: 'latest-mac.yml' }, { name: 'latest-linux.yml' }] }),
            },
          },
        };

        const cwd = process.cwd();
        const token = process.env.GH_TOKEN;
        process.env.GH_TOKEN = 'ghp_test_fake_token_for_unit_test';
        process.chdir(targetDir);
        try {
          await finalizeRelease({ publish: true, octokit });
        } finally {
          process.chdir(cwd);
          if (token !== undefined) process.env.GH_TOKEN = token; else delete process.env.GH_TOKEN;
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }

        // v<version> in the brand's ONE releases repo: the same address the build
        // baked into the update feed, and the draft carrying that tag is the one
        // flipped to published.
        ctx.expect(asked).toEqual(['Acme-Org/acme-releases']);
        ctx.expect(flipped).toEqual([7]);
      },
    },
    {
      name: 'gulp/package.js exports a function',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'package.js'));
        ctx.expect(typeof mod).toBe('function');
      },
    },
    {
      name: 'gulp/release.js exports a function',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'release.js'));
        ctx.expect(typeof mod).toBe('function');
      },
    },
    {
      name: 'gulp/build-config.js exports a function (already-tested separately, smoke check here)',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'build-config.js'));
        ctx.expect(typeof mod).toBe('function');
      },
    },
    {
      name: 'commands/sign-windows.js exports an async function',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));
        ctx.expect(typeof mod).toBe('function');
      },
    },
    {
      name: 'sign-windows: --smoke on non-Windows throws',
      run: async (ctx) => {
        if (process.platform === 'win32') return; // skip on actual Windows
        const signWindows = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));
        let threw;
        try {
          await signWindows({ smoke: true });
        } catch (e) { threw = e; }
        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/Windows-only|WIN_EV_TOKEN_PATH|WIN_CSC_KEY_PASSWORD/);
      },
    },
    {
      name: 'sign-windows: --target with non-existent file throws',
      run: async (ctx) => {
        const signWindows = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));
        let threw;
        try {
          await signWindows({ target: '/nonexistent/binary.exe' });
        } catch (e) { threw = e; }
        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/--target file does not exist/);
      },
    },
    {
      name: 'sign-windows: errors clearly when no input directory exists',
      run: async (ctx) => {
        const signWindows = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));
        let threw;
        try {
          await signWindows({ in: '/nonexistent/path/that/does/not/exist' });
        } catch (e) {
          threw = e;
        }
        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/does not exist/);
      },
    },
    {
      name: 'sign-windows: cloud strategy with unknown provider throws a clear error',
      run: async (ctx) => {
        const signWindows = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));
        // Stage a consumer dir with strategy='cloud' + a bogus provider in config.
        const tmp = stageStrategyConfig({ strategy: 'cloud', cloudProvider: 'imaginary-provider-xyz' });
        fs.writeFileSync(path.join(tmp, 'fake.exe'), 'fake');

        const origCwd = process.cwd();
        process.chdir(tmp);

        try {
          let threw;
          try {
            await signWindows({ in: tmp, out: path.join(tmp, 'signed') });
          } catch (e) {
            threw = e;
          }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/imaginary-provider-xyz|not yet implemented/);
        } finally {
          process.chdir(origCwd);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'sign-windows: cloud strategy without provider throws',
      run: async (ctx) => {
        const signWindows = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));
        const tmp = stageStrategyConfig({ strategy: 'cloud' });
        fs.writeFileSync(path.join(tmp, 'fake.exe'), 'fake');

        const origCwd = process.cwd();
        process.chdir(tmp);

        try {
          let threw;
          try {
            await signWindows({ in: tmp });
          } catch (e) {
            threw = e;
          }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/no provider set/);
        } finally {
          process.chdir(origCwd);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'sign-windows: unknown strategy throws',
      run: async (ctx) => {
        const signWindows = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));
        const tmp = stageStrategyConfig({ strategy: 'banana' });
        fs.writeFileSync(path.join(tmp, 'fake.exe'), 'fake');

        const origCwd = process.cwd();
        process.chdir(tmp);

        try {
          let threw;
          try {
            await signWindows({ in: tmp });
          } catch (e) {
            threw = e;
          }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toMatch(/Unknown Windows signing strategy/);
        } finally {
          process.chdir(origCwd);
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'notarize hook: skipped on non-darwin platforms',
      run: async (ctx) => {
        const notarize = require(path.join(__dirname, '..', '..', '..', 'hooks', 'notarize.js'));
        // Just confirms it returns cleanly without env vars when platform isn't darwin.
        const result = await notarize({
          electronPlatformName: 'win32',
          appOutDir: '/tmp',
          packager: { appInfo: { productFilename: 'test' } },
        });
        ctx.expect(result).toBeUndefined();
      },
    },
    {
      name: 'notarize hook: invokes consumer hook at hooks/notarize/post (not legacy hooks/notarize.js)',
      run: (ctx) => {
        // Source-text guard for the rename. We can't easily exercise the live call
        // without staging a fake API key + .app bundle, so this asserts the call site
        // points at the new path. If someone reverts to runConsumerHook('notarize', ...)
        // this fires.
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'hooks', 'notarize.js'), 'utf8');
        ctx.expect(src).toContain("runConsumerHook('notarize/post'");
        ctx.expect(src).not.toMatch(/runConsumerHook\(['"]notarize['"]/);
      },
    },
    {
      name: 'default scaffold ships hooks/notarize/post.js (not legacy hooks/notarize.js)',
      run: (ctx) => {
        const defaultsHooks = path.join(__dirname, '..', '..', '..', 'defaults', 'hooks');
        ctx.expect(fs.existsSync(path.join(defaultsHooks, 'notarize', 'post.js'))).toBe(true);
        ctx.expect(fs.existsSync(path.join(defaultsHooks, 'notarize.js'))).toBe(false);
      },
    },
    {
      // Flipped by #891: a mac build that reaches this hook is one this
      // framework ships, so credentials it cannot find stop the build.
      name: 'notarize hook: THROWS when the API key env vars are missing',
      run: async (ctx) => {
        const notarize = require(path.join(__dirname, '..', '..', '..', 'hooks', 'notarize.js'));
        // Snapshot + clear env.
        const snapshot = {
          APPLE_API_KEY:    process.env.APPLE_API_KEY,
          APPLE_API_KEY_ID: process.env.APPLE_API_KEY_ID,
          APPLE_API_ISSUER: process.env.APPLE_API_ISSUER,
        };
        delete process.env.APPLE_API_KEY;
        delete process.env.APPLE_API_KEY_ID;
        delete process.env.APPLE_API_ISSUER;

        try {
          await ctx.expect(() => notarize({
            electronPlatformName: 'darwin',
            appOutDir: '/tmp',
            packager: { appInfo: { productFilename: 'test' } },
          })).toThrow(/APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER are required/);
        } finally {
          for (const [k, v] of Object.entries(snapshot)) {
            if (v !== undefined) process.env[k] = v;
            else delete process.env[k];
          }
        }
      },
    },
  ],
});
