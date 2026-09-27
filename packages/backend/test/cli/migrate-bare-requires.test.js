/**
 * Test: the backend leg of the brand root's `omega migrate` reports the bare
 * requires the legacy FLAT install answered and OMEGA does not. Under BEM a
 * ported ROUTE could `require('fs-jetpack')` and be right; under OMEGA it
 * resolves only by HOISTING, and the requires are LAZY, so the route 500s the
 * first time a request reaches it. The scan is devkit's, shared with the web
 * leg; this pins that a BACKEND target gets it, judged by the target's own
 * manifest, and that it REPORTS rather than installs, `--execute` included.
 *
 * Temp trees only, no project, no emulator. Run at the monorepo root:
 * npx omega test --target=backend framework:cli/migrate-bare-requires
 */
const path = require('path');
const jetpack = require('fs-jetpack');

const { migrateTarget } = require('../../dist/cli/utils/migrate.js');
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


module.exports = defineCases({
  description: 'migrateTarget: the backend target\'s bare-require scan (#600)',
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

        const result = migrateTarget(targetPath);

        assert.equal(result.due.length, 1, `only what this target does not declare: a built-in resolves everywhere, a relative path is not a package, and node-powertools IS declared: ${result.due.join(' | ')}`);
        assert.deepEqual(result.changed, [], 'a report writes nothing');
        assert.deepEqual(result.errors, []);

        const [line] = result.due;
        assert.ok(line.startsWith(`${path.join('src', 'routes', 'marketing', 'contact', 'post.js')}:4: \`fs-jetpack\``), `the line names the route, the line (the require is lazy, the route only 500s when it runs) and the package: ${line}`);
        assert.ok(/npm install fs-jetpack/.test(line), 'and the fix is the dependency, never an auto-install');
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

        const result = migrateTarget(targetPath, { execute: true });

        assert.equal(jetpack.read(path.join(targetPath, 'package.json')), before,
          'which package version a brand wants is the brand\'s call, so even --execute reports and stops');
        assert.deepEqual(result.changed, [], 'nothing was written');
        assert.match(result.due[result.due.length - 1], /--execute installs nothing/, 'and the report says so in one line');
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

        assert.deepEqual(migrateTarget(targetPath, { execute: true }), { due: [], changed: [], errors: [] }, 'nothing left to declare, and nothing to say about --execute');
      },
    },

    {
      name: 'a-target-with-no-manifest-to-judge-against-reports-nothing',
      auth: 'none',

      async run({ assert }) {
        const targetPath = seedTarget({ name: 'x' });
        jetpack.remove(path.join(targetPath, 'package.json'));

        assert.deepEqual(migrateTarget(targetPath).due, [],
          'with no manifest there is no "undeclared": guessing would name every package the route uses');
      },
    },
  ],
});
