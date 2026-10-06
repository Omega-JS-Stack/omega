/**
 * Test: the roster's supplier of project personas — `loadSeedAccounts`
 * ([#712](https://github.com/Omega-JS-Stack/omega/issues/712),
 * [#733](https://github.com/Omega-JS-Stack/omega/issues/733)).
 *
 * A project declares its own personas in `test/_init.js`, and the functions
 * process — which never ran the seed — reads them off disk to answer
 * `test/roster`. Two ways that goes quiet: the loader pointed one directory off
 * reads nothing and says nothing (the #712 symptom, invisible to every live
 * route test, because an empty extra-accounts half still serves the framework's
 * own roster), and a BROKEN `_init.js` used to be remembered as "this project
 * has no personas" for the whole process lifetime.
 *
 * PURE: `loadSeedAccounts` is file reads against a seeded temp project — no
 * emulator, no ctx. It reads through devkit's `loadInitHooks`, the one loader
 * the run itself uses: a factory gets `{ projectRoot, config, omega }`, and a
 * broken file is an `InitHookError` naming it, which the palette serves as `{}`.
 *
 * Run: npx omega test backend:helpers/seed-accounts-load
 */
const path = require('path');
const jetpack = require('fs-jetpack');
const { loadSeedAccounts } = require('../../dist/test/seed.js');
const { loadInitHooks, InitHookError } = require('../../dist/vendor/devkit/test/init-hooks.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// A project persona exactly as the extension point documents one: a palette
// label, so it is a persona a HUMAN switches to.
const PERSONA = { id: 'shop-owner', uid: '_test-shop-owner', email: '_test.shop-owner@{domain}', palette: 'Shop Owner', properties: {} };

const DECLARES_PERSONA = `module.exports = () => (${JSON.stringify({ accounts: [PERSONA] })});\n`;
const WILL_NOT_PARSE = 'module.exports = (\n';
const THROWS_WHEN_CALLED = 'module.exports = () => { throw new Error(\'_init.js blew up\'); };\n';
// The arrow-body typo: a labelled block, so the factory returns undefined.
const RETURNS_NOTHING = 'module.exports = (ctx) => { accounts: [] };\n';
// A persona that carries back what its factory was handed.
const ECHOES_ARGS = 'module.exports = ({ projectRoot, config }) => ({ accounts: [{ id: \'echo\', projectRoot, brandId: config.brand.id }] });\n';
const THROWS_ON_LOAD = 'throw new Error(\'_init.js will not load\');\n';

// A temp project root: `test/_init.js` under it, and nothing else a project has.
function seedProject(initSource) {
  const projectDir = jetpack.tmpDir({ prefix: 'omega-seed-accounts-' }).path();

  jetpack.write(path.join(projectDir, 'test', '_init.js'), initSource);

  return projectDir;
}

module.exports = defineCases({
  description: 'loadSeedAccounts reads a project\'s test/_init.js personas, and never caches a failed read',
  type: 'group',
  auth: 'none',
  timeout: 10000,

  tests: [
    // The wiring itself: the personas come from `<projectDir>/test/_init.js`,
    // and a projectDir one level off is the silence #712 shipped with.
    {
      name: 'project-personas-load-from-the-project-dir',
      async run({ expect }) {
        const projectDir = seedProject(DECLARES_PERSONA);

        try {
          const accounts = loadSeedAccounts({ projectDir });

          expect(
            accounts['shop-owner'],
            'The project\'s own persona must be loaded, keyed by its id',
          ).toEqual(PERSONA);

          // One directory off — `<projectDir>/test` rather than `<projectDir>`,
          // the exact miss #712 was — reads nothing, and the framework declares
          // no `test/_init.js` of its own, so the whole answer is empty.
          expect(
            loadSeedAccounts({ projectDir: path.join(projectDir, 'test') }),
            'A projectDir that holds no test/_init.js yields no accounts',
          ).toEqual({});
        } finally {
          jetpack.remove(projectDir);
        }
      },
    },

    // The failure is not an answer (#733). A file that will not parse used to be
    // cached as {} until the emulator restarted, so a fixed `_init.js` stayed
    // unread and the palette kept serving a roster without the project's half.
    {
      name: 'a-broken-init-is-re-read-once-it-is-fixed',
      async run({ expect }) {
        const projectDir = seedProject(WILL_NOT_PARSE);

        try {
          expect(
            loadSeedAccounts({ projectDir }),
            'A test/_init.js that will not parse loads no personas',
          ).toEqual({});

          jetpack.write(path.join(projectDir, 'test', '_init.js'), DECLARES_PERSONA);

          expect(
            loadSeedAccounts({ projectDir })['shop-owner'],
            'The next call re-reads the file the developer just fixed',
          ).toEqual(PERSONA);
        } finally {
          jetpack.remove(projectDir);
        }
      },
    },

    // The other half of the retry: a file that REQUIRED cleanly and then broke
    // (a hook factory that throws) sits in require.cache, so forgetting it in
    // the seed cache alone would keep serving the same broken module forever.
    {
      name: 'a-hook-that-threw-is-forgotten-by-require-too',
      async run({ expect }) {
        const projectDir = seedProject(THROWS_WHEN_CALLED);

        try {
          expect(
            loadSeedAccounts({ projectDir }),
            'A test/_init.js whose hook throws loads no personas',
          ).toEqual({});

          jetpack.write(path.join(projectDir, 'test', '_init.js'), DECLARES_PERSONA);

          expect(
            loadSeedAccounts({ projectDir })['shop-owner'],
            'The retry reads the fixed FILE, not the broken module require kept',
          ).toEqual(PERSONA);
        } finally {
          jetpack.remove(projectDir);
        }
      },
    },

    // The third broken shape (#733 review): a factory that returns no object.
    // Cached as "declares none" it would stick exactly like the parse failure.
    {
      name: 'a-factory-that-returns-nothing-is-a-failed-load-not-an-answer',
      async run({ expect }) {
        const projectDir = seedProject(RETURNS_NOTHING);

        try {
          expect(
            loadSeedAccounts({ projectDir }),
            'A hook factory that returns no object loads no personas',
          ).toEqual({});

          jetpack.write(path.join(projectDir, 'test', '_init.js'), DECLARES_PERSONA);

          expect(
            loadSeedAccounts({ projectDir })['shop-owner'],
            'The next call re-reads the fixed file instead of the remembered nothing',
          ).toEqual(PERSONA);
        } finally {
          jetpack.remove(projectDir);
        }
      },
    },

    {
      name: 'case-120-the-factory-gets-the-project-root-and-the-brand-config',
      async run({ expect }) {
        const projectDir = seedProject(ECHOES_ARGS);

        try {
          const echo = loadSeedAccounts({ projectDir, config: { brand: { id: 'seed-brand' } } }).echo;

          expect(echo, 'The factory\'s persona is loaded').toBeTruthy();
          expect(echo.projectRoot, 'The factory is handed the project root').toBe(projectDir);
          expect(echo.brandId, 'and the brand config').toBe('seed-brand');
        } finally {
          jetpack.remove(projectDir);
        }
      },
    },

    {
      name: 'case-120-an-init-that-throws-on-load-is-an-InitHookError-naming-the-file',
      async run({ expect }) {
        const projectDir = seedProject(THROWS_ON_LOAD);
        const file = path.join(projectDir, 'test', '_init.js');
        const roots = [{ dir: path.join(projectDir, 'test'), label: 'project' }];

        try {
          expect(
            () => loadInitHooks(roots, { projectRoot: projectDir, factoryArgs: { config: {}, omega: null, ctx: null } }),
            'The run\'s loader refuses the file by name',
          ).toThrow({ name: 'InitHookError', file });
          expect(() => loadInitHooks(roots, { projectRoot: projectDir })).toThrow(InitHookError);
          expect(loadSeedAccounts({ projectDir }), 'The palette serves no personas for it').toEqual({});
        } finally {
          jetpack.remove(projectDir);
        }
      },
    },
  ],
});
