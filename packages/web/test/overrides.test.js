/**
 * The layered override map (#94) — `omega customize --list` and the
 * single-file `omega customize <path>`.
 *
 * The map is the build's own resolution read back out (src/overrides.js runs
 * the SAME resolveThemeLayers chains the engine and the asset pipeline do), so
 * these tests assert against the REAL packaged theme/core content rather than a
 * fixture layer stack — a map that disagreed with the shipped layers would be
 * the bug. The consumer side is a temp tree (the commands-clean pattern): the
 * verbs read process.cwd() through consumerPaths.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const customize = require('../src/commands/customize.js');
const { buildAssets } = require('../src/assets.js');
const { buildOverrideMap, materializeOverride } = require('../src/overrides.js');

const BASE_FOOTER = '_includes/frontend/sections/footer.html';
const PKG = path.resolve(__dirname, '..');
const REPO = path.resolve(PKG, '..', '..');

/** A consumer tree with a valid config; `extra` seeds files under the root. */
function consumer(t, { theme = 'classy', extra = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-overrides-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const files = {
    'config/omega.json5': JSON.stringify({
      brand: { id: 'fixture', name: 'Fixture' },
      url: 'https://fixture.example.com',
      theme: { id: theme },
      targets: { web: { type: 'web' } },
    }),
    'package.json': '{}',
    'src/pages/.keep': '',
    ...extra,
  };
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

/** The map for a consumer tree. */
function mapFor(root, theme = 'classy') {
  return buildOverrideMap({ consumerDir: path.join(root, 'src'), siteData: { theme: { id: theme } } });
}

/** Run the real command with cwd on the consumer, capturing its lines. */
async function runIn(t, root, options = {}) {
  const previous = process.cwd();
  const lines = [];
  const written = process.stdout.write.bind(process.stdout);
  process.chdir(root);
  process.stdout.write = (chunk, ...rest) => { lines.push(String(chunk)); return written(chunk, ...rest); };
  t.after(() => { process.chdir(previous); process.stdout.write = written; });

  try {
    await customize({ _: ['customize'], ...options });
  } finally {
    process.stdout.write = written;
    process.chdir(previous);
  }
  return lines.join('');
}

// ─── The map builder ─────────────────────────────────────────────────────────

/**
 * Compile a consumer's css the way the build does (assets.js layer roots),
 * returning every emitted stylesheet's text. `only: 'css'` skips esbuild.
 */
async function compileCss(t, root) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-web-overrides-css-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));

  const classy = path.join(PKG, 'themes', 'classy');
  const base = path.join(PKG, 'themes', 'base');
  await buildAssets({
    layers: [path.join(root, 'src', 'assets'), classy, base, path.join(PKG, 'core')],
    themeRoots: [classy, base],
    sectionRoots: [path.join(root, 'src'), classy, base],
    themesDir: path.join(PKG, 'themes'),
    coreDir: path.join(PKG, 'core'),
    outDir: out,
    clientEntry: path.join(REPO, 'packages', 'client', 'src', 'index.js'),
    only: 'css',
  });

  const cssDir = path.join(out, 'assets', 'css');
  return fs.readdirSync(cssDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8'))
    .join('\n');
}

