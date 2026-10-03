/**
 * bundle (#736): the ONE esbuild wrapper every framework builds through. What
 * it owns is COMPOSITION (the shared plugins in one order, minify by mode and
 * a sourcemap in every mode, esbuild resolved from the calling framework), so
 * these tests assert the composed build, not esbuild itself.
 *
 * Every fixture framework root lives under `.temp/` rather than os.tmpdir():
 * `bundle` resolves esbuild from the framework root walking up, and only a
 * path inside this monorepo reaches the installed copy — which is the contract,
 * not a test convenience.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { bundle, formatBytes } = require('../src/bundle.js');
const { START_MARKER, END_MARKER } = require('../src/strip-dev-blocks.js');
const { installEsmOnlyFixture, FIXTURE_NAME, NODE_MARKER, BROWSER_MARKER } = require('../src/test/esm-only-fixture.js');

const TEMP = path.join(__dirname, '..', '.temp', `bundle-${process.pid}`);

let counter = 0;

// A framework package root (a package.json + whatever node_modules it declares)
// under .temp, so esbuild resolves from it exactly as a real framework's does.
function makeFramework({ dependencies = {}, modules = {} } = {}) {
  const dir = path.join(TEMP, `framework-${counter += 1}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@omega.js/fixture', dependencies }));
  for (const [rel, contents] of Object.entries(modules)) {
    const abs = path.join(dir, 'node_modules', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return dir;
}

// A source tree OUTSIDE the framework root — a consumer's position.
function makeSources(files) {
  const dir = path.join(TEMP, `sources-${counter += 1}`);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return dir;
}

function outdirFor(name) {
  return path.join(TEMP, `out-${name}-${counter += 1}`);
}

// Watch builds land asynchronously — `context.watch()` runs the startup build
// itself and resolves before it finishes — so every watch assertion polls for
// the output rather than reading it straight after the call.
async function waitFor(predicate, what, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out after ${timeout}ms waiting for: ${what}`);
}

function reads(file, text) {
  return () => fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(text);
}

// The working-directory snapshot esbuild's node API takes at MODULE LOAD, and
// reuses for every later build. bundle() loads esbuild lazily, so the snapshot
// is the cwd of the process's FIRST bundle() call — in @omega.js/extension's
// self-test that was a chdir'd temp fixture, removed as soon as its suite was
// done, and every esbuild build after it failed to resolve its entry point,
// absolute paths included (#777). The scenario needs a FRESH process (the
// snapshot is taken once), so the child below is the test.
const DEAD_CWD_CHILD = `
const fs = require('node:fs');
const path = require('node:path');

const [bundlePath, frameworkRoot, doomed, entry, outfile] = process.argv.slice(2);
const { bundle } = require(bundlePath);

(async () => {
  // The first bundle() of this process — esbuild loads HERE, from inside the
  // directory that is about to disappear.
  process.chdir(doomed);
  await bundle({
    frameworkRoot,
    entries: [path.join(doomed, 'seed.js')],
    outfile: path.join(doomed, 'out', 'seed.js'),
    format: 'iife',
  });

  process.chdir(path.dirname(frameworkRoot));
  fs.rmSync(doomed, { recursive: true, force: true });

  // A later, unrelated build with an absolute entry — the one #777 broke.
  await bundle({ frameworkRoot, entries: [entry], outfile, format: 'iife' });
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
`;

// `import.meta.url` in CommonJS output (#906). The rule is composed from the
// OUTPUT SHAPE, so every cjs+node caller (desktop's main and preload bundles)
// gets it without wiring, and no browser bundle is touched. The dependency is
// the ONE ESM-only fixture every target proves this with.

// A consumer tree with that fixture installed as a real dependency, the way a
// brand's node_modules holds one.
function makeFixtureConsumer(entry) {
  const dir = makeSources({ 'entry.js': entry });
  installEsmOnlyFixture(dir);
  return dir;
}

module.exports = defineCases({
  type: 'group',
  description: 'bundle',
  cleanup: () => fs.rmSync(TEMP, { recursive: true, force: true }),
  tests: [
    {
      name: 'the caller\'s plugins come first, then the shared ones, and a production build carries the strip',
      run: async (ctx) => {
        const frameworkRoot = makeFramework({ dependencies: { 'fixture-lib': '^1.0.0' } });
        const sources = makeSources({ 'entry.js': 'export default 1;\n' });
        const seen = [];
        const spy = {
          name: 'caller-plugin',
          setup(build) {
            seen.push(...build.initialOptions.plugins.map((plugin) => plugin.name));
          },
        };

        await bundle({
          frameworkRoot,
          entries: [path.join(sources, 'entry.js')],
          outdir: outdirFor('composition'),
          format: 'esm',
          plugins: [spy],
        });

        ctx.expect(seen).toEqual(['caller-plugin', 'omega-framework-deps', 'omega-strip-dev-blocks', 'omega-bundle-timing']);
      },
    },

    {
      name: 'a dev build registers no strip — dev warnings and simulation hooks must run',
      run: async (ctx) => {
        const frameworkRoot = makeFramework({ dependencies: { 'fixture-lib': '^1.0.0' } });
        const sources = makeSources({ 'entry.js': 'export default 1;\n' });
        const seen = [];
        const spy = { name: 'caller-plugin', setup(build) { seen.push(...build.initialOptions.plugins.map((p) => p.name)); } };

        await bundle({
          frameworkRoot,
          entries: [path.join(sources, 'entry.js')],
          outdir: outdirFor('composition-dev'),
          format: 'esm',
          dev: true,
          plugins: [spy],
        });

        ctx.expect(seen).toEqual(['caller-plugin', 'omega-framework-deps', 'omega-bundle-timing']);
      },
    },

    {
      name: 'a framework that declares no dependencies composes no resolve hook',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({ 'entry.js': 'export default 1;\n' });
        const seen = [];
        const spy = { name: 'caller-plugin', setup(build) { seen.push(...build.initialOptions.plugins.map((p) => p.name)); } };

        await bundle({
          frameworkRoot,
          entries: [path.join(sources, 'entry.js')],
          outdir: outdirFor('composition-nodeps'),
          format: 'esm',
          plugins: [spy],
        });

        ctx.expect(seen).toEqual(['caller-plugin', 'omega-strip-dev-blocks', 'omega-bundle-timing']);
      },
    },

    {
      name: 'the strip corpus survives the round trip: production cuts every marked block, dev keeps them',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        // Every dev-only line has a SIDE EFFECT: a bare `const` esbuild can prove
        // unused is dropped by tree-shaking, which would pass this test without the
        // strip ever running.
        const sources = makeSources({
          'entry.js': [
            'const keep = "PROD_SENTINEL";',
            START_MARKER,
            'console.log("DEV_ONLY_SENTINEL_A");',
            END_MARKER,
            `${START_MARKER} console.log("DEV_ONLY_SENTINEL_B"); ${END_MARKER}`,
            'const tail = "TAIL_SENTINEL";',
            'export default { keep, tail };',
            '',
          ].join('\n'),
        });

        const read = async (dev) => {
          const outdir = outdirFor(`strip-${dev ? 'dev' : 'prod'}`);
          await bundle({
            frameworkRoot,
            entries: [path.join(sources, 'entry.js')],
            outdir,
            format: 'esm',
            dev,
          });
          return fs.readFileSync(path.join(outdir, 'entry.js'), 'utf8');
        };

        const prod = await read(false);
        ctx.expect(prod).toMatch(/PROD_SENTINEL/);
        ctx.expect(prod).toMatch(/TAIL_SENTINEL/);
        ctx.expect(prod).not.toMatch(/DEV_ONLY_SENTINEL_A/);
        ctx.expect(prod).not.toMatch(/DEV_ONLY_SENTINEL_B/);

        const dev = await read(true);
        ctx.expect(dev).toMatch(/DEV_ONLY_SENTINEL_A/);
        ctx.expect(dev).toMatch(/DEV_ONLY_SENTINEL_B/);
      },
    },

    {
      name: 'production minifies and a dev build does not; both write a sourcemap',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({ 'entry.js': 'const aVeryLongLocalName = "SENTINEL";\nexport default aVeryLongLocalName;\n' });

        const build = async (dev) => {
          const outdir = outdirFor(`rules-${dev ? 'dev' : 'prod'}`);
          await bundle({ frameworkRoot, entries: [path.join(sources, 'entry.js')], outdir, format: 'esm', dev });
          return outdir;
        };

        const prodDir = await build(false);
        const prod = fs.readFileSync(path.join(prodDir, 'entry.js'), 'utf8');
        ctx.expect(prod, 'production is minified').not.toMatch(/aVeryLongLocalName/);
        ctx.expect(fs.existsSync(path.join(prodDir, 'entry.js.map')), 'production ships a sourcemap').toBeTruthy();

        const devDir = await build(true);
        const dev = fs.readFileSync(path.join(devDir, 'entry.js'), 'utf8');
        ctx.expect(dev, 'a dev build is readable').toMatch(/aVeryLongLocalName/);
        ctx.expect(fs.existsSync(path.join(devDir, 'entry.js.map')), 'a dev build ships a sourcemap').toBeTruthy();
      },
    },

    {
      name: 'a bare specifier the framework declares resolves from the FRAMEWORK\'s node_modules',
      run: async (ctx) => {
        const frameworkRoot = makeFramework({
          dependencies: { 'fixture-lib': '^1.0.0' },
          modules: {
            'fixture-lib/package.json': JSON.stringify({ name: 'fixture-lib', version: '1.0.0', main: 'index.js' }),
            'fixture-lib/index.js': 'export const value = "FRAMEWORK_COPY";\n',
          },
        });
        // The consumer sits outside the framework root and ships its OWN copy: plain
        // node resolution would take that one, so only the resolve hook can produce
        // the framework's.
        const sources = makeSources({
          'entry.js': "import { value } from 'fixture-lib';\nexport default value;\n",
          'node_modules/fixture-lib/package.json': JSON.stringify({ name: 'fixture-lib', version: '0.0.0', main: 'index.js' }),
          'node_modules/fixture-lib/index.js': 'export const value = "CONSUMER_COPY";\n',
        });

        const outdir = outdirFor('framework-deps');
        await bundle({ frameworkRoot, entries: [path.join(sources, 'entry.js')], outdir, format: 'esm', dev: true });

        const out = fs.readFileSync(path.join(outdir, 'entry.js'), 'utf8');
        ctx.expect(out, "the framework's copy won").toMatch(/FRAMEWORK_COPY/);
        ctx.expect(out, "the consumer's copy was not used").not.toMatch(/CONSUMER_COPY/);
      },
    },

    {
      name: 'a name the framework does not declare still fails with esbuild\'s own resolution error',
      run: async (ctx) => {
        const frameworkRoot = makeFramework({ dependencies: { 'fixture-lib': '^1.0.0' } });
        const sources = makeSources({ 'entry.js': "import 'totally-not-a-framework-dep';\n" });

        await ctx.expect(bundle({
            frameworkRoot,
            entries: [path.join(sources, 'entry.js')],
            outdir: outdirFor('unresolvable'),
            format: 'esm',
          })).rejects.toThrow(/Could not resolve "totally-not-a-framework-dep"/);
      },
    },

    {
      name: 'watch mode rebuilds on a file change, and dispose stops it',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({ 'entry.js': 'export default "FIRST_SENTINEL";\n' });
        const entry = path.join(sources, 'entry.js');
        const outdir = outdirFor('watch');
        const outfile = path.join(outdir, 'entry.js');

        const result = await bundle({ frameworkRoot, entries: [entry], outdir, format: 'esm', mode: 'watch' });
        try {
          await waitFor(reads(outfile, 'FIRST_SENTINEL'), 'the startup build');

          fs.writeFileSync(entry, 'export default "SECOND_SENTINEL";\n');
          await waitFor(reads(outfile, 'SECOND_SENTINEL'), 'the rebuild after the change');
        } finally {
          await result.dispose();
        }

        // Disposed: a further change writes nothing.
        fs.writeFileSync(entry, 'export default "THIRD_SENTINEL";\n');
        await new Promise((resolve) => setTimeout(resolve, 300));
        ctx.expect(fs.readFileSync(outfile, 'utf8'), 'the watcher stopped').not.toMatch(/THIRD_SENTINEL/);
      },
    },

    {
      name: 'a watch build is a dev build — readable, sourcemapped, dev blocks intact',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({
          'entry.js': `${START_MARKER}\nconsole.log("DEV_ONLY_SENTINEL");\n${END_MARKER}\nexport default "KEPT";\n`,
        });
        const outdir = outdirFor('watch-dev');

        const result = await bundle({
          frameworkRoot,
          entries: [path.join(sources, 'entry.js')],
          outdir,
          format: 'esm',
          mode: 'watch',
        });
        try {
          await waitFor(reads(path.join(outdir, 'entry.js'), 'DEV_ONLY_SENTINEL'), 'the startup build');
          ctx.expect(fs.existsSync(path.join(outdir, 'entry.js.map'))).toBeTruthy();
        } finally {
          await result.dispose();
        }
      },
    },

    {
      name: 'a build with no frameworkRoot fails loudly rather than guessing where esbuild lives',
      run: async (ctx) => {
        await ctx.expect(bundle({ entries: [], outdir: outdirFor('no-root') })).rejects.toThrow(/frameworkRoot/);
      },
    },

    {
      name: 'a reserved esbuild key in the passthrough throws, naming it — silently defeating the composition is a programmer error',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({ 'entry.js': 'export default 1;\n' });

        // Each of these IS the composition: letting a caller pass its own would ship
        // an unbundled, unminified or metafile-less build that still looks like a
        // bundle() build.
        for (const key of ['bundle', 'metafile', 'minify', 'sourcemap', 'plugins', 'entryPoints']) {
          await ctx.expect(bundle({
              frameworkRoot,
              entries: [path.join(sources, 'entry.js')],
              outdir: outdirFor(`reserved-${key}`),
              format: 'esm',
              [key]: false,
            }), `passing ${key} must throw, naming it`).rejects.toThrow(new RegExp(`\\b${key}\\b`));
        }
      },
    },

    {
      name: 'an unknown mode throws rather than silently returning a one-shot build with no dispose',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({ 'entry.js': 'export default 1;\n' });

        await ctx.expect(bundle({
            frameworkRoot,
            entries: [path.join(sources, 'entry.js')],
            outdir: outdirFor('bad-mode'),
            format: 'esm',
            mode: 'wathc',
          })).rejects.toThrow(/wathc/);
      },
    },

    {
      name: 'a watch start over a BROKEN file still returns a live watcher, so fixing the file rebuilds',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({ 'entry.js': 'export default "UNCLOSED;\n' });
        const entry = path.join(sources, 'entry.js');
        const outdir = outdirFor('watch-broken');
        const outfile = path.join(outdir, 'entry.js');

        // The first build FAILS. esbuild reports it through its own channel; bundle()
        // must not throw it back out, because that would leak the context and leave
        // the dev lane with no watcher at all.
        const result = await bundle({
          frameworkRoot,
          entries: [entry],
          outdir,
          format: 'esm',
          mode: 'watch',
        });
        try {
          ctx.expect(typeof result.dispose, 'a dispose came back').toBe('function');

          fs.writeFileSync(entry, 'export default "FIXED_SENTINEL";\n');
          await waitFor(reads(outfile, 'FIXED_SENTINEL'), 'the rebuild after the syntax error was fixed');
        } finally {
          await result.dispose();
        }
      },
    },

    {
      name: 'starting a watch builds ONCE — one timing line, not two',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({ 'entry.js': 'export default "ONCE";\n' });
        const outdir = outdirFor('watch-once');

        const lines = [];
        const realLog = console.log;
        console.log = (...args) => { lines.push(args.join(' ')); };
        const timingLines = () => lines.filter((line) => line.includes(':bundle]'));

        let result;
        try {
          result = await bundle({
            frameworkRoot,
            entries: [path.join(sources, 'entry.js')],
            outdir,
            format: 'esm',
            mode: 'watch',
          });
          // The startup build is asynchronous, so wait for its line and then let the
          // machine settle — a second startup build would land in that window.
          await waitFor(() => timingLines().length >= 1, 'the startup timing line');
          await new Promise((resolve) => setTimeout(resolve, 500));
        } finally {
          console.log = realLog;
        }

        try {
          const timing = timingLines();
          ctx.expect(timing.length, `exactly one timing line, got ${timing.length}: ${JSON.stringify(timing)}`).toBe(1);
        } finally {
          await result.dispose();
        }
      },
    },

    {
      name: 'one entry can name its OUTPUT FILE instead of a directory',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({ 'entry.js': 'export default "OUTFILE_SENTINEL";\n' });
        const outfile = path.join(outdirFor('outfile'), 'nested', 'service-worker.js');

        await bundle({
          frameworkRoot,
          entries: [path.join(sources, 'entry.js')],
          outfile,
          format: 'iife',
        });

        ctx.expect(fs.existsSync(outfile), 'the build wrote exactly the named file').toBeTruthy();
        ctx.expect(fs.readFileSync(outfile, 'utf8')).toMatch(/OUTFILE_SENTINEL/);
      },
    },

    {
      name: 'an outfile build still gets the composition — minify by mode, the strip, a timing line naming the file',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({
          'entry.js': [
            'const aVeryLongLocalName = "PROD_SENTINEL";',
            START_MARKER,
            'console.log("DEV_ONLY_SENTINEL");',
            END_MARKER,
            'globalThis.out = aVeryLongLocalName;',
            '',
          ].join('\n'),
        });
        const outfile = path.join(outdirFor('outfile-composition'), 'worker.js');

        const lines = [];
        const realLog = console.log;
        console.log = (...args) => { lines.push(args.join(' ')); };
        try {
          await bundle({
            frameworkRoot,
            entries: [path.join(sources, 'entry.js')],
            outfile,
            format: 'iife',
          });
        } finally {
          console.log = realLog;
        }

        const out = fs.readFileSync(outfile, 'utf8');
        ctx.expect(out).toMatch(/PROD_SENTINEL/);
        ctx.expect(out, 'the strip ran').not.toMatch(/DEV_ONLY_SENTINEL/);
        ctx.expect(out, 'production is minified').not.toMatch(/aVeryLongLocalName/);
        ctx.expect(fs.existsSync(`${outfile}.map`), 'production ships a sourcemap').toBeTruthy();
        ctx.expect(lines.some((line) => line.includes(':bundle]') && line.includes('worker.js')), `the timing line names the outfile, got ${JSON.stringify(lines)}`).toBeTruthy();
      },
    },

    {
      name: 'a build that names both an outfile and an outdir throws — the destination cannot be two places',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({ 'entry.js': 'export default 1;\n' });

        await ctx.expect(bundle({
            frameworkRoot,
            entries: [path.join(sources, 'entry.js')],
            outdir: outdirFor('both'),
            outfile: path.join(outdirFor('both'), 'entry.js'),
            format: 'esm',
          })).rejects.toThrow(/\[devkit bundle\].*(outdir.*outfile|outfile.*outdir)/);
      },
    },

    {
      name: 'a build that names NEITHER destination throws rather than letting esbuild guess',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({ 'entry.js': 'export default 1;\n' });

        await ctx.expect(bundle({ frameworkRoot, entries: [path.join(sources, 'entry.js')], format: 'esm' })).rejects.toThrow(/\[devkit bundle\].*(outdir.*outfile|outfile.*outdir)/);
      },
    },

    {
      name: 'a NULL optional option is ABSENT, not an esbuild type error — an unanswered lookup must not crash the build',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({ 'entry.js': 'export default "NULL_OPTIONS_SENTINEL";\n' });
        const outdir = outdirFor('null-options');

        // @omega.js/desktop reads its syntax floor off the pinned Electron binary and
        // answers `null` when the binary cannot be probed — the documented "no floor"
        // path. esbuild rejects an explicit null ("target must be a string"), so a
        // null that reached it would crash exactly the build the fallback exists for.
        await bundle({
          frameworkRoot,
          entries: [path.join(sources, 'entry.js')],
          outdir,
          target: null,
          format: null,
          splitting: null,
          define: null,
        });

        ctx.expect(fs.readFileSync(path.join(outdir, 'entry.js'), 'utf8')).toMatch(/NULL_OPTIONS_SENTINEL/);
      },
    },

    {
      name: 'a build survives the deletion of the directory the process bundled from FIRST (#777)',
      run: (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({ 'entry.js': 'export default "DEAD_CWD_SENTINEL";\n' });
        const outfile = path.join(outdirFor('dead-cwd'), 'entry.js');

        const doomed = path.join(TEMP, `doomed-${counter += 1}`);
        fs.mkdirSync(doomed, { recursive: true });
        fs.writeFileSync(path.join(doomed, 'seed.js'), 'export default 1;\n');

        const script = path.join(TEMP, `dead-cwd-child-${counter}.js`);
        fs.writeFileSync(script, DEAD_CWD_CHILD);

        const child = spawnSync(process.execPath, [
          script,
          path.join(__dirname, '..', 'src', 'bundle.js'),
          frameworkRoot,
          doomed,
          path.join(sources, 'entry.js'),
          outfile,
        ], { encoding: 'utf8' });

        ctx.expect(child.status, `the build after the deletion failed: ${child.stderr}`).toBe(0);
        ctx.expect(fs.readFileSync(outfile, 'utf8')).toMatch(/DEAD_CWD_SENTINEL/);
      },
    },

    {
      name: 'a CommonJS bundle keeps import.meta.url, so an ESM-only dependency RUNS bundled (#906)',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeFixtureConsumer([
          `const { fileUrl, viaRequire, marker } = require(${JSON.stringify(FIXTURE_NAME)});`,
          'console.log(JSON.stringify({ fileUrl, viaRequire, marker }));',
          '',
        ].join('\n'));
        const outfile = path.join(outdirFor('import-meta-cjs'), 'main.bundle.js');

        await bundle({
          frameworkRoot,
          entries: [path.join(sources, 'entry.js')],
          outfile,
          platform: 'node',
          format: 'cjs',
        });

        // Run it the way Electron's main process runs main.bundle.js: plain Node,
        // from the file the build wrote.
        const ran = spawnSync(process.execPath, [outfile], { encoding: 'utf8' });
        ctx.expect(ran.status, `the bundled ESM-only dependency threw: ${ran.stderr}`).toBe(0);

        const out = JSON.parse(ran.stdout.trim().split('\n').pop());
        ctx.expect(out.marker, 'the node half of the fixture was bundled').toBe(NODE_MARKER);
        ctx.expect(out.fileUrl && out.fileUrl.startsWith('file://'), `import.meta.url answered a file URL, got ${out.fileUrl}`).toBeTruthy();
        ctx.expect(out.viaRequire, 'createRequire(import.meta.url) produced a working require').toBe(true);
      },
    },

    {
      name: 'the import.meta.url rule is CommonJS-only: a browser bundle is left exactly as it was',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeFixtureConsumer(`import { describeFixture } from '${FIXTURE_NAME}';\nglobalThis.out = describeFixture();\n`);

        const read = async (options) => {
          const outfile = path.join(outdirFor(`import-meta-${options.format}`), 'out.js');
          await bundle({ frameworkRoot, entries: [path.join(sources, 'entry.js')], outfile, dev: true, ...options });
          return fs.readFileSync(outfile, 'utf8');
        };

        for (const options of [{ format: 'iife', platform: 'browser' }, { format: 'esm', platform: 'browser' }, { format: 'esm' }]) {
          const out = await read(options);
          ctx.expect(out, `${options.format}/${options.platform} took no shim`).not.toMatch(/__omegaImportMetaUrl/);
          // The browser half of the fixture bundled and still evaluates.
          ctx.expect(out.includes(BROWSER_MARKER), 'the browser half of the fixture was bundled').toBeTruthy();
        }
      },
    },

    {
      name: 'a caller that defines import.meta.url itself throws rather than racing the composition (#906)',
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({ 'entry.js': 'export default 1;\n' });

        await ctx.expect(bundle({
            frameworkRoot,
            entries: [path.join(sources, 'entry.js')],
            outfile: path.join(outdirFor('import-meta-conflict'), 'out.js'),
            platform: 'node',
            format: 'cjs',
            define: { 'import.meta.url': '"file:///nope"' },
          })).rejects.toThrow(/\[devkit bundle\].*import\.meta\.url/);
      },
    },

    {
      name: "the caller's own define and banner survive the import.meta.url composition",
      run: async (ctx) => {
        const frameworkRoot = makeFramework();
        const sources = makeSources({ 'entry.js': 'globalThis.out = SENTINEL_DEFINE;\n' });
        const outfile = path.join(outdirFor('import-meta-merge'), 'out.js');

        await bundle({
          frameworkRoot,
          entries: [path.join(sources, 'entry.js')],
          outfile,
          platform: 'node',
          format: 'cjs',
          dev: true,
          define: { SENTINEL_DEFINE: '"DEFINE_SENTINEL"' },
          banner: { js: '/* BANNER_SENTINEL */' },
        });

        const out = fs.readFileSync(outfile, 'utf8');
        ctx.expect(out, "the caller's define still applied").toMatch(/DEFINE_SENTINEL/);
        ctx.expect(out, "the caller's banner still rode along").toMatch(/BANNER_SENTINEL/);
        ctx.expect(out.indexOf('__omegaImportMetaUrl') < out.indexOf('BANNER_SENTINEL'), 'the shim is declared first, ahead of the caller banner').toBeTruthy();
      },
    },

    // Every build lane prints what it produced, and each one used to carry its own
    // copy of this (extension's bundle task, desktop's bundle and sass tasks).
    {
      name: 'formatBytes speaks the one size vocabulary every build lane prints',
      run: (ctx) => {
        ctx.expect(formatBytes(0)).toBe('0B');
        ctx.expect(formatBytes(1023)).toBe('1023B');
        ctx.expect(formatBytes(1024)).toBe('1.0kB');
        ctx.expect(formatBytes(1536)).toBe('1.5kB');
        ctx.expect(formatBytes(1024 * 1024)).toBe('1.00MB');
        ctx.expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.50MB');
      },
    },
  ],
});
