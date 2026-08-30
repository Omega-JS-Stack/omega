/**
 * CLI + scaffolding invariants: the dispatch table maps every alias to a
 * real command file, scaffoldDefaults applies the REAL file map to a temp
 * consumer (rename rules, marker merges, templating, idempotency), the
 * omega.json5 seed passes the real config loader, and the CI template is
 * genuinely Ruby-free. The bin itself is exercised once end-to-end.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const Main = require('../src/cli.js');
const { scaffoldDefaults, FILE_MAP, NODE_VERSION } = require('../src/scaffold.js');
const { loadConfig } = require('@omega.js/config');

const PKG = path.resolve(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {} };

function tmpConsumer() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-cli-'));
}

test('dispatch table: every aliased command has a command file', () => {
  const { commandsDir, aliases, defaultCommand } = Main.config;
  assert.strictEqual(defaultCommand, 'help', 'OMEGA convention: bare `omega` prints help (#675)');

  for (const name of Object.keys(aliases)) {
    assert.ok(fs.existsSync(path.join(commandsDir, `${name}.js`)), `commands/${name}.js exists`);
  }

  // The full B3 surface is present (+ install — the `mgr i local` parity
  // gap the wizard rehearsal caught, cp194)
  for (const name of ['install', 'dev', 'build', 'deploy', 'update', 'translate', 'audit', 'test', 'clean', 'version']) {
    assert.ok(aliases[name], `${name} is routed`);
  }

  // -t = test on EVERY framework (mirrored-implementation rule, wave-6 D6) —
  // translate deliberately carries no single-letter alias.
  assert.ok(aliases.test.includes('-t'), '-t routes to test');
  assert.ok(!aliases.translate.includes('-t'), 'translate has no -t');
});

test('scaffold: files land with rename rules applied, no pages, no Ruby', () => {
  const root = tmpConsumer();
  const result = scaffoldDefaults({ outputDir: root, logger: quiet });

  // `_.` renames + templating
  for (const file of ['.gitignore', 'AGENTS.md', 'CLAUDE.md', '.nvmrc', '.github/workflows/build.yml', 'config/omega.json5']) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} scaffolded`);
  }

  // No `.env` scaffolds ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)):
  // the brand root's .env is the one file humans and the manager edit, a target
  // .env is an optional per-key override a HUMAN writes, and no machine writes one.
  assert.ok(!fs.existsSync(path.join(root, '.env')), 'no target .env is scaffolded');

  // The agent-docs chain (#63): AGENTS.md carries the content, CLAUDE.md is the
  // one-line `@AGENTS.md` pointer.
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /node_modules\/@omega\.js\/AGENTS\.md/, 'AGENTS.md points at the OMEGA map');
  assert.strictEqual(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8').trim(), '@AGENTS.md');
  assert.strictEqual(fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim(), `v${NODE_VERSION}`, '.nvmrc templated');

  // src/ seed dirs exist (via .gitkeep), but NO default pages are copied —
  // the ~60-page default set is virtual, served from the package. The one
  // file there is the example walkthrough (#97), inert by its .txt suffix.
  assert.ok(fs.existsSync(path.join(root, 'src', 'pages')), 'src/pages seeded');
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'src', 'pages')), ['example.md.txt'], 'zero pages copied — only the example walkthrough');

  // Ruby is gone
  assert.ok(!fs.existsSync(path.join(root, 'Gemfile')), 'no Gemfile');
  assert.ok(!fs.existsSync(path.join(root, 'src', '_config.yml')), 'no _config.yml');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'build.yml'), 'utf8');
  assert.ok(!/setup-ruby|bundle install|gem install|RUBY_VERSION|BUNDLER_VERSION/.test(workflow), 'CI workflow has no Ruby steps');
  assert.ok(workflow.includes(`NODE_VERSION: '${NODE_VERSION}'`), 'CI workflow node version templated');
  assert.ok(workflow.includes('${{ secrets.GH_TOKEN }}'), 'GitHub secret syntax survived templating');
  assert.ok(workflow.includes('npm run build'), 'CI builds through the omega CLI (the build verb scaffolds itself — #675)');
  assert.ok(!workflow.includes('omega setup'), 'the retired setup command is gone from CI');
  assert.ok(workflow.includes('publish_dir: ./dist'), 'CI publishes dist/');

  assert.ok(result.written.length >= 6, `first run writes the tree (${result.written.length})`);
  fs.rmSync(root, { recursive: true, force: true });
});

test('scaffold: omega.json5 seed passes the real config loader for target web', () => {
  const root = tmpConsumer();
  scaffoldDefaults({ outputDir: root, logger: quiet });

  const { config, errors, enabled } = loadConfig(root, 'web');
  assert.deepStrictEqual(errors, [], 'seed validates clean');
  assert.strictEqual(enabled, true, 'web target enabled by key presence');
  assert.strictEqual(config.theme.id, 'classy', 'theme seeded');
  fs.rmSync(root, { recursive: true, force: true });
});

test('scaffold: marker merges preserve the Custom section; reruns are idempotent', () => {
  const root = tmpConsumer();
  scaffoldDefaults({ outputDir: root, logger: quiet });

  // Consumer customizes below the markers, and hand-writes a target .env — the
  // optional per-key override that is the only way a target .env exists (#678).
  fs.writeFileSync(path.join(root, '.env'), 'MY_CUSTOM_KEY="hello"\n');
  fs.appendFileSync(path.join(root, '.gitignore'), '/my-custom-dir\n');

  const second = scaffoldDefaults({ outputDir: root, logger: quiet });
  assert.ok(fs.readFileSync(path.join(root, '.env'), 'utf8').includes('MY_CUSTOM_KEY="hello"'), 'the hand-written .env is never touched');
  assert.ok(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').includes('/my-custom-dir'), '.gitignore custom preserved');
  // The CI secrets block is the SCHEMA's set (#627), not this machine's .env:
  // a hand-written key changes nothing, so the rerun rewrites nothing.
  assert.deepStrictEqual(second.written, [], 'a .env key is not a workflow change');
  assert.ok(
    !fs.readFileSync(path.join(root, '.github', 'workflows', 'build.yml'), 'utf8').includes('MY_CUSTOM_KEY'),
    'an undeclared .env key never reaches the workflow env block',
  );

  // omega.json5 stabilizes after one merge cycle: run three, expect the third clean
  scaffoldDefaults({ outputDir: root, logger: quiet });
  const third = scaffoldDefaults({ outputDir: root, logger: quiet });
  assert.strictEqual(third.written.length + third.merged.length, 0, 'fully idempotent');
  fs.rmSync(root, { recursive: true, force: true });
});

test('scaffold: consumer omega.json5 values win the JSON5 merge', () => {
  const root = tmpConsumer();
  scaffoldDefaults({ outputDir: root, logger: quiet });

  const configPath = path.join(root, 'config', 'omega.json5');
  fs.writeFileSync(configPath, fs.readFileSync(configPath, 'utf8').replace("id: 'my-brand'", "id: 'real-brand'"));
  scaffoldDefaults({ outputDir: root, logger: quiet });

  const { config } = loadConfig(root, 'web');
  assert.strictEqual(config.brand.id, 'real-brand', 'consumer value survived the defaults merge');
  fs.rmSync(root, { recursive: true, force: true });
});

test('FILE_MAP: src/ is consumer-owned after seeding', () => {
  assert.strictEqual(FILE_MAP['**/*'].overwrite, false, 'nothing clobbers consumer files by default');
  assert.strictEqual(FILE_MAP['.github/workflows/build.yml'].overwrite, true, 'CI workflow re-syncs every setup');
});

