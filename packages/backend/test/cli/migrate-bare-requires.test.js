/**
 * Test: `omega migrate` on a backend target reports the bare requires the
 * legacy FLAT install answered and OMEGA does not
 * ([#600](https://github.com/Omega-JS-Stack/omega/issues/600)).
 *
 * Under BEM every framework dependency sat in the consumer's own
 * `node_modules`, so a ported ROUTE could `require('fs-jetpack')` and be right.
 * Under OMEGA the framework is a package with its own tree, and such a require
 * resolves only by HOISTING. The requires that carried this were LAZY, inside
 * the handler that needs them, so the module loads fine and the route 500s the
 * first time a request actually reaches it.
 *
 * The scan itself is devkit's, shared with @omega.js/web's migrate; what this
 * pins is that a BACKEND target gets it, that it judges by the target's own
 * manifest, and that it REPORTS rather than installs.
 *
 * Temp trees only, no project, no emulator.
 *
 * Run: npx omega test backend:cli/migrate-bare-requires
 */
const path = require('path');
const jetpack = require('fs-jetpack');

const MigrateCommand = require('../../dist/cli/commands/migrate.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// A ported route, exactly as one arrives from BEM: the requires that matter are
// LAZY, inside the handler, which is why nothing catches them until a request
// does.
// The fixture lives beside the suite as `.js.txt`: the suite-portability scan
// reads every `test/**/*.js` for require() literals, and the route's relative
// require is the point of the fixture, not a require of this test.
const PORTED_ROUTE = jetpack.read(path.join(__dirname, '..', 'fixtures', 'migrate', 'ported-route.js.txt'));

/** Stage a backend target root with one ported route and a manifest. */
function seedTarget(manifest) {
  const targetPath = jetpack.tmpDir({ prefix: 'omega-migrate-bare-' }).cwd();

  jetpack.write(path.join(targetPath, 'package.json'), manifest);
  jetpack.write(path.join(targetPath, 'src', 'routes', 'marketing', 'contact', 'post.js'), PORTED_ROUTE);

  return targetPath;
}

/** Run the verb against a target root, exactly as the dispatcher does. */
async function migrate(targetPath) {
  const command = new MigrateCommand({ firebaseProjectPath: targetPath, argv: {}, options: {} });

  return command.execute();
}

module.exports = defineCases({
  description: 'migrate: the backend target\'s bare-require scan (#600)',
  type: 'group',

  tests: [
    {
      name: 'a-ported-route-requiring-an-undeclared-package-is-reported-by-file-and-line',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget({
          name: 'legacy-backend',
          dependencies: { 'node-powertools': '^3.0.0' },
        });

        const findings = await migrate(targetPath);

        assert.deepEqual(
          findings.map((entry) => entry.module),
          ['fs-jetpack'],
          'only what this target does not declare: a built-in resolves everywhere, a relative path is not a package, and node-powertools IS declared',
        );

        const [jetpackFinding] = findings;

        assert.equal(jetpackFinding.file, path.join('src', 'routes', 'marketing', 'contact', 'post.js'), 'the finding names the route');
        assert.equal(jetpackFinding.line, 4, 'and the line, because the require is lazy and the route only 500s when it runs');
        assert.ok(/npm install fs-jetpack/.test(jetpackFinding.fix), 'and the fix is the dependency, never an auto-install');
      },
    },

    {
      name: 'the-scan-reports-only-and-never-touches-the-manifest',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget({
          name: 'legacy-backend',
          dependencies: { 'node-powertools': '^3.0.0' },
        });
        const before = jetpack.read(path.join(targetPath, 'package.json'));

        await migrate(targetPath);

        assert.equal(jetpack.read(path.join(targetPath, 'package.json')), before,
          'which package version a brand wants is the brand\'s call, so the verb reports and stops');
      },
    },

    {
      name: 'a-target-declaring-everything-it-requires-is-reported-clean',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget({
          name: 'converged-backend',
          dependencies: { 'node-powertools': '^3.0.0', 'fs-jetpack': '^5.1.0' },
        });

        assert.deepEqual(await migrate(targetPath), [], 'nothing left to declare');
      },
    },

    {
      name: 'a-target-with-no-manifest-to-judge-against-reports-nothing',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget({ name: 'x' });
        jetpack.remove(path.join(targetPath, 'package.json'));

        assert.deepEqual(await migrate(targetPath), [],
          'with no manifest there is no "undeclared": guessing would name every package the route uses');
      },
    },
  ],
});
