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

        // `_.gitignore` → .gitignore at the target root (src/dist pillar:
        // functions/ is staged output, never scaffolded). No `.env` scaffolds:
        // a target .env is a human-only override; keys live in the brand root
        // .env and every verb composes dist/.env from the cascade (#678).
        const expected = [
          '.gitignore',
          'AGENTS.md',
          'CHANGELOG.md',
          'CLAUDE.md',
          'docs/README.md',
          'test/README.md',
          'test/_helpers/connect-trap.js',
          'test/_init.js',
          'test/_unit/registration.test.js',
          'test/_unit/rules-posture.test.js',
          'test/_unit/socket-free.test.js',
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
        const gi = jetpack.read(path.join(tmp, '.gitignore'));
        assert.ok(gi.includes(DEFAULT_MARKER) && gi.includes(CUSTOM_MARKER), '.gitignore should carry both section markers');
      },
    },
    {
      name: 'static-test-lane-scaffolds-socket-free-with-its-preload-wired',
      async run({ assert }) {
        // #567: every ported brand hand-copied this lane. It ships from the
        // defaults tree now — the connect trap, the three skeleton suites, and
        // the `test` script that preloads the trap into every test process.
        const tmp = makeTmp();
        scaffoldDefaults({ outputDir: tmp, logger: quiet });

        const trap = path.join(tmp, 'test', '_helpers', 'connect-trap.js');
        assert.equal(jetpack.exists(trap), 'file', 'the connect trap is the lane — without it the suite can reach live Firebase');

        // The trap is a PRELOAD: requiring it installs the refusal, and the
        // skeleton asserts the marker it leaves behind.
        const trapSource = jetpack.read(trap);
        assert.ok(trapSource.includes('net.Socket.prototype.connect'), 'the trap must own the one funnel every outbound protocol uses');
        assert.ok(trapSource.includes('dns.lookup'), 'a resolver call is an escape in its own right');

        // Under `_unit/`: the framework runner skips `_`-prefixed paths, so the
        // static lane never runs inside the emulator lane.
        for (const suite of ['registration', 'rules-posture', 'socket-free']) {
          assert.equal(jetpack.exists(path.join(tmp, 'test', '_unit', `${suite}.test.js`)), 'file', `${suite} skeleton missing`);
        }

        // The script `omega setup` writes onto the target manifest. Without the
        // --require the rest of the lane still passes — quietly networked.
        const script = require('../../package.json').projectScripts.test;
        assert.ok(script.includes('--require ./test/_helpers/connect-trap.js'), 'the test script does not preload the trap');
        assert.ok(script.includes("--test 'test/_unit/**/*.test.js'"), 'the test script does not run the static lane');
      },
    },
    {
      name: 'static-lane-skeletons-are-the-consumers-to-edit',
      async run({ assert }) {
        // Copy-if-missing, like every other default: a brand that already has
        // the lane (every hand-ported one does) is left alone.
        const tmp = makeTmp();
        scaffoldDefaults({ outputDir: tmp, logger: quiet });

        const suite = path.join(tmp, 'test', '_unit', 'rules-posture.test.js');
        jetpack.write(suite, '// the brand pinned its own posture here\n');

        const second = scaffoldDefaults({ outputDir: tmp, logger: quiet });

        assert.equal(jetpack.read(suite), '// the brand pinned its own posture here\n', 'a consumer-edited skeleton must never be clobbered');
        assert.equal(second.written.length + second.merged.length, 0, 'nothing rewrites on the second run');
      },
    },
    {
      name: 'remerge-preserves-consumer-values-and-custom-sections',
      async run({ assert }) {
        const tmp = makeTmp();
        scaffoldDefaults({ outputDir: tmp, logger: quiet });

        // Consumer adds their own gitignore line.
        const giPath = path.join(tmp, '.gitignore');
        jetpack.write(giPath, jetpack.read(giPath).replace('# ...', 'my-secret-dir/\n# ...'));

        scaffoldDefaults({ outputDir: tmp, logger: quiet });

        assert.ok(jetpack.read(giPath).includes('my-secret-dir/'), 'custom .gitignore line should survive re-merge');
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
        for (const file of ['.gitignore', 'test/_init.js']) {
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
