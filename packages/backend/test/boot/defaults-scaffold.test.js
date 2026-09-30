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
          'docs/README.md',
          'test/README.md',
          'test/_init.js',
          'test/unit/registration.test.js',
          'test/unit/rules-posture.test.js',
          'test/unit/socket-free.test.js',
        ];
        assert.deepEqual(result.written.slice().sort(), expected);

        for (const file of expected) {
          assert.equal(jetpack.exists(path.join(tmp, file)), 'file', `${file} should exist`);
        }

        // A standalone project root gets the same AGENTS.md a brand root does:
        // the manager import under Default, its own notes under Custom. Claude
        // Code reads AGENTS.md natively, so no CLAUDE.md scaffolds beside it.
        assert.equal(jetpack.read(path.join(tmp, 'AGENTS.md')), '<!-- ========== Default Values ========== -->\n@node_modules/@omega.js/manager/AGENTS.md\n\n<!-- ========== Custom Values ========== -->\n');
        assert.equal(jetpack.exists(path.join(tmp, 'CLAUDE.md')), false, 'a fresh scaffold writes no CLAUDE.md');

        // Marker files ship with the protocol sections intact.
        const gi = jetpack.read(path.join(tmp, '.gitignore'));
        assert.ok(gi.includes(DEFAULT_MARKER) && gi.includes(CUSTOM_MARKER), '.gitignore should carry both section markers');
      },
    },
    {
      name: 'unit-suites-scaffold-where-the-runner-discovers-them-and-the-trap-is-framework-code',
      async run({ assert }) {
        // The unit suites are runner case files under test/unit/, which the
        // runner discovers like any other suite. The connect trap is the
        // runner's own guard, so no helper and no preload script ships.
        const tmp = makeTmp();
        scaffoldDefaults({ outputDir: tmp, logger: quiet });

        for (const suite of ['registration', 'rules-posture', 'socket-free']) {
          const file = path.join(tmp, 'test', 'unit', `${suite}.test.js`);
          assert.equal(jetpack.exists(file), 'file', `${suite} skeleton missing`);
          assert.equal(/node:test/.test(jetpack.read(file)), false, `${suite} is a runner case file, not a node:test one`);
        }
        for (const retired of ['_unit', '_helpers', 'helpers']) {
          assert.equal(jetpack.exists(path.join(tmp, 'test', retired)), false, `test/${retired}/ is no longer scaffolded`);
        }

        const trap = require('../../dist/test/connect-trap.js');
        assert.equal(typeof trap.install, 'function', 'the runner installs the trap from the framework');
        const manifest = require('../../package.json');
        assert.equal((manifest.projectScripts || {})['test:static'], undefined, 'no static lane script: `omega test` is the one entry');
      },
    },
    {
      name: 'unit-skeletons-are-the-consumers-to-edit',
      async run({ assert }) {
        // Copy-if-missing, like every other default: a brand that already has
        // the lane (every hand-ported one does) is left alone.
        const tmp = makeTmp();
        scaffoldDefaults({ outputDir: tmp, logger: quiet });

        const suite = path.join(tmp, 'test', 'unit', 'rules-posture.test.js');
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
        for (const token of ['{{ versions.node }}', '{{ githubSecrets }}', '{{ envFileKeys }}', '{{ installFirewall }}', '{{ installWorkspace }}']) {
          assert.equal(workflow.includes(token), false, `${token} was left unrendered`);
        }

        // The firewall step is the pinned action, rendered from devkit's ONE
        // declaration, and the install it wraps runs through it.
        assert.ok(/uses: SocketDev\/action@v\d+\.\d+\.\d+/.test(workflow), 'the pinned firewall action is rendered');
        assert.ok(workflow.includes('sfw npm ci'), 'the install runs behind the firewall, as `npm ci` (#938)');

        // A STANDALONE target is its own repo root and declares no workspaces,
        // so the workspace flag a composed brand job carries renders to nothing
        // here ([#898](https://github.com/Omega-JS-Stack/omega/issues/898)).
        assert.equal(workflow.includes('--workspace'), false, 'a standalone install names a workspace that does not exist');

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
        assert.ok(workflow.includes('node "${{ github.workspace }}/node_modules/@omega.js/backend/bin/omega" deploy --direct'), 'the runner runs this framework verb by path, never a second deploy path');

        // The install has to carry the DEV dependencies too (#872): a brand's
        // own @omega.js/manager and the frameworks it declares as devDeps are
        // what link the bins this job runs, and npm skips every one of them
        // under NODE_ENV=production. The first playground run installed
        // nothing but the two runtime frameworks and then hung 30 minutes on a
        // bin that did not exist.
        assert.equal(/^\s*NODE_ENV:/m.test(workflow), false, 'NODE_ENV in the job env makes the install skip devDependencies');

        // And no STEP here runs `npx` at all ([#877](https://github.com/Omega-JS-Stack/omega/issues/877)):
        // a missing bin under a bare `npx omega` is a stranger's package, run
        // with every secret in env, so the workflow resolves no bin NAME and
        // runs the framework's own file instead. (Comments are allowed to name
        // the shape they warn about.)
        const steps = workflow.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
        assert.equal(/\bnpx\b/.test(steps), false, 'a step runs npx, which can reach the registry');
        assert.equal(/\bomega-backend\b/.test(steps), false, 'a step names the removed per-framework bin');
      },
    },
    {
      // #876 + #835: two kinds of key the SCHEMA cannot name reach the runner
      // through the brand's composed production .env, and both halves of the
      // workflow (the injected block and the .env writer's key list) render
      // from that one set.
      name: 'deploy-workflow-carries-the-connections-family-and-the-consumers-own-keys',
      async run({ assert }) {
        const tmp = makeTmp();
        // A brand root with a backend target, so the composer reads the brand
        // .env the way a real verb does.
        jetpack.write(path.join(tmp, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        jetpack.write(path.join(tmp, '.env'), [
          'CONNECTIONS_GITHUB_CLIENT_ID="gh-client-id"',
          'ACME_WEBHOOK_KEY="acme-webhook"',
          'OMEGA_FONTAWESOME_ROOT="/Users/someone/fa"',
          '',
        ].join('\n'));
        jetpack.write(path.join(tmp, '.env.production'), 'CONNECTIONS_GITHUB_CLIENT_SECRET="gh-client-secret"\n');

        const targetDir = path.join(tmp, 'targets', 'backend');
        jetpack.dir(targetDir);
        scaffoldDefaults({ outputDir: targetDir, logger: quiet });

        // A brand target's workflow composes to the BRAND ROOT, scoped to this
        // target's path (#265).
        const workflow = jetpack.read(path.join(tmp, '.github', 'workflows', 'backend-deploy.yml'));

        for (const key of ['CONNECTIONS_GITHUB_CLIENT_ID', 'CONNECTIONS_GITHUB_CLIENT_SECRET', 'ACME_WEBHOOK_KEY']) {
          assert.ok(workflow.includes(`${key}: \${{ secrets.${key} }}`), `${key} must reach the runner env`);
          assert.ok(workflow.includes(`"${key}"`), `${key} must be written into the target .env`);
        }

        // The machine-local path never leaves the laptop (#454), and no VALUE
        // is ever rendered into a workflow.
        assert.equal(workflow.includes('OMEGA_FONTAWESOME_ROOT'), false, 'a machine-local key must never reach CI');
        for (const value of ['gh-client-id', 'gh-client-secret', 'acme-webhook']) {
          assert.equal(workflow.includes(value), false, 'a workflow carries key NAMES, never values');
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
        jetpack.append(giPath, 'my-secret-dir/\n');

        scaffoldDefaults({ outputDir: tmp, logger: quiet });

        assert.ok(jetpack.read(giPath).includes('my-secret-dir/'), 'custom .gitignore line should survive re-merge');
      },
    },
    {
      name: 'an-old-template-agents-md-converges-keeping-the-consumer-notes',
      async run({ assert }) {
        // The retired per-framework template: its framework section goes, the
        // notes below its Custom marker stay under the import, loudly.
        const tmp = makeTmp();
        jetpack.write(path.join(tmp, 'AGENTS.md'),
          `${DEFAULT_MARKER}\n# OMEGA Backend consumer project\nframework guidance\n\n${CUSTOM_MARKER}\n\n## Project-specific notes\n\nAdd anything specific to THIS project here. Edits below this line are preserved across runs.\n\nOur deploy needs the VPN up.\n`);
        const warnings = [];
        const result = scaffoldDefaults({ outputDir: tmp, logger: { log() {}, warn: (m) => warnings.push(m), error: console.error } });

        assert.equal(jetpack.read(path.join(tmp, 'AGENTS.md')), '<!-- ========== Default Values ========== -->\n@node_modules/@omega.js/manager/AGENTS.md\n\n<!-- ========== Custom Values ========== -->\nOur deploy needs the VPN up.\n');
        assert.ok(result.merged.includes('AGENTS.md'));
        assert.ok(warnings.some((m) => m.includes('Converged AGENTS.md')), 'the convergence is loud');
      },
    },
    {
      name: 'brand-context-skips-per-target-docs',
      async run({ assert }) {
        // Brand doc unification: inside a brand monorepo the brand root is the
        // one doc home: AGENTS.md/CHANGELOG.md/docs/ never scaffold, and no
        // CLAUDE.md scaffolds anywhere.
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
        assert.ok(composed.includes('node "${{ github.workspace }}/node_modules/@omega.js/backend/bin/omega" deploy --direct'), 'the runner runs the framework verb itself, by path');

        // …and installs only this target's workspace, so the runner's node
        // never installs another target's engines pin ([#898](https://github.com/Omega-JS-Stack/omega/issues/898)).
        assert.ok(composed.includes('sfw npm ci --workspace .'), 'the composed job installs only this target, as `npm ci` (#938)');
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

        assert.deepEqual(swept.removed.slice().sort(), ['AGENTS.md', 'CHANGELOG.md', 'docs/README.md']);
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
      name: 'an-existing-claude-md-is-never-touched-on-either-path',
      async run({ assert }) {
        // The framework holds no opinion on CLAUDE.md: a scaffold neither writes,
        // heals nor sweeps one, in a brand target or a standalone project.
        const content = '# Notes\n\nOur deploy needs the VPN up.\n';

        const brand = makeTmp();
        jetpack.write(path.join(brand, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme' } }\n");
        const targetDir = path.join(brand, 'targets', 'backend');
        jetpack.write(path.join(targetDir, 'CLAUDE.md'), content);

        const swept = scaffoldDefaults({ outputDir: targetDir, logger: quiet });

        assert.equal(swept.removed.includes('CLAUDE.md'), false);
        assert.equal(jetpack.read(path.join(targetDir, 'CLAUDE.md')), content);

        const standalone = makeTmp();
        jetpack.write(path.join(standalone, 'CLAUDE.md'), content);

        scaffoldDefaults({ outputDir: standalone, logger: quiet });

        assert.equal(jetpack.read(path.join(standalone, 'CLAUDE.md')), content);
        assert.ok(jetpack.read(path.join(standalone, 'AGENTS.md')).includes('node_modules/@omega.js/manager/AGENTS.md'), 'AGENTS.md carries the content');
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
