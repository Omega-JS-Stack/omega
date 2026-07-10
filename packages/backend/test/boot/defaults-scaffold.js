/**
 * Defaults scaffold — @omega.js/backend's framework self-test layer.
 *
 * Runs ONLY during framework self-test (like emulator-boots.js). Exercises the
 * REAL scaffolding path — dist/utils/scaffold-defaults.js (the devkit defaults
 * engine + @omega.js/backend's actual FILE_MAP) against dist/defaults/ — into temp dirs:
 * fresh scaffold, marker-merge preservation, custom-key promotion, idempotency.
 *
 * This is @omega.js/backend's equivalent of EM/BXM's defaults-scaffold build suites.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const jetpack = require('fs-jetpack');

const { scaffoldDefaults } = require('../../dist/utils/scaffold-defaults.js');
const { DEFAULT_MARKER, CUSTOM_MARKER } = require('../../dist/utils/merge-line-files.js');

// The engine logs per-file by default; tests only want failures surfaced.
const quiet = { log() {}, warn: console.warn, error: console.error };

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bem-defaults-'));
}

module.exports = {
  description: 'Defaults scaffold — devkit engine + real @omega.js/backend file map',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'fresh-scaffold-lands-full-tree-with-renames',
      async run({ assert }) {
        const tmp = makeTmp();
        const result = scaffoldDefaults({ outputDir: tmp, logger: quiet });

        // `_.gitignore` → .gitignore at root; `functions/_.env` → functions/.env.
        const expected = [
          '.gitignore',
          'CHANGELOG.md',
          'CLAUDE.md',
          'docs/README.md',
          'functions/.env',
          'test/README.md',
          'test/_init.js',
        ];
        assert.deepEqual(result.written.slice().sort(), expected);

        for (const file of expected) {
          assert.equal(jetpack.exists(path.join(tmp, file)), 'file', `${file} should exist`);
        }

        // Marker files ship with the protocol sections intact.
        const env = jetpack.read(path.join(tmp, 'functions', '.env'));
        assert.ok(env.includes(DEFAULT_MARKER) && env.includes(CUSTOM_MARKER), '.env should carry both section markers');
      },
    },
    {
      name: 'remerge-preserves-consumer-values-and-custom-sections',
      async run({ assert }) {
        const tmp = makeTmp();
        scaffoldDefaults({ outputDir: tmp, logger: quiet });

        // Consumer fills a default key and adds their own custom key + gitignore line.
        const envPath = path.join(tmp, 'functions', '.env');
        jetpack.write(envPath, jetpack.read(envPath)
          .replace('GH_TOKEN=""', 'GH_TOKEN="ghp_mine"')
          .replace('# ...', 'MY_CUSTOM="kept"\n# ...'));
        const giPath = path.join(tmp, '.gitignore');
        jetpack.write(giPath, jetpack.read(giPath).replace('# ...', 'my-secret-dir/\n# ...'));

        scaffoldDefaults({ outputDir: tmp, logger: quiet });

        const env = jetpack.read(envPath);
        assert.ok(env.includes('GH_TOKEN="ghp_mine"'), 'filled default key should survive re-merge');
        assert.ok(env.includes('MY_CUSTOM="kept"'), 'custom .env key should survive re-merge');
        assert.ok(jetpack.read(giPath).includes('my-secret-dir/'), 'custom .gitignore line should survive re-merge');
      },
    },
    {
      name: 'custom-key-newly-owned-by-framework-promotes-into-default',
      async run({ assert }) {
        const tmp = makeTmp();

        // Legacy consumer .env: markers present, but a key the CURRENT template
        // owns (OPENAI_API_KEY) sits in their Custom section with a value.
        jetpack.write(path.join(tmp, 'functions', '.env'), [
          DEFAULT_MARKER,
          'GH_TOKEN=""',
          '',
          CUSTOM_MARKER,
          'OPENAI_API_KEY="sk-mine"',
          '',
        ].join('\n'));

        scaffoldDefaults({ outputDir: tmp, logger: quiet });

        const env = jetpack.read(path.join(tmp, 'functions', '.env'));
        const defaultPart = env.slice(0, env.indexOf(CUSTOM_MARKER));
        const customPart = env.slice(env.indexOf(CUSTOM_MARKER));
        assert.ok(defaultPart.includes('OPENAI_API_KEY="sk-mine"'), 'value should be promoted UP into the Default section');
        assert.ok(!customPart.includes('OPENAI_API_KEY'), 'promoted key should be dropped from the Custom section');
      },
    },
    {
      name: 'rerun-is-idempotent',
      async run({ assert }) {
        const tmp = makeTmp();
        scaffoldDefaults({ outputDir: tmp, logger: quiet });

        const second = scaffoldDefaults({ outputDir: tmp, logger: quiet });
        assert.equal(second.written.length + second.merged.length, 0, 'second run should write nothing');

        const snapshot = jetpack.inspectTree(tmp, { checksum: 'md5' });
        scaffoldDefaults({ outputDir: tmp, logger: quiet });
        assert.deepEqual(jetpack.inspectTree(tmp, { checksum: 'md5' }), snapshot, 'third run should leave the tree byte-identical');
      },
    },
  ],
};
