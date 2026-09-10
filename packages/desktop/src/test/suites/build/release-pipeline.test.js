// Build-layer tests for the release pipeline modules.
// We don't actually run electron-builder or signtool — those are external tools.
// We verify the modules load cleanly, export the right shape, and dispatch correctly.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const defineCases = require('@omega.js/devkit/test/define-cases');

// Helper: stage a consumer dir with config/omega.json5 containing the given
// platforms.win.signing.strategy (under targets.desktop in the raw file). Returns the
// abs path to the temp dir; caller is responsible for chdir'ing into it and cleaning up.
function stageStrategyConfig({ strategy, cloudProvider }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-sign-'));
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
  const signing = { strategy };
  if (cloudProvider) signing.cloud = { provider: cloudProvider };
  fs.writeFileSync(
    path.join(tmp, 'config', 'omega.json5'),
    JSON.stringify({ targets: { desktop: { platforms: { win: { signing } } } } }),
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
      name: 'release: the dispatch address is the CONFIG\'s brand repo and the COMPOSED workflow name (#799)',
      run: (ctx) => {
        const { dispatchTarget } = require(path.join(__dirname, '..', '..', '..', 'commands', 'release.js'));
        const { brandRoot, targetDir } = stageBrand({ brand: { id: 'acme' }, repo: { providers: { github: { org: 'Acme-Org' } } } });

        try {
          // A target nested in a brand (and the brand nested in another repo, as
          // the playground is here) dispatches on the repo its CONFIG names: the
          // enclosing git remote is somebody else's repo entirely.
          // The name is the derived `<brand.id>-omega` default (#809): the config
          // declares an org and no repo of its own.
          ctx.expect(dispatchTarget({
            projectRoot: targetDir,
            config: { brand: { id: 'acme' }, repo: { providers: { github: { org: 'Acme-Org' } } } },
          })).toEqual({ owner: 'Acme-Org', repo: 'acme-omega', workflow: 'desktop-build.yml' });
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'release: a STANDALONE target dispatches the plain build.yml, and an unaddressable repo throws',
      run: (ctx) => {
        const { dispatchTarget } = require(path.join(__dirname, '..', '..', '..', 'commands', 'release.js'));
        const standalone = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-standalone-'));

        try {
          const config = { brand: { id: 'acme' }, repo: { providers: { github: { org: 'Acme-Org', repo: 'itw-creative-works/acme-app' } } } };
          ctx.expect(dispatchTarget({ projectRoot: standalone, config })).toEqual({
            owner: 'itw-creative-works', repo: 'acme-app', workflow: 'build.yml',
          });

          // Half an address addresses nothing: fail loudly instead of POSTing to
          // `undefined/acme`.
          ctx.expect(() => dispatchTarget({ projectRoot: standalone, config: { brand: { id: 'acme' } } }))
            .toThrow(/brand repo/);
        } finally {
          fs.rmSync(standalone, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'deploy-precheck: provisions <owner>/<brand.id>-releases from config, never a discovered owner (#799)',
      run: async (ctx) => {
        const { provisionReleaseRepos } = require(path.join(__dirname, '..', '..', '..', 'commands', 'lib', 'deploy-precheck.js'));
        const created = [];
        const octokit = {
          rest: {
            repos: {
              get: async () => { const error = new Error('Not Found'); error.status = 404; throw error; },
              createInOrg: async (args) => created.push(`${args.org}/${args.name}`),
              createForAuthenticatedUser: async (args) => created.push(`me/${args.name}`),
            },
            users: { getAuthenticated: async () => ({ data: { login: 'somebody-else' } }) },
          },
        };
        const lines = [];

        await provisionReleaseRepos({
          log: (line) => lines.push(line),
          warn: (line) => lines.push(line),
          octokit,
          config: { brand: { id: 'omega-playground' }, repo: { providers: { github: { org: 'Omega-JS-Stack' } } }, releases: {} },
        });

        ctx.expect(created).toEqual(['Omega-JS-Stack/omega-playground-releases']);
        ctx.expect(lines.join('\n')).toContain('Omega-JS-Stack/omega-playground-releases');
      },
    },
    {
      name: 'finalize-release: --publish flips the release in the config\'s releases repo (#799)',
      run: async (ctx) => {
        const finalizeRelease = require(path.join(__dirname, '..', '..', '..', 'commands', 'finalize-release.js'));
        const { brandRoot, targetDir } = stageBrand({
          brand: { id: 'acme' },
          repo: { providers: { github: { org: 'Acme-Org' } } },
          targets: { desktop: { releases: {} } },
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
      name: 'notarize hook: warns + returns when API key env vars are missing',
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
          const result = await notarize({
            electronPlatformName: 'darwin',
            appOutDir: '/tmp',
            packager: { appInfo: { productFilename: 'test' } },
          });
          ctx.expect(result).toBeUndefined();
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
