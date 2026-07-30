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
  assert.strictEqual(defaultCommand, 'setup', 'OMEGA convention: bare `omega` runs setup');

  for (const name of Object.keys(aliases)) {
    assert.ok(fs.existsSync(path.join(commandsDir, `${name}.js`)), `commands/${name}.js exists`);
  }

  // The full B3 surface is present (+ install — the `mgr i local` parity
  // gap the wizard rehearsal caught, cp194)
  for (const name of ['setup', 'install', 'dev', 'build', 'deploy', 'update', 'translate', 'audit', 'test', 'clean', 'version']) {
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
  for (const file of ['.gitignore', '.env', 'AGENTS.md', 'CLAUDE.md', '.nvmrc', '.github/workflows/build.yml', 'config/omega.json5']) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} scaffolded`);
  }

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
  assert.ok(workflow.includes('npx omega setup && npm run build'), 'CI builds through the omega CLI');
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

  // Consumer customizes below the markers
  fs.appendFileSync(path.join(root, '.env'), 'MY_CUSTOM_KEY="hello"\n');
  fs.appendFileSync(path.join(root, '.gitignore'), '/my-custom-dir\n');

  const second = scaffoldDefaults({ outputDir: root, logger: quiet });
  assert.ok(fs.readFileSync(path.join(root, '.env'), 'utf8').includes('MY_CUSTOM_KEY="hello"'), '.env custom preserved');
  assert.ok(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').includes('/my-custom-dir'), '.gitignore custom preserved');
  assert.strictEqual(second.written.length, 0, 'no rewrites on rerun');

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

test('scaffold: inside a brand monorepo the seed is targets-only and the template never merges in (friction #1)', () => {
  const root = tmpConsumer();
  const appDir = path.join(root, 'brand', 'apps', 'website');
  fs.mkdirSync(path.join(root, 'brand', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: {} } }\n");
  fs.mkdirSync(appDir, { recursive: true });

  scaffoldDefaults({ outputDir: appDir, logger: quiet });

  const seeded = fs.readFileSync(path.join(appDir, 'config', 'omega.json5'), 'utf8');
  assert.ok(!seeded.includes('my-brand'), 'no placeholder identity in a brand app');
  assert.match(seeded, /targets/, 'targets-only seed');

  // Rerun (setup runs repeatedly) — the full template must NOT merge under it
  scaffoldDefaults({ outputDir: appDir, logger: quiet });
  const { config } = loadConfig(appDir, 'web');
  assert.strictEqual(config.brand.id, 'acme', 'brand root identity resolves through the app seed');
  assert.strictEqual(config.brand.name, 'Acme', 'no My Brand shadowing after reruns');
  fs.rmSync(root, { recursive: true, force: true });
});

test('scaffold: setup names the seed mode it detected (#95)', () => {
  const root = tmpConsumer();

  // Standalone: the full template lane
  const standaloneLines = [];
  scaffoldDefaults({ outputDir: root, logger: { ...quiet, log: (m) => standaloneLines.push(m) } });
  const standaloneMode = standaloneLines.filter((m) => /standalone app/.test(m));
  assert.strictEqual(standaloneMode.length, 1, 'exactly one mode line');
  assert.match(standaloneMode[0], /standalone app/, 'names the mode');
  assert.match(standaloneMode[0], /full config template/, 'names the consequence');

  // Brand monorepo: the targets-only lane
  const appDir = path.join(root, 'brand', 'apps', 'website');
  fs.mkdirSync(path.join(root, 'brand', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: {} } }\n");
  fs.mkdirSync(appDir, { recursive: true });

  const brandLines = [];
  scaffoldDefaults({ outputDir: appDir, logger: { ...quiet, log: (m) => brandLines.push(m) } });
  const brandMode = brandLines.filter((m) => /brand monorepo detected/.test(m));
  assert.strictEqual(brandMode.length, 1, 'exactly one mode line');
  assert.match(brandMode[0], /brand monorepo detected/, 'names the mode');
  assert.match(brandMode[0], /targets-only config seed/, 'names the consequence');
  assert.match(brandMode[0], /brand root/, 'says where the docs went');

  fs.rmSync(root, { recursive: true, force: true });
});

test('scaffold: inside a brand monorepo the per-app agent docs never scaffold and framework-owned copies sweep (brand doc unification)', () => {
  const root = tmpConsumer();
  const appDir = path.join(root, 'brand', 'apps', 'website');
  fs.mkdirSync(appDir, { recursive: true });

  // Standalone scaffold first (no brand config yet) — the per-app agent docs land.
  scaffoldDefaults({ outputDir: appDir, logger: quiet });
  assert.ok(fs.existsSync(path.join(appDir, 'AGENTS.md')), 'standalone apps keep the per-app AGENTS.md');
  assert.ok(fs.existsSync(path.join(appDir, 'CLAUDE.md')), 'standalone apps keep the per-app CLAUDE.md pointer');

  // Wrap it in a brand monorepo: the next setup sweeps the untouched copy.
  fs.mkdirSync(path.join(root, 'brand', 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: {} } }\n");
  const swept = scaffoldDefaults({ outputDir: appDir, logger: quiet });
  assert.deepStrictEqual(swept.removed.slice().sort(), ['AGENTS.md', 'CLAUDE.md'], 'framework-owned per-app agent docs are swept');
  assert.ok(!fs.existsSync(path.join(appDir, 'AGENTS.md')), 'the brand root is the doc home');
  assert.ok(!fs.existsSync(path.join(appDir, 'CLAUDE.md')), 'the brand root is the doc home');

  // Rerun never resurrects them.
  scaffoldDefaults({ outputDir: appDir, logger: quiet });
  assert.ok(!fs.existsSync(path.join(appDir, 'AGENTS.md')), 'reruns do not resurrect the per-app doc');
  assert.ok(!fs.existsSync(path.join(appDir, 'CLAUDE.md')), 'reruns do not resurrect the per-app pointer');

  // Consumer content is never destroyed: real notes below the Custom marker keep the file.
  const warnings = [];
  fs.writeFileSync(path.join(appDir, 'AGENTS.md'),
    '# ========== Default Values ==========\nframework guidance\n\n# ========== Custom Values ==========\nOur deploy needs the VPN up.\n');
  const kept = scaffoldDefaults({ outputDir: appDir, logger: { ...quiet, warn: (m) => warnings.push(m) } });
  assert.deepStrictEqual(kept.removed, []);
  assert.match(fs.readFileSync(path.join(appDir, 'AGENTS.md'), 'utf8'), /VPN/, 'consumer content survives');
  assert.ok(warnings.some((m) => m.includes('consumer content')), 'a move-it-to-the-brand-root warning prints');
  fs.rmSync(root, { recursive: true, force: true });
});

test('bin: `omega setup` end-to-end in a fresh consumer (real process, real bin)', () => {
  const root = tmpConsumer();
  execFileSync(process.execPath, [path.join(PKG, 'bin', 'omega'), 'setup'], { cwd: root, stdio: 'pipe' });

  assert.ok(fs.existsSync(path.join(root, 'config', 'omega.json5')), 'config seeded');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts.build, 'omega build', 'scripts synced');
  assert.strictEqual(pkg.scripts.start, 'omega dev', 'start → omega dev');
  fs.rmSync(root, { recursive: true, force: true });
});