test('scaffold: a brand target gets NO local-level config, a standalone project keeps its seed (#298)', () => {
  const root = tmpConsumer();
  const targetDir = path.join(root, 'brand', 'targets', 'website');
  const targetConfig = path.join(targetDir, 'config', 'omega.json5');
  fs.mkdirSync(path.join(root, 'brand', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: {} } }\n");
  fs.mkdirSync(targetDir, { recursive: true });

  // Fresh scaffold AND the reruns setup does: the local config never appears
  // (the old targets-only seed kept resurrecting a file the target omits).
  scaffoldDefaults({ outputDir: targetDir, logger: quiet });
  assert.ok(!fs.existsSync(targetConfig), 'the brand root config is the config');

  scaffoldDefaults({ outputDir: targetDir, logger: quiet });
  assert.ok(!fs.existsSync(targetConfig), 'a rerun does not re-seed it');

  const { config } = loadConfig(targetDir, 'web');
  assert.strictEqual(config.brand.id, 'acme', 'brand root identity resolves for the target');
  assert.strictEqual(config.brand.name, 'Acme', 'no My Brand shadowing');

  // The local file is the standalone ESCAPE HATCH: authored, it survives setup.
  fs.mkdirSync(path.dirname(targetConfig), { recursive: true });
  fs.writeFileSync(targetConfig, '{ targets: { web: { language: "es" } } }\n');
  scaffoldDefaults({ outputDir: targetDir, logger: quiet });
  assert.strictEqual(fs.readFileSync(targetConfig, 'utf8'), '{ targets: { web: { language: "es" } } }\n', 'an authored local config is never touched');

  // No brand config above → the standalone lane still seeds the full template.
  const standalone = path.join(root, 'standalone');
  fs.mkdirSync(standalone, { recursive: true });
  scaffoldDefaults({ outputDir: standalone, logger: quiet });
  assert.ok(fs.existsSync(path.join(standalone, 'config', 'omega.json5')), 'a standalone project keeps the seed');

  fs.rmSync(root, { recursive: true, force: true });
});

