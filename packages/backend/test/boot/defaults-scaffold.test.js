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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'backend-defaults-'));
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

        // `_.gitignore` → .gitignore, `_.env` → .env — BOTH at the target root
        // (src/dist pillar: functions/ is staged output, never scaffolded).
        const expected = [
          '.env',
          '.gitignore',
          'AGENTS.md',
          'CHANGELOG.md',
          'CLAUDE.md',
          'docs/README.md',
          'test/README.md',
          'test/_init.js',
        ];
        assert.deepEqual(result.written.slice().sort(), expected);

        for (const file of expected) {
          assert.equal(jetpack.exists(path.join(tmp, file)), 'file', `${file} should exist`);
        }

        // The agent-docs chain (#63): AGENTS.md carries the content, CLAUDE.md is
        // the one-line `@AGENTS.md` pointer.
        assert.ok(jetpack.read(path.join(tmp, 'AGENTS.md')).includes('node_modules/@omega.js/AGENTS.md'), 'AGENTS.md points at the OMEGA map');
        assert.equal(jetpack.read(path.join(tmp, 'CLAUDE.md')).trim(), '@AGENTS.md');

        // Marker files ship with the protocol sections intact.
        const env = jetpack.read(path.join(tmp, '.env'));
        assert.ok(env.includes(DEFAULT_MARKER) && env.includes(CUSTOM_MARKER), '.env should carry both section markers');
      },
    },
    {
      name: 'remerge-preserves-consumer-values-and-custom-sections',
      async run({ assert }) {
        const tmp = makeTmp();
        scaffoldDefaults({ outputDir: tmp, logger: quiet });

        // Consumer fills a default key (uncommenting its `# KEY=` placeholder)
        // and adds their own custom key + gitignore line.
        const envPath = path.join(tmp, '.env');
        jetpack.write(envPath, jetpack.read(envPath)
          .replace('# GH_TOKEN=', 'GH_TOKEN="ghp_mine"')
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
        jetpack.write(path.join(tmp, '.env'), [
          DEFAULT_MARKER,
          'GH_TOKEN=""',
          '',
          CUSTOM_MARKER,
          'OPENAI_API_KEY="sk-mine"',
          '',
        ].join('\n'));

        scaffoldDefaults({ outputDir: tmp, logger: quiet });

        const env = jetpack.read(path.join(tmp, '.env'));
        const defaultPart = env.slice(0, env.indexOf(CUSTOM_MARKER));
        const customPart = env.slice(env.indexOf(CUSTOM_MARKER));
        assert.ok(defaultPart.includes('OPENAI_API_KEY="sk-mine"'), 'value should be promoted UP into the Default section');
        assert.ok(!customPart.includes('OPENAI_API_KEY'), 'promoted key should be dropped from the Custom section');
      },
    },
    {
      name: 'brand-context-skips-per-target-docs',
      async run({ assert }) {
        // Brand doc unification: inside a brand monorepo the brand root is the
        // one doc home — AGENTS.md/CLAUDE.md/CHANGELOG.md/docs/ never scaffold.
        const tmp = makeTmp();
        jetpack.write(path.join(tmp, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        const targetDir = path.join(tmp, 'targets', 'backend');
        jetpack.dir(targetDir);

        const result = scaffoldDefaults({ outputDir: targetDir, logger: quiet });

        for (const file of ['AGENTS.md', 'CLAUDE.md', 'CHANGELOG.md', 'docs/README.md']) {
          assert.equal(jetpack.exists(path.join(targetDir, file)), false, `${file} must not scaffold in brand context`);
        }
        // The non-doc defaults still land.
        for (const file of ['.env', '.gitignore', 'test/_init.js']) {
          assert.equal(jetpack.exists(path.join(targetDir, file)), 'file', `${file} should still scaffold`);
        }
        assert.equal(result.removed.length, 0, 'nothing to sweep on a fresh app');
      },
    },
    {
      name: 'brand-context-sweeps-framework-owned-docs-preserves-consumer-content',
      async run({ assert }) {
        // Seed a standalone scaffold, then wrap it in a brand monorepo — the
        // next setup sweeps the framework-owned per-target docs (one-time heal)
        // but never destroys an AGENTS.md carrying consumer notes.
        const tmp = makeTmp();
        const targetDir = path.join(tmp, 'targets', 'backend');
        jetpack.dir(targetDir);
        scaffoldDefaults({ outputDir: targetDir, logger: quiet });
        jetpack.write(path.join(tmp, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");

        const swept = scaffoldDefaults({ outputDir: targetDir, logger: quiet });

        assert.deepEqual(swept.removed.slice().sort(), ['AGENTS.md', 'CHANGELOG.md', 'CLAUDE.md', 'docs/README.md']);
        assert.equal(jetpack.exists(path.join(targetDir, 'docs')), false, 'emptied docs/ dir is pruned');

        // Consumer content is never destroyed: an AGENTS.md with real notes
        // below the Custom marker stays, with a warning.
        const warnings = [];
        jetpack.write(path.join(targetDir, 'AGENTS.md'),
          `${DEFAULT_MARKER}\nframework guidance\n\n${CUSTOM_MARKER}\nOur deploy needs the VPN up.\n`);
        const kept = scaffoldDefaults({ outputDir: targetDir, logger: { log() {}, warn: (m) => warnings.push(m), error: console.error } });

        assert.equal(kept.removed.length, 0);
        assert.ok(jetpack.read(path.join(targetDir, 'AGENTS.md')).includes('VPN'), 'consumer AGENTS.md content survives');
        assert.ok(warnings.some((m) => m.includes('consumer content')), 'a move-it-to-the-brand-root warning prints');
      },
    },
    {
      name: 'legacy-generated-claude-md-heals-on-both-paths',
      async run({ assert }) {
        // #101: a CLAUDE.md written by the PRE-agent-docs generation carries the
        // framework's own markers and content no current template renders, so it
        // matches neither the rendered `@AGENTS.md` pointer nor its (empty)
        // Custom section. It is still the framework's file: the brand path
        // sweeps it, the standalone path heals it to the pointer.
        const legacy = [
          DEFAULT_MARKER,
          '# OMEGA Backend (@omega.js/backend) — consumer project',
          '',
          '## Framework',
          '',
          'This project consumes **OMEGA Backend** (@omega.js/backend).',
          '',
          CUSTOM_MARKER,
          '- **`node_modules/backend-manager/CLAUDE.md`** — full framework reference',
          '',
          '## Project-specific notes',
          '',
          'Add anything specific to THIS project here. Edits below this line are preserved across `npx omega setup` runs.',
          '',
        ].join('\n');

        // Brand path: swept.
        const brand = makeTmp();
        jetpack.write(path.join(brand, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        const targetDir = path.join(brand, 'targets', 'backend');
        jetpack.write(path.join(targetDir, 'CLAUDE.md'), legacy);

        const swept = scaffoldDefaults({ outputDir: targetDir, logger: quiet });

        assert.ok(swept.removed.includes('CLAUDE.md'), 'the legacy per-target CLAUDE.md is retired, not kept');
        assert.equal(jetpack.exists(path.join(targetDir, 'CLAUDE.md')), false);

        // Standalone path: healed to the one-line pointer, AGENTS.md lands.
        const standalone = makeTmp();
        jetpack.write(path.join(standalone, 'CLAUDE.md'), legacy);

        scaffoldDefaults({ outputDir: standalone, logger: quiet });

        assert.equal(jetpack.read(path.join(standalone, 'CLAUDE.md')).trim(), '@AGENTS.md', 'the stale CLAUDE.md is healed to the pointer');
        assert.ok(jetpack.read(path.join(standalone, 'AGENTS.md')).includes('node_modules/@omega.js/AGENTS.md'), 'AGENTS.md carries the content');
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