module.exports = defineCases({
  type: 'group',
  description: 'overrides',
  tests: [
    {
      name: 'the map covers every shadowable lane — sections, includes, css, pages',
      run: (ctx) => {
        const entries = mapFor(consumer(ctx));
        const kinds = new Set(entries.map((entry) => entry.kind));

        ctx.expect([...kinds].sort(), 'all four lanes are listed').toEqual(['css', 'include', 'page', 'section']);
        ctx.expect(entries.some((entry) => entry.path === BASE_FOOTER), 'the theme footer include is shadowable').toBeTruthy();
        ctx.expect(entries.some((entry) => entry.kind === 'section' && /^_sections\/.*\/section\.html$/.test(entry.path)), 'section markup is listed by its entry path').toBeTruthy();
        ctx.expect(entries.every((entry) => entry.kind !== 'css' || entry.path.startsWith('assets/css/')), 'css paths carry the consumer asset-layer prefix').toBeTruthy();
      },
    },

    {
      name: 'every non-page path is the path that shadows it — relative to the consumer src',
      run: (ctx) => {
        const root = consumer(ctx);
        const entries = mapFor(root).filter((entry) => entry.kind !== 'page');

        for (const entry of entries) {
          ctx.expect(entry.target, `${entry.path} lands where the map says`).toBe(path.join(root, 'src', entry.path));
          ctx.expect(fs.existsSync(entry.source), `${entry.path} names a real source file`).toBeTruthy();
        }
      },
    },

    {
      name: 'owning layers are the build\'s own chain: framework core, theme layers, consumer',
      run: (ctx) => {
        const entries = mapFor(consumer(ctx));
        const footer = entries.find((entry) => entry.path === BASE_FOOTER);
        const layers = new Set(entries.map((entry) => entry.layer));

        ctx.expect(footer.layer, 'the footer comes from the base layer').toBe('theme:base');
        ctx.expect(footer.shadowed, 'a bare consumer shadows nothing').toBe(false);
        ctx.expect(layers.has('framework'), 'the core layer owns files too').toBeTruthy();
        ctx.expect([...layers].every((layer) => layer === 'framework' || layer === 'consumer' || layer.startsWith('theme:')), 'no other layer label exists').toBeTruthy();
      },
    },

    {
      name: 'the active theme decides the winner — newsflash beats classy where it owns the file',
      run: (ctx) => {
        const root = consumer(ctx, { theme: 'newsflash' });
        const entries = mapFor(root, 'newsflash');
        const winners = new Map(entries.map((entry) => [entry.path, entry]));

        const themed = entries.filter((entry) => entry.layer === 'theme:newsflash');
        ctx.expect(themed.length, 'the active theme owns files in the map').toBeTruthy();
        for (const entry of themed) {
          ctx.expect(entry.source.includes(path.join('themes', 'newsflash')), `${entry.path} resolves to the active theme's copy`).toBeTruthy();
        }
        ctx.expect(winners.get(BASE_FOOTER).layer, 'what newsflash does not own still flows from the base layer').toBe('theme:base');
      },
    },

    {
      name: 'a consumer file shadows its layer — the map says so and points at the file it hides',
      run: (ctx) => {
        const root = consumer(ctx, { extra: { [`src/${BASE_FOOTER}`]: '<footer>mine</footer>' } });
        const footer = mapFor(root).find((entry) => entry.path === BASE_FOOTER);

        ctx.expect(footer.layer, 'the consumer copy wins').toBe('consumer');
        ctx.expect(footer.shadowed, 'and is reported as a shadow').toBe(true);
        ctx.expect(footer.shadows, 'naming the layer underneath it').toEqual(['theme:base']);
        ctx.expect(footer.source.includes(path.join('themes', 'base')), 'source stays the framework file — what a materialize would copy').toBeTruthy();
      },
    },

    // ─── omega customize --list ──────────────────────────────────────────────────

    {
      name: '--list prints every lane with its owning layer and the consumer\'s shadows',
      run: async (ctx) => {
        const root = consumer(ctx, { extra: { [`src/${BASE_FOOTER}`]: '<footer>mine</footer>' } });

        const output = await runIn(ctx, root, { list: true });

        ctx.expect(output, 'the section lane is printed').toMatch(/Sections & components/);
        ctx.expect(output, 'the include lane is printed').toMatch(/Includes/);
        ctx.expect(output, 'the css lane is printed').toMatch(/Stylesheets/);
        ctx.expect(output, 'the page lane is printed').toMatch(/Pages \(omega customize <url>\)/);
        ctx.expect(output, 'an owned path reads as shadowed, with its file').toMatch(new RegExp(`${BASE_FOOTER}\\s+shadowed by you`));
        ctx.expect(output, 'an un-owned path names the layer it comes from').toMatch(/assets\/css\/main\.scss\s+from (framework|theme:classy)/);
      },
    },

    // ─── omega customize <path> ──────────────────────────────────────────────────

    {
      name: 'a single include materializes at its shadow path, with a provenance header',
      run: async (ctx) => {
        const root = consumer(ctx);

        const output = await runIn(ctx, root, { _: ['customize', BASE_FOOTER] });
        const written = fs.readFileSync(path.join(root, 'src', BASE_FOOTER), 'utf8');
        const source = fs.readFileSync(mapFor(root).find((entry) => entry.path === BASE_FOOTER).source, 'utf8');

        ctx.expect(output).toMatch(/Materialized src\/_includes\/frontend\/sections\/footer\.html — a copy of the theme:base layer's file/);
        ctx.expect(written, 'the header names the source layer in Liquid comment form (never rendered)').toMatch(/^\{% comment %\}\n {2}omega:consumer-override: materialized by omega customize _includes\/frontend\/sections\/footer\.html — a copy of the theme:base layer's file\./);
        ctx.expect(written.endsWith(source), 'the file itself is a verbatim copy').toBeTruthy();
      },
    },

    {
      name: 'a stylesheet materializes into the consumer asset layer with a scss comment header',
      run: async (ctx) => {
        const root = consumer(ctx);
        const entry = mapFor(root).find((e) => e.kind === 'css' && e.path === 'assets/css/main.scss');

        await runIn(ctx, root, { _: ['customize', entry.path] });
        const written = fs.readFileSync(path.join(root, 'src', 'assets', 'css', 'main.scss'), 'utf8');

        ctx.expect(written, 'scss carries // comments, not liquid').toMatch(/^\/\/ omega:consumer-override: materialized by omega customize assets\/css\/main\.scss/);
        ctx.expect(written.endsWith(fs.readFileSync(entry.source, 'utf8')), 'verbatim below the header').toBeTruthy();
      },
    },

    {
      name: 'the provenance header carries the consumer-override marker in the first five lines',
      run: async (ctx) => {
        const root = consumer(ctx);

        // A materialize IS the deliberate consumer copy, so the file has to pass the
        // omega:guard shadow check (#452) without anybody hand-editing a marker in.
        // That hook reads the first FIVE lines only, in any comment syntax.
        await runIn(ctx, root, { _: ['customize', BASE_FOOTER] });
        await runIn(ctx, root, { _: ['customize', 'assets/css/main.scss'] });

        for (const rel of [path.join('_includes', 'frontend', 'sections', 'footer.html'), path.join('assets', 'css', 'main.scss')]) {
          const head = fs.readFileSync(path.join(root, 'src', rel), 'utf8').split('\n').slice(0, 5).join('\n');
          ctx.expect(head, `${rel} lost the marker the guard hook reads`).toMatch(/omega:consumer-override: materialized by omega customize /);
        }
      },
    },

    // ─── The css contract: a listed sheet is one the compile chain HONORS ────────

    {
      name: 'every css entry the map offers actually wins when materialized — proved by a real compile',
      run: async (ctx) => {
        const root = consumer(ctx);
        const entries = mapFor(root).filter((entry) => entry.kind === 'css');

        ctx.expect(entries.length, 'the lane is not empty').toBeTruthy();

        for (const entry of entries) {
          await runIn(ctx, root, { _: ['customize', entry.path] });
          fs.appendFileSync(path.join(root, 'src', entry.path), `\n.shadow-proof-${entry.path.replace(/\W/g, '-')} { color: red; }\n`);
        }

        const css = await compileCss(ctx, root);
        for (const entry of entries) {
          ctx.expect(css.includes(`.shadow-proof-${entry.path.replace(/\W/g, '-')}`), `${entry.path}: the consumer's copy reached the compiled output`).toBeTruthy();
        }
      },
    },

    {
      name: 'unreachable partials are NOT listed — a consumer copy of one never loads',
      run: async (ctx) => {
        const root = consumer(ctx);
        const entries = mapFor(root).filter((entry) => entry.kind === 'css');

        // The reason the lane is narrow: bare relative @use/@import inside a theme
        // sheet resolves against the IMPORTING file before any loadPath, so a
        // consumer copy of a partial is dead weight. Offering it would be a lie.
        ctx.expect(entries.every((entry) => !entry.path.split('/').some((segment) => segment.startsWith('_'))), 'no partials in the map').toBeTruthy();
        // …and #624 narrows it to ONE: a page or layout sheet is never shadowed —
        // every layer's loads — so materializing one would DUPLICATE its rules, not
        // replace them. The map offers only what a consumer copy takes over.
        ctx.expect(entries.every((entry) => entry.path === 'assets/css/main.scss'), 'main.scss is the only sheet sass resolves by layer').toBeTruthy();
        ctx.expect(materializeOverride({ path: 'assets/css/base/_utilities.scss', consumerDir: path.join(root, 'src') }).status, 'and the verb refuses to write one').toBe('unknown');

        const utilities = path.join(root, 'src', 'assets', 'css', 'base', '_utilities.scss');
        fs.mkdirSync(path.dirname(utilities), { recursive: true });
        fs.writeFileSync(utilities, '.hand-rolled-partial-shadow { color: red; }\n');

        ctx.expect(!(await compileCss(ctx, root)).includes('.hand-rolled-partial-shadow'), 'a hand-placed partial shadow is dead — exactly what the map refuses to promise').toBeTruthy();
      },
    },

    {
      name: 'a section asset file says what section resolution actually does',
      run: async (ctx) => {
        const root = consumer(ctx);
        const scss = mapFor(root).find((entry) => entry.kind === 'section' && entry.path.endsWith('section.scss'));

        const output = await runIn(ctx, root, { _: ['customize', scss.path] });
        const written = fs.readFileSync(path.join(root, 'src', scss.path), 'utf8');

        ctx.expect(written, 'the header warns that markup and assets travel together').toMatch(/Sections resolve per ENTRY/);
        ctx.expect(output, 'and so does the command').toMatch(/shadow the entry's section\.html too, or declare `inherit`/i);
      },
    },

    {
      name: 'materializing twice never overwrites — the second run says it exists and stops',
      run: async (ctx) => {
        const root = consumer(ctx);
        const target = path.join(root, 'src', BASE_FOOTER);

        await runIn(ctx, root, { _: ['customize', BASE_FOOTER] });
        fs.writeFileSync(target, '<footer>my edits</footer>');
        const output = await runIn(ctx, root, { _: ['customize', BASE_FOOTER] });

        ctx.expect(fs.readFileSync(target, 'utf8'), 'the consumer\'s work survives').toBe('<footer>my edits</footer>');
        ctx.expect(output).toMatch(/Nothing to do — you already shadow _includes\/frontend\/sections\/footer\.html/);
      },
    },

    {
      name: 'materializeOverride reports an unknown path instead of writing one',
      run: (ctx) => {
        const root = consumer(ctx);
        const result = materializeOverride({ path: '_includes/nope/not-a-file.html', consumerDir: path.join(root, 'src') });

        ctx.expect(result.status).toBe('unknown');
        ctx.expect(fs.existsSync(path.join(root, 'src', '_includes', 'nope')), 'nothing is created for a miss').toBe(false);
      },
    },

    {
      name: 'a page URL still routes to the page lane — the file lane never swallows it',
      run: async (ctx) => {
        const root = consumer(ctx);

        const output = await runIn(ctx, root, { _: ['customize', '/pricing'] });

        ctx.expect(output, 'the URL materialized a page, not a shadow file').toMatch(/(Materialized|Copied) src\/pages\//);
      },
    },
  ],
});