test('scaffold: setup names the seed mode it detected (#95)', () => {
  const root = tmpConsumer();

  // Standalone: the full template lane
  const standaloneLines = [];
  scaffoldDefaults({ outputDir: root, logger: { ...quiet, log: (m) => standaloneLines.push(m) } });
  const standaloneMode = standaloneLines.filter((m) => /standalone project/.test(m));
  assert.strictEqual(standaloneMode.length, 1, 'exactly one mode line');
  assert.match(standaloneMode[0], /standalone project/, 'names the mode');
  assert.match(standaloneMode[0], /full config template/, 'names the consequence');

  // Brand monorepo: the no-target-config lane
  const targetDir = path.join(root, 'brand', 'targets', 'website');
  fs.mkdirSync(path.join(root, 'brand', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: {} } }\n");
  fs.mkdirSync(targetDir, { recursive: true });

  const brandLines = [];
  scaffoldDefaults({ outputDir: targetDir, logger: { ...quiet, log: (m) => brandLines.push(m) } });
  const brandMode = brandLines.filter((m) => /brand monorepo detected/.test(m));
  assert.strictEqual(brandMode.length, 1, 'exactly one mode line');
  assert.match(brandMode[0], /brand monorepo detected/, 'names the mode');
  assert.match(brandMode[0], /no target-level config seed/, 'names the consequence');
  assert.match(brandMode[0], /brand root/, 'says where the docs went');

  fs.rmSync(root, { recursive: true, force: true });
});

test('scaffold: inside a brand monorepo the per-target agent docs never scaffold and framework-owned copies sweep (brand doc unification)', () => {
  const root = tmpConsumer();
  const targetDir = path.join(root, 'brand', 'targets', 'website');
  fs.mkdirSync(targetDir, { recursive: true });

  // Standalone scaffold first (no brand config yet) — the per-target agent docs land.
  scaffoldDefaults({ outputDir: targetDir, logger: quiet });
  assert.ok(fs.existsSync(path.join(targetDir, 'AGENTS.md')), 'standalone projects keep the per-project AGENTS.md');
  assert.ok(fs.existsSync(path.join(targetDir, 'CLAUDE.md')), 'standalone projects keep the per-project CLAUDE.md pointer');

  // Wrap it in a brand monorepo: the next setup sweeps the untouched copy.
  fs.mkdirSync(path.join(root, 'brand', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: {} } }\n");
  const swept = scaffoldDefaults({ outputDir: targetDir, logger: quiet });
  assert.deepStrictEqual(swept.removed.slice().sort(), ['AGENTS.md', 'CLAUDE.md'], 'framework-owned per-target agent docs are swept');
  assert.ok(!fs.existsSync(path.join(targetDir, 'AGENTS.md')), 'the brand root is the doc home');
  assert.ok(!fs.existsSync(path.join(targetDir, 'CLAUDE.md')), 'the brand root is the doc home');

  // Rerun never resurrects them.
  scaffoldDefaults({ outputDir: targetDir, logger: quiet });
  assert.ok(!fs.existsSync(path.join(targetDir, 'AGENTS.md')), 'reruns do not resurrect the per-target doc');
  assert.ok(!fs.existsSync(path.join(targetDir, 'CLAUDE.md')), 'reruns do not resurrect the per-target pointer');

  // Consumer content is never destroyed: real notes below the Custom marker keep the file.
  const warnings = [];
  fs.writeFileSync(path.join(targetDir, 'AGENTS.md'),
    '# ========== Default Values ==========\nframework guidance\n\n# ========== Custom Values ==========\nOur deploy needs the VPN up.\n');
  const kept = scaffoldDefaults({ outputDir: targetDir, logger: { ...quiet, warn: (m) => warnings.push(m) } });
  assert.deepStrictEqual(kept.removed, []);
  assert.match(fs.readFileSync(path.join(targetDir, 'AGENTS.md'), 'utf8'), /VPN/, 'consumer content survives');
  assert.ok(warnings.some((m) => m.includes('consumer content')), 'a move-it-to-the-brand-root warning prints');
  fs.rmSync(root, { recursive: true, force: true });
});

