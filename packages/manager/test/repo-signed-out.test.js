/**
 * A GitHub CLI that cannot answer, on the repo service's REAL setup path (no
 * injected client): signed out in a headless walk is a missing key, skipped
 * with the line that names it, like every other service's missing credential.
 * In a terminal, or with no `gh` at all, it stays an error. The `gh` is the
 * fake on PATH (test/lib/fake-gh.js); nothing here reaches GitHub.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('node:path');
const jetpack = require('fs-jetpack');

require('@omega.js/devkit/test/temp-home');

const { activate } = require('./lib/fake-gh.js');
const { openTtyPrompt } = require('./lib/interactive.js');
const { OPERATIONS } = require('../src/config.js');
const service = require('../src/services/repo/index.js');

const { useGh, withoutGh } = activate();

const SIGN_IN_LINE = 'GitHub CLI is not authenticated. Run: gh auth login (or set GH_TOKEN in the brand .env)';
const INSTALL_LINE = 'GitHub CLI (gh) is not installed. Install from: https://cli.github.com/';
const JOURNEY = path.join(__dirname, '..', '..', '..', 'test', 'e2e', 'journey.test.js');

/** Set (or, for undefined, delete) env keys for one test, restored after it. */
function withEnv(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const apply = (entries) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  t.after(() => apply(previous));
}

/** A brand with a repo block, walked through the service with no client injected. */
function walk() {
  const root = jetpack.tmpDir({ prefix: 'omega-repo-signed-out-' }).cwd();
  jetpack.write(path.join(root, 'package.json'), { name: 'fixture-brand', private: true });
  const config = {
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
    repo: { provider: 'github', owner: 'fixture-org' },
    targets: { web: { type: 'web' } },
  };

  // A setup that throws and a result that says error are the same outcome here
  return service.run({
    brandId: 'fixture-brand',
    brandRoot: root,
    brandConfig: config,
    brand: { id: 'fixture-brand', config, enabledTargets: ['web'], targets: [] },
    targets: [],
    operations: OPERATIONS.repo,
    options: {},
    serviceData: {},
  }).then((result) => result, (error) => ({ status: 'error', error: error.message }));
}

module.exports = defineCases({
  type: 'group',
  description: 'repo-signed-out',
  tests: [
    {
      name: '#1037 a headless walk with a signed-out gh skips the repo service, naming GH_TOKEN and gh auth login',
      run: async (ctx) => {
        withEnv(ctx, { OMEGA_NON_INTERACTIVE: '1', GH_TOKEN: undefined, GITHUB_TOKEN: undefined });
        ctx.after(useGh(null));

        const result = await walk();

        ctx.expect(result.status, JSON.stringify(result)).toBe('skipped');
        ctx.expect(result.missingEnv).toEqual(['GH_TOKEN']);
        ctx.expect(result.reason).toMatch(/gh auth login/);
      },
    },

    {
      name: '#1037 in a terminal, a signed-out gh is still the repo service\'s error, with the sign-in line',
      run: async (ctx) => {
        withEnv(ctx, { OMEGA_NON_INTERACTIVE: undefined, GH_TOKEN: undefined, GITHUB_TOKEN: undefined });
        ctx.after(useGh(null));
        const tty = openTtyPrompt();
        ctx.after(() => tty.close());

        const result = await walk();

        ctx.expect(result.status, JSON.stringify(result)).toBe('error');
        ctx.expect(String(result.error).includes(SIGN_IN_LINE), result.error).toBeTruthy();
      },
    },

    {
      name: '#1037 a gh that is not installed is the repo service\'s error, with the install line, headless too',
      run: async (ctx) => {
        withEnv(ctx, { OMEGA_NON_INTERACTIVE: '1' });
        ctx.after(withoutGh());

        const result = await walk();

        ctx.expect(result.status, JSON.stringify(result)).toBe('error');
        ctx.expect(String(result.error).includes(INSTALL_LINE), result.error).toBeTruthy();
      },
    },

    {
      name: '#1037 the journey lane no longer allows a repo service error',
      run: (ctx) => {
        const text = jetpack.read(JOURNEY);
        const allowed = /allowedServiceErrors:\s*\[([^\]]*)\]/.exec(text);

        ctx.expect(allowed, 'the journey lane declares its allowed service errors').toBeTruthy();
        const names = [...allowed[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
        ctx.expect(!names.includes('repo'), `allowed: ${names.join(', ')}`).toBeTruthy();
      },
    },
  ],
});
