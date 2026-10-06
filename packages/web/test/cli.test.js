/**
 * CLI + scaffolding invariants: the dispatch table maps every alias to a
 * real command file, scaffoldDefaults applies the REAL file map to a temp
 * consumer (rename rules, marker merges, templating, idempotency), the
 * omega.json5 seed passes the real config loader, and the CI template is
 * genuinely Ruby-free. The bin itself is exercised once end-to-end.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const defineCases = require('@omega.js/devkit/test/define-cases');

const Main = require('../src/cli.js');
const { scaffoldDefaults, FILE_MAP, NODE_VERSION } = require('../src/scaffold.js');
const { loadConfig } = require('@omega.js/config');

const PKG = path.resolve(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {} };

function tmpConsumer() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-cli-'));
}

module.exports = defineCases({
  type: 'group',
  description: 'cli',
  tests: [
    {
      name: 'the value-LESS flags are declared, so none of them eats the next token (#920)',
      run: (ctx) => {
        const { BOOLEAN_FLAGS } = require('../src/cli-run.js');
        const { parseArgv } = require('@omega.js/devkit/argv');
        const parse = (args) => parseArgv(args, { booleans: BOOLEAN_FLAGS });

        for (const flag of ['dry-run', 'major', 'force-fresh', 'https']) {
          ctx.expect(BOOLEAN_FLAGS.includes(flag), `--${flag} takes no value, so it must be declared boolean`).toBeTruthy();
        }

        // The pin: the flag is true and the positional survives.
        const argv = parse(['update', '--dry-run', 'extra']);
        ctx.expect(argv.dryRun).toBe(true);
        ctx.expect(argv._).toEqual(['update', 'extra']);

        // --https is the negation lane the dev server reads (`options.https !== false`).
        ctx.expect(parse(['dev', '--no-https']).https).toBe(false);

        // A value flag needs no declaration at all: the audit gates keep their numbers.
        ctx.expect(parse(['audit', '--max-lcp', '1300']).maxLcp).toBe('1300');
      },
    },

    {
      name: 'update: --dry-run reaches devkit runUpdate as dryRun, and a bare run installs',
      run: async (ctx) => {
        const devkitUpdate = require('@omega.js/devkit/update');
        const { BOOLEAN_FLAGS } = require('../src/cli-run.js');
        const { parseArgv } = require('@omega.js/devkit/argv');
        const commandFile = require.resolve('../src/commands/update.js');

        // The command destructures runUpdate at load, so the stub lands before a fresh require
        async function run(args) {
          const original = devkitUpdate.runUpdate;
          const seen = [];
          devkitUpdate.runUpdate = async (options) => { seen.push(options); };
          delete require.cache[commandFile];
          try {
            await require(commandFile)(parseArgv(args, { booleans: BOOLEAN_FLAGS }));
          } finally {
            devkitUpdate.runUpdate = original;
            delete require.cache[commandFile];
          }
          ctx.expect(seen.length, 'the command called runUpdate once').toBe(1);
          return seen[0];
        }

        ctx.expect((await run(['update', '--dry-run'])).dryRun).toBe(true);
        ctx.expect(!(await run(['update'])).dryRun, 'a bare run is not a dry run').toBeTruthy();
      },
    },

    {
      name: 'dispatch table: every aliased command has a command file',
      run: (ctx) => {
        const { commandsDir, aliases, defaultCommand } = Main.config;
        ctx.expect(defaultCommand, 'OMEGA convention: bare `omega` prints help (#675)').toBe('help');

        for (const name of Object.keys(aliases)) {
          ctx.expect(fs.existsSync(path.join(commandsDir, `${name}.js`)), `commands/${name}.js exists`).toBeTruthy();
        }

        // The full B3 surface is present; the link flip (`omega i`) is the brand root's, never a target's
        for (const name of ['dev', 'build', 'deploy', 'update', 'translate', 'audit', 'test', 'clean', 'version']) {
          ctx.expect(aliases[name], `${name} is routed`).toBeTruthy();
        }

        // -t = test on EVERY framework (mirrored-implementation rule, wave-6 D6) —
        // translate deliberately carries no single-letter alias.
        ctx.expect(aliases.test.includes('-t'), '-t routes to test').toBeTruthy();
        ctx.expect(!aliases.translate.includes('-t'), 'translate has no -t').toBeTruthy();
      },
    },

    {
      name: 'scaffold: files land with rename rules applied, no pages, no Ruby',
      run: (ctx) => {
        const root = tmpConsumer();
        const result = scaffoldDefaults({ outputDir: root, logger: quiet });

        // `_.` renames + templating
        for (const file of ['.gitignore', 'AGENTS.md', '.nvmrc', '.github/workflows/build.yml', 'config/omega.json5']) {
          ctx.expect(fs.existsSync(path.join(root, file)), `${file} scaffolded`).toBeTruthy();
        }

        // No `.env` scaffolds ([#678](https://github.com/Omega-JS-Stack/omega/issues/678)):
        // the brand root's .env is the one file humans and the manager edit, a target
        // .env is an optional per-key override a HUMAN writes, and no machine writes one.
        ctx.expect(!fs.existsSync(path.join(root, '.env')), 'no target .env is scaffolded').toBeTruthy();

        // A standalone project root gets the same AGENTS.md a brand root does: the
        // manager import under Default, its own notes under Custom. Claude Code reads AGENTS.md
        // natively, so no CLAUDE.md scaffolds beside it.
        ctx.expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), 'no generated heading').toBe('<!-- ========== Default Values ========== -->\n@node_modules/@omega.js/manager/AGENTS.md\n\n<!-- ========== Custom Values ========== -->\n');
        ctx.expect(result.written.filter((file) => file === 'AGENTS.md'), 'the write is recorded').toEqual(['AGENTS.md']);
        ctx.expect(!fs.existsSync(path.join(root, 'CLAUDE.md')), 'a fresh scaffold writes no CLAUDE.md').toBeTruthy();
        ctx.expect(fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim(), '.nvmrc templated').toBe(`v${NODE_VERSION}`);

        // src/ seed dirs exist (via .gitkeep), but NO default pages are copied —
        // the ~60-page default set is virtual, served from the package. The one
        // file there is the example walkthrough (#97), inert by its .txt suffix.
        ctx.expect(fs.existsSync(path.join(root, 'src', 'pages')), 'src/pages seeded').toBeTruthy();
        ctx.expect(fs.readdirSync(path.join(root, 'src', 'pages')), 'zero pages copied — only the example walkthrough').toEqual(['example.md.txt']);

        // Ruby is gone
        ctx.expect(!fs.existsSync(path.join(root, 'Gemfile')), 'no Gemfile').toBeTruthy();
        ctx.expect(!fs.existsSync(path.join(root, 'src', '_config.yml')), 'no _config.yml').toBeTruthy();
        const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'build.yml'), 'utf8');
        ctx.expect(!/setup-ruby|bundle install|gem install|RUBY_VERSION|BUNDLER_VERSION/.test(workflow), 'CI workflow has no Ruby steps').toBeTruthy();
        ctx.expect(workflow.includes(`NODE_VERSION: '${NODE_VERSION}'`), 'CI workflow node version templated').toBeTruthy();
        ctx.expect(workflow.includes('${{ secrets.GH_TOKEN }}'), 'GitHub secret syntax survived templating').toBeTruthy();
        ctx.expect(workflow.includes('@omega.js/web/bin/omega" deploy --direct'), 'CI builds AND publishes through the framework verb (#883), run by its own bin file (#877): one implementation for both lanes').toBeTruthy();
        ctx.expect(!workflow.includes('--workspace'), 'a standalone target declares no workspaces, so its install names none (#898)').toBeTruthy();
        ctx.expect(!workflow.includes('omega setup'), 'the retired setup command is gone from CI').toBeTruthy();

        ctx.expect(result.written.length >= 6, `first run writes the tree (${result.written.length})`).toBeTruthy();
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'scaffold: omega.json5 seed passes the real config loader for target web',
      run: (ctx) => {
        const root = tmpConsumer();
        scaffoldDefaults({ outputDir: root, logger: quiet });

        const { config, errors, enabled } = loadConfig(root, 'web');
        ctx.expect(errors, 'seed validates clean').toEqual([]);
        ctx.expect(enabled, 'web target enabled by key presence').toBe(true);
        ctx.expect(config.theme.id, 'theme seeded').toBe('classy');
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'scaffold: marker merges preserve the Custom section; reruns are idempotent',
      run: (ctx) => {
        const root = tmpConsumer();
        scaffoldDefaults({ outputDir: root, logger: quiet });

        // Consumer customizes below the markers, and hand-writes a target .env — the
        // optional per-key override that is the only way a target .env exists (#678).
        fs.writeFileSync(path.join(root, '.env'), 'MY_CUSTOM_KEY="hello"\n');
        fs.appendFileSync(path.join(root, '.gitignore'), '/my-custom-dir\n');
        fs.appendFileSync(path.join(root, '.gitattributes'), '*.psd binary\n');

        const second = scaffoldDefaults({ outputDir: root, logger: quiet });
        ctx.expect(fs.readFileSync(path.join(root, '.env'), 'utf8').includes('MY_CUSTOM_KEY="hello"'), 'the hand-written .env is never touched').toBeTruthy();
        ctx.expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').includes('/my-custom-dir'), '.gitignore custom preserved').toBeTruthy();
        ctx.expect(fs.readFileSync(path.join(root, '.gitattributes'), 'utf8').endsWith('# ========== Custom Values ==========\n*.psd binary\n'), '.gitattributes custom preserved').toBeTruthy();
        // The CI secrets block is the schema's set PLUS what only the composed .env
        // can name (#835): a key the schema never declared is the consumer's own,
        // their workflow step is the only thing that reads it, and it used to fail
        // silently. So the rerun rewrites exactly the workflow, with the key NAME.
        ctx.expect(second.written, 'a new .env key re-renders the block, and nothing else').toEqual(['.github/workflows/build.yml']);
        ctx.expect(fs.readFileSync(path.join(root, '.github', 'workflows', 'build.yml'), 'utf8').includes('MY_CUSTOM_KEY: ${{ secrets.MY_CUSTOM_KEY }}'), "a key the schema does not know is the consumer's own and reaches the workflow env block").toBeTruthy();
        ctx.expect(!fs.readFileSync(path.join(root, '.github', 'workflows', 'build.yml'), 'utf8').includes('hello'), 'the block carries key NAMES, never a value').toBeTruthy();

        // omega.json5 stabilizes after one merge cycle: run three, expect the third clean
        scaffoldDefaults({ outputDir: root, logger: quiet });
        const third = scaffoldDefaults({ outputDir: root, logger: quiet });
        ctx.expect(third.written.length + third.merged.length, 'fully idempotent').toBe(0);
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'scaffold: test/ gets the README and the _init.js hook; the README heals its framework section, the Custom section stays',
      run: (ctx) => {
        const root = tmpConsumer();
        scaffoldDefaults({ outputDir: root, logger: quiet });

        const readme = path.join(root, 'test', 'README.md');
        const init = path.join(root, 'test', '_init.js');
        const fresh = fs.readFileSync(readme, 'utf8');
        ctx.expect(fresh.startsWith('<!-- ========== Default Values ========== -->\n# Project tests\n'), 'the README opens on the Default marker').toBeTruthy();
        ctx.expect(fresh.endsWith('<!-- ========== Custom Values ========== -->\n'), 'and closes on the Custom one').toBeTruthy();
        ctx.expect(fresh, 'it names the build layer').toMatch(/\| `test\/build\/` \|/);
        ctx.expect(fresh, 'and the pages layer').toMatch(/\| `test\/pages\/` \|/);
        ctx.expect(typeof require(init), 'the _init.js hook exports the (ctx) => ({ setup }) factory').toBe('function');

        // The framework owns the README's Default section; the project owns Custom
        // and the whole _init.js, so a rerun heals the one and keeps the others.
        const custom = "## This project's suites\n\n- `build/home.test.js`: our home page.\n";
        fs.writeFileSync(readme, `<!-- ========== Default Values ========== -->\n# Project tests\n\nAn older framework text.\n\n<!-- ========== Custom Values ========== -->\n${custom}`);
        fs.writeFileSync(init, 'module.exports = () => ({ async setup() { /* ours */ } });\n');
        scaffoldDefaults({ outputDir: root, logger: quiet });

        ctx.expect(fs.readFileSync(readme, 'utf8')).toBe(`${fresh}${custom}`);
        ctx.expect(fs.readFileSync(init, 'utf8'), 'the project\'s _init.js is never overwritten').toBe('module.exports = () => ({ async setup() { /* ours */ } });\n');
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'scaffold: a pre-marker .gitattributes and the old .gitignore boilerplate converge, consumer lines kept',
      run: (ctx) => {
        const root = tmpConsumer();
        const scaffoldDir = path.join(__dirname, '..', 'scaffold');
        const template = fs.readFileSync(path.join(scaffoldDir, '_.gitignore'), 'utf8');
        const withCustom = (custom) => template.replace(/# ========== Custom Values ==========\n$/, `# ========== Custom Values ==========\n${custom}`);
        const oldAttributes = fs.readFileSync(path.join(scaffoldDir, '_.gitattributes'), 'utf8')
          .split('\n').filter((line) => !line.includes('==========')).join('\n').trim();
        fs.writeFileSync(path.join(root, '.gitattributes'), `${oldAttributes}\n*.psd binary\n`);
        fs.writeFileSync(path.join(root, '.gitignore'), withCustom('# Add your custom ignore patterns below this line\n# ...\n'));

        scaffoldDefaults({ outputDir: root, logger: quiet });

        const attributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
        ctx.expect(attributes, 'the framework line under Default, the consumer line under Custom').toBe(`${fs.readFileSync(path.join(scaffoldDir, '_.gitattributes'), 'utf8')}*.psd binary\n`);
        ctx.expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'a Custom section of only the shipped boilerplate strips to its marker').toBe(template);

        const mixed = withCustom('# Add your custom ignore patterns below this line\n# ...\n/my-custom-dir\n');
        fs.writeFileSync(path.join(root, '.gitignore'), mixed);
        scaffoldDefaults({ outputDir: root, logger: quiet });
        ctx.expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), 'a Custom section carrying a consumer line stays verbatim').toBe(mixed);

        const again = scaffoldDefaults({ outputDir: root, logger: quiet });
        ctx.expect(again.merged.filter((file) => file.startsWith('.git')), 'a second run writes neither file').toEqual([]);
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'scaffold: consumer omega.json5 values win the JSON5 merge',
      run: (ctx) => {
        const root = tmpConsumer();
        scaffoldDefaults({ outputDir: root, logger: quiet });

        const configPath = path.join(root, 'config', 'omega.json5');
        fs.writeFileSync(configPath, fs.readFileSync(configPath, 'utf8').replace("id: 'my-brand'", "id: 'real-brand'"));
        scaffoldDefaults({ outputDir: root, logger: quiet });

        const { config } = loadConfig(root, 'web');
        ctx.expect(config.brand.id, 'consumer value survived the defaults merge').toBe('real-brand');
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'FILE_MAP: src/ is consumer-owned after seeding',
      run: (ctx) => {
        ctx.expect(FILE_MAP['**/*'].overwrite, 'nothing clobbers consumer files by default').toBe(false);
        ctx.expect(FILE_MAP['.github/workflows/build.yml'].overwrite, 'CI workflow re-syncs every setup').toBe(true);
      },
    },

    {
      name: 'scaffold: a brand target gets NO local-level config, a standalone project keeps its seed (#298)',
      run: (ctx) => {
        const root = tmpConsumer();
        const targetDir = path.join(root, 'brand', 'targets', 'web');
        const targetConfig = path.join(targetDir, 'config', 'omega.json5');
        fs.mkdirSync(path.join(root, 'brand', 'config'), { recursive: true });
        fs.writeFileSync(path.join(root, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: { type: 'web' } } }\n");
        fs.mkdirSync(targetDir, { recursive: true });

        // Fresh scaffold AND the reruns setup does: the local config never appears
        // (the old targets-only seed kept resurrecting a file the target omits).
        scaffoldDefaults({ outputDir: targetDir, logger: quiet });
        ctx.expect(!fs.existsSync(targetConfig), 'the brand root config is the config').toBeTruthy();

        scaffoldDefaults({ outputDir: targetDir, logger: quiet });
        ctx.expect(!fs.existsSync(targetConfig), 'a rerun does not re-seed it').toBeTruthy();

        const { config } = loadConfig(targetDir, 'web');
        ctx.expect(config.brand.id, 'brand root identity resolves for the target').toBe('acme');
        ctx.expect(config.brand.name, 'no My Brand shadowing').toBe('Acme');

        // The local file is the standalone ESCAPE HATCH: authored, it survives setup.
        fs.mkdirSync(path.dirname(targetConfig), { recursive: true });
        fs.writeFileSync(targetConfig, '{ targets: { web: { language: "es" } } }\n');
        scaffoldDefaults({ outputDir: targetDir, logger: quiet });
        ctx.expect(fs.readFileSync(targetConfig, 'utf8'), 'an authored local config is never touched').toBe('{ targets: { web: { language: "es" } } }\n');

        // No brand config above → the standalone lane still seeds the full template.
        const standalone = path.join(root, 'standalone');
        fs.mkdirSync(standalone, { recursive: true });
        scaffoldDefaults({ outputDir: standalone, logger: quiet });
        ctx.expect(fs.existsSync(path.join(standalone, 'config', 'omega.json5')), 'a standalone project keeps the seed').toBeTruthy();

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'scaffold: setup names the seed mode it detected (#95)',
      run: (ctx) => {
        const root = tmpConsumer();

        // Standalone: the full template lane
        const standaloneLines = [];
        scaffoldDefaults({ outputDir: root, logger: { ...quiet, log: (m) => standaloneLines.push(m) } });
        const standaloneMode = standaloneLines.filter((m) => /standalone project/.test(m));
        ctx.expect(standaloneMode.length, 'exactly one mode line').toBe(1);
        ctx.expect(standaloneMode[0], 'names the mode').toMatch(/standalone project/);
        ctx.expect(standaloneMode[0], 'names the consequence').toMatch(/full config template/);

        // Brand monorepo: the no-target-config lane
        const targetDir = path.join(root, 'brand', 'targets', 'web');
        fs.mkdirSync(path.join(root, 'brand', 'config'), { recursive: true });
        fs.writeFileSync(path.join(root, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: { type: 'web' } } }\n");
        fs.mkdirSync(targetDir, { recursive: true });

        const brandLines = [];
        scaffoldDefaults({ outputDir: targetDir, logger: { ...quiet, log: (m) => brandLines.push(m) } });
        const brandMode = brandLines.filter((m) => /brand monorepo detected/.test(m));
        ctx.expect(brandMode.length, 'exactly one mode line').toBe(1);
        ctx.expect(brandMode[0], 'names the mode').toMatch(/brand monorepo detected/);
        ctx.expect(brandMode[0], 'names the consequence').toMatch(/no target-level config seed/);
        ctx.expect(brandMode[0], 'says where the docs went').toMatch(/brand root/);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'scaffold: an old-template AGENTS.md converges, keeping the consumer notes under the Custom marker',
      run: (ctx) => {
        const root = tmpConsumer();
        fs.writeFileSync(path.join(root, 'AGENTS.md'),
          '# ========== Default Values ==========\n# OMEGA Web consumer project\nframework guidance\n\n# ========== Custom Values ==========\n<!-- Add your project-specific notes below this line -->\nOur deploy needs the VPN up.\n');
        const warnings = [];
        const result = scaffoldDefaults({ outputDir: root, logger: { ...quiet, warn: (m) => warnings.push(m) } });

        ctx.expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toBe('<!-- ========== Default Values ========== -->\n@node_modules/@omega.js/manager/AGENTS.md\n\n<!-- ========== Custom Values ========== -->\nOur deploy needs the VPN up.\n');
        ctx.expect(result.merged.includes('AGENTS.md'), 'the convergence is recorded').toBeTruthy();
        ctx.expect(warnings.some((m) => m.includes('Converged AGENTS.md')), 'the convergence is loud').toBeTruthy();
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'scaffold: inside a brand monorepo the per-target agent docs never scaffold and framework-owned copies sweep (brand doc unification)',
      run: (ctx) => {
        const root = tmpConsumer();
        const targetDir = path.join(root, 'brand', 'targets', 'web');
        fs.mkdirSync(targetDir, { recursive: true });

        // Standalone scaffold first (no brand config yet) — the per-target agent docs land.
        scaffoldDefaults({ outputDir: targetDir, logger: quiet });
        ctx.expect(fs.existsSync(path.join(targetDir, 'AGENTS.md')), 'a standalone project root gets its AGENTS.md').toBeTruthy();
        ctx.expect(!fs.existsSync(path.join(targetDir, 'CLAUDE.md')), 'no scaffold writes a CLAUDE.md').toBeTruthy();

        // Wrap it in a brand monorepo: the next setup sweeps the untouched copy.
        fs.mkdirSync(path.join(root, 'brand', 'config'), { recursive: true });
        fs.writeFileSync(path.join(root, 'brand', 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: { type: 'web' } } }\n");
        const swept = scaffoldDefaults({ outputDir: targetDir, logger: quiet });
        ctx.expect(swept.removed, 'the framework-owned per-target AGENTS.md is swept').toEqual(['AGENTS.md']);
        ctx.expect(!fs.existsSync(path.join(targetDir, 'AGENTS.md')), 'the brand root is the doc home').toBeTruthy();

        // Rerun never resurrects them.
        scaffoldDefaults({ outputDir: targetDir, logger: quiet });
        ctx.expect(!fs.existsSync(path.join(targetDir, 'AGENTS.md')), 'reruns do not resurrect the per-target doc').toBeTruthy();
        ctx.expect(!fs.existsSync(path.join(targetDir, 'CLAUDE.md')), 'reruns write no CLAUDE.md').toBeTruthy();

        // Consumer content is never destroyed: real notes below the Custom marker keep the file.
        const warnings = [];
        fs.writeFileSync(path.join(targetDir, 'AGENTS.md'),
          '# ========== Default Values ==========\nframework guidance\n\n# ========== Custom Values ==========\nOur deploy needs the VPN up.\n');
        const kept = scaffoldDefaults({ outputDir: targetDir, logger: { ...quiet, warn: (m) => warnings.push(m) } });
        ctx.expect(kept.removed).toEqual([]);
        ctx.expect(fs.readFileSync(path.join(targetDir, 'AGENTS.md'), 'utf8'), 'consumer content survives').toMatch(/VPN/);
        ctx.expect(warnings.some((m) => m.includes('consumer content')), 'a move-it-to-the-brand-root warning prints').toBeTruthy();
        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'scaffold: a brand target scaffolds NO per-target .github/ — its CI composes into the brand root (#265)',
      run: (ctx) => {
        const root = tmpConsumer();
        const brandRoot = path.join(root, 'brand');
        const targetDir = path.join(brandRoot, 'targets', 'web');
        fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
        fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), "{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' }, targets: { web: { type: 'web' } } }\n");
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, '.env'), 'CLOUDFLARE_TOKEN=cf\n');

        scaffoldDefaults({ outputDir: targetDir, logger: quiet });

        // GitHub runs workflows from the repo root ONLY — a per-target copy is dead.
        ctx.expect(!fs.existsSync(path.join(targetDir, '.github')), 'no per-target .github/ in a brand monorepo').toBeTruthy();

        const composedPath = path.join(brandRoot, '.github', 'workflows', 'web-build.yml');
        ctx.expect(fs.existsSync(composedPath), 'the target workflow composed into the brand root').toBeTruthy();

        const composed = fs.readFileSync(composedPath, 'utf8');
        // The scoping MECHANISM is devkit's (`working-directory`, block or per step);
        // what web owes the brand is that CI runs the target, not the repo root.
        ctx.expect(composed, 'run steps execute in the target dir').toMatch(/working-directory: targets\/web/);
        ctx.expect(composed, 'the Actions list tells the targets apart').toMatch(/^name: .+ \(targets\/web\)$/m);
        ctx.expect(composed, 'per-target concurrency: one target never cancels another').toMatch(/^ {2}group: web-\$\{\{ github\.ref \}\}$/m);

        // The scaffold's own token pass still ran: node version + the .env secrets block.
        ctx.expect(composed.includes(`NODE_VERSION: '${NODE_VERSION}'`), 'the node version templated').toBeTruthy();
        ctx.expect(composed.includes('OMEGA_LICENSE_KEY: ${{ secrets.OMEGA_LICENSE_KEY }}'), "the schema's web delivery set reached the composed env block").toBeTruthy();
        ctx.expect(!composed.includes('{{ githubSecrets }}'), 'no unrendered token survives').toBeTruthy();

        // Idempotent: a setup rerun rewrites that one file and never adds another.
        scaffoldDefaults({ outputDir: targetDir, logger: quiet });
        ctx.expect(fs.readdirSync(path.join(brandRoot, '.github', 'workflows')), 'one file per app, rerun-stable').toEqual(['web-build.yml']);
        ctx.expect(fs.readFileSync(composedPath, 'utf8'), 'the rerun composed the same bytes').toBe(composed);

        fs.rmSync(root, { recursive: true, force: true });
      },
    },

    {
      name: 'bin: a bare `omega` prints help and scaffolds nothing (real process, real bin — #675)',
      run: (ctx) => {
        const root = tmpConsumer();
        const out = execFileSync(process.execPath, [path.join(PKG, 'bin', 'omega')], { cwd: root, encoding: 'utf8' });

        ctx.expect(out, 'a bare invocation prints help').toMatch(/Usage: omega <command>/);
        ctx.expect(!/^ {2}setup\b/m.test(out), 'setup is not in the command list').toBeTruthy();
        ctx.expect(!fs.existsSync(path.join(root, 'config', 'omega.json5')), 'help is inert — nothing is scaffolded').toBeTruthy();
        fs.rmSync(root, { recursive: true, force: true });
      },
    },
  ],
});