test('scaffold: a brand target scaffolds NO per-target .github/ — its CI composes into the brand root (#265)', () => {
  const root = tmpConsumer();
  const brandRoot = path.join(root, 'brand');
  const targetDir = path.join(brandRoot, 'targets', 'website');
  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: {} } }\n");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, '.env'), 'CLOUDFLARE_TOKEN=cf\n');

  scaffoldDefaults({ outputDir: targetDir, logger: quiet });

  // GitHub runs workflows from the repo root ONLY — a per-target copy is dead.
  assert.ok(!fs.existsSync(path.join(targetDir, '.github')), 'no per-target .github/ in a brand monorepo');

  const composedPath = path.join(brandRoot, '.github', 'workflows', 'website-build.yml');
  assert.ok(fs.existsSync(composedPath), 'the target workflow composed into the brand root');

  const composed = fs.readFileSync(composedPath, 'utf8');
  // The scoping MECHANISM is devkit's (`working-directory`, block or per step);
  // what web owes the brand is that CI runs the target, not the repo root.
  assert.match(composed, /working-directory: targets\/website/, 'run steps execute in the target dir');
  assert.match(composed, /^name: .+ \(targets\/website\)$/m, 'the Actions list tells the targets apart');
  assert.match(composed, /^ {2}group: website-\$\{\{ github\.ref \}\}$/m, 'per-target concurrency — one target never cancels another');

  // The scaffold's own token pass still ran: node version + the .env secrets block.
  assert.ok(composed.includes(`NODE_VERSION: '${NODE_VERSION}'`), 'the node version templated');
  assert.ok(composed.includes('OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}'), "the schema's web delivery set reached the composed env block");
  assert.ok(!composed.includes('{{ githubSecrets }}'), 'no unrendered token survives');

  // Idempotent: a setup rerun rewrites that one file and never adds another.
  scaffoldDefaults({ outputDir: targetDir, logger: quiet });
  assert.deepStrictEqual(fs.readdirSync(path.join(brandRoot, '.github', 'workflows')), ['website-build.yml'], 'one file per app, rerun-stable');
  assert.strictEqual(fs.readFileSync(composedPath, 'utf8'), composed, 'the rerun composed the same bytes');

  fs.rmSync(root, { recursive: true, force: true });
});

test('bin: a bare `omega` prints help and scaffolds nothing (real process, real bin — #675)', () => {
  const root = tmpConsumer();
  const out = execFileSync(process.execPath, [path.join(PKG, 'bin', 'omega')], { cwd: root, encoding: 'utf8' });

  assert.match(out, /Usage: omega <command>/, 'a bare invocation prints help');
  assert.ok(!/^ {2}setup\b/m.test(out), 'setup is not in the command list');
  assert.ok(!fs.existsSync(path.join(root, 'config', 'omega.json5')), 'help is inert — nothing is scaffolded');
  fs.rmSync(root, { recursive: true, force: true });
});
