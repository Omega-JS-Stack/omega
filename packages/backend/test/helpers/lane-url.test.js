/**
 * Test: live-lane suites address the lane THIS run booted (pure logic)
 *
 * The mcp and verts suites hardcoded `http://localhost:5002`. A lane that
 * bumps off the classic ports (a second brand's emulator, or the corpus lane
 * booting beside a running dev stack) still answers on its own hosting port —
 * so all 24 of those tests left the lane and hit whatever held 5002, which on
 * a dev machine is a LIVE stack
 * ([#511](https://github.com/Omega-JS-Stack/omega/issues/511)).
 *
 * The lane's resolved port lives in one place: the test context's
 * `config.apiUrl`, built from the same port map (`.temp/ports.json` →
 * `firebase.json` → classic) the runner's own http client uses. This is a
 * static tripwire — a literal lane port in a suite is the bug returning.
 *
 * Run: npx omega test backend:helpers/lane-url
 */
const fs = require('fs');
const path = require('path');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// Suites that talk to the RUNNING emulator over raw fetch (the http client
// already carries apiUrl for everything else)
const LIVE_LANE_DIRS = ['mcp', path.join('routes', 'verts')];

// Every port the emulator stack allocates, plus the bumped neighbours a
// relocated lane lands on — none of them may be named by a suite
const LANE_PORTS = [4050, 4051, 5001, 5002, 5003, 5004, 8080, 8081, 9000, 9099, 9100, 9199];

const TEST_DIR = path.join(__dirname, '..');

function suiteFiles() {
  const files = [];

  for (const dir of LIVE_LANE_DIRS) {
    const full = path.join(TEST_DIR, dir);

    for (const name of fs.readdirSync(full)) {
      if (name.endsWith('.test.js')) {
        files.push({ relative: path.join(dir, name), source: fs.readFileSync(path.join(full, name), 'utf8') });
      }
    }
  }

  return files;
}

module.exports = defineCases({
  description: 'live-lane suites address the lane they booted',
  type: 'group',

  tests: [
    {
      name: 'no-suite-hardcodes-a-lane-port',
      async run({ assert }) {
        const files = suiteFiles();
        assert.equal(files.length > 5, true, `live-lane suites found (${files.length} files)`);

        for (const { relative, source } of files) {
          for (const port of LANE_PORTS) {
            const literal = new RegExp(`(?:localhost|127\\.0\\.0\\.1|\\[::1\\]):${port}\\b`);

            assert.equal(literal.test(source), false, `${relative} hardcodes lane port ${port} — resolve it from config.apiUrl instead`);
          }
        }
      },
    },

    {
      name: 'every-fetching-suite-resolves-its-url-from-the-lane-config',
      async run({ assert }) {
        for (const { relative, source } of suiteFiles()) {
          if (!source.includes('fetch(')) {
            continue;
          }

          assert.equal(source.includes('config.apiUrl'), true, `${relative} fetches without reading config.apiUrl — it cannot follow a bumped lane`);
        }
      },
    },

    {
      name: 'the-runner-hands-every-test-the-lane-url',
      async run({ assert, config }) {
        assert.ok(config.apiUrl, 'context config carries apiUrl');
        assert.equal(new URL(config.apiUrl).port, String(config.emulatorPorts.hosting), 'apiUrl names the hosting port THIS lane resolved');
      },
    },
  ],
});
