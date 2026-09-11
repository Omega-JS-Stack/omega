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
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// The engine logs per-file by default; tests only want failures surfaced.
const quiet = { log() {}, warn: console.warn, error: console.error };

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'backend-defaults-'));
}

module.exports = defineCases({
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
          '.github/workflows/deploy.yml',
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
      // #872: the backend deploy runs on a runner now, so the workflow it
      // dispatches has to REBUILD everything a laptop reads off the brand:
      // the target's .env and the service-account key. Both are generated from
      // the env schema, so a key added there reaches CI with no workflow edit.
      name: 'deploy-workflow-rebuilds-the-env-and-the-key-the-runner-lacks',
      async run({ assert }) {
        const tmp = makeTmp();
        scaffoldDefaults({ outputDir: tmp, logger: quiet });

        const workflow = jetpack.read(path.join(tmp, '.github', 'workflows', 'deploy.yml'));

        // No token survives the render (an unrendered one is not a missing
        // step, it is a file GitHub refuses to parse). `${{ secrets.X }}` is
        // GitHub's own syntax and is left alone by the tolerant renderer.
        for (const token of ['{{ versions.node }}', '{{ githubSecrets }}', '{{ envFileKeys }}', '{{ installFirewall }}']) {
          assert.equal(workflow.includes(token), false, `${token} was left unrendered`);
        }

        // The firewall step is the pinned action, rendered from devkit's ONE
        // declaration, and the install it wraps runs through it.
        assert.ok(/uses: SocketDev\/action@v\d+\.\d+\.\d+/.test(workflow), 'the pinned firewall action is rendered');
        assert.ok(workflow.includes('sfw npm install'), 'the install runs behind the firewall');

        // Every key the schema delivers to backend arrives in the runner env,
        // and the `env` half is the list the .env writer reads back out of it.
        const { workflowSecretKeys, envFileKeys, renderEnvFileKeys } = require('../../dist/vendor/config/env-delivery.js');
        for (const key of workflowSecretKeys('backend')) {
          assert.ok(workflow.includes(`${key}: \${{ secrets.${key} }}`), `${key} must reach the runner env`);
        }
        assert.ok(workflow.includes(renderEnvFileKeys('backend')), 'the writer carries the generated key list, verbatim JSON');
        for (const key of envFileKeys('backend')) {
          assert.ok(workflow.includes(`"${key}"`), `${key} must be written into the target .env`);
        }

        // The VALUES never touch a shell: node writes the file through the
        // config serializer, so a secret carrying a newline cannot split its
        // line or inject a key (the heredoc this replaced did, #872).
        assert.ok(workflow.includes('serializeEnv'), 'the .env is written through the config serializer');
        assert.equal(/cat > \.env/.test(workflow), false, 'no heredoc pastes a secret into the shell');

        // The license key is delivered to backend as well now, so the runner's
        // own deploy resolves a verdict instead of stamping every CI deploy
        // keyless, and it is never a line in the .env the artifact ships with.
        assert.ok(workflow.includes('OMEGA_LICENSE_KEY: ${{ secrets.OMEGA_LICENSE_KEY }}'), 'the runner carries the license key for the check');
        assert.equal(envFileKeys('backend').includes('OMEGA_LICENSE_KEY'), false, 'and the writer never puts it in the artifact .env');

        // The deploy credential becomes a FILE, and both clients authenticate
        // with it: firebase through the env var, gcloud (the public-invoker
        // fix) through its own activated account.
        assert.ok(workflow.includes('> service-account.json'), 'the service-account JSON is written back to disk');
        assert.ok(workflow.includes('GOOGLE_APPLICATION_CREDENTIALS='), 'firebase deploy authenticates through the written key');
        assert.ok(workflow.includes('gcloud auth activate-service-account --key-file'), 'gcloud ignores GOOGLE_APPLICATION_CREDENTIALS, so the runner activates the account');
        assert.ok(workflow.includes('npx --no-install omega-backend deploy --direct'), 'the runner runs this framework verb, never a second deploy path');

        // The install has to carry the DEV dependencies too (#872): a brand's
        // own @omega.js/manager and the frameworks it declares as devDeps are
        // what link the bins this job runs, and npm skips every one of them
        // under NODE_ENV=production. The first playground run installed
        // nothing but the two runtime frameworks and then hung 30 minutes on a
        // bin that did not exist.
        assert.equal(/^\s*NODE_ENV:/m.test(workflow), false, 'NODE_ENV in the job env makes the install skip devDependencies');

        // And no `npx` STEP here may reach the registry: a missing bin under a
        // bare `npx omega` is a stranger's package, run with every secret in
        // env. (Comments are allowed to name the shape they warn about.)
        const steps = workflow.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
        for (const [, invocation] of steps.matchAll(/\bnpx\s+(\S+)/g)) {
          assert.equal(invocation, '--no-install', `npx ${invocation} can install from the registry`);
        }
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

        // CI (#265/#872): GitHub runs workflows from the REPO ROOT only, so the
        // target gets none of its own and the brand root gets the composed one,
        // every post-checkout run step scoped to this target's path.
        assert.equal(jetpack.exists(path.join(targetDir, '.github', 'workflows', 'deploy.yml')), false, 'a brand target scaffolds no per-target CI');
        const composed = jetpack.read(path.join(tmp, '.github', 'workflows', 'backend-deploy.yml'));
        assert.ok(composed, 'the brand root carries the composed workflow');
        assert.ok(composed.includes('working-directory: targets/backend'), 'every run step executes in the target dir');
        assert.ok(composed.includes('npx --no-install omega-backend deploy --direct'), 'the runner runs the framework verb itself');
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
});
