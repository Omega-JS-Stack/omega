/**
 * bundle (#736): the ONE esbuild wrapper every framework builds through. What
 * it owns is COMPOSITION — the shared plugins in one order, the minify/
 * sourcemap rules by mode, esbuild resolved from the calling framework — so
 * these tests assert the composed build, not esbuild itself.
 *
 * Every fixture framework root lives under `.temp/` rather than os.tmpdir():
 * `bundle` resolves esbuild from the framework root walking up, and only a
 * path inside this monorepo reaches the installed copy — which is the contract,
 * not a test convenience.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { bundle, formatBytes } = require('../src/bundle.js');
const { START_MARKER, END_MARKER } = require('../src/strip-dev-blocks.js');

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

test.after(() => fs.rmSync(TEMP, { recursive: true, force: true }));

test('the caller\'s plugins come first, then the shared ones, and a production build carries the strip', async () => {
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

  assert.deepEqual(seen, ['caller-plugin', 'omega-framework-deps', 'omega-strip-dev-blocks', 'omega-bundle-timing']);
});

test('a dev build registers no strip — dev warnings and simulation hooks must run', async () => {
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

  assert.deepEqual(seen, ['caller-plugin', 'omega-framework-deps', 'omega-bundle-timing']);
});

test('a framework that declares no dependencies composes no resolve hook', async () => {
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

  assert.deepEqual(seen, ['caller-plugin', 'omega-strip-dev-blocks', 'omega-bundle-timing']);
});

test('the strip corpus survives the round trip: production cuts every marked block, dev keeps them', async () => {
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
  assert.match(prod, /PROD_SENTINEL/);
  assert.match(prod, /TAIL_SENTINEL/);
  assert.doesNotMatch(prod, /DEV_ONLY_SENTINEL_A/);
  assert.doesNotMatch(prod, /DEV_ONLY_SENTINEL_B/);

  const dev = await read(true);
  assert.match(dev, /DEV_ONLY_SENTINEL_A/);
  assert.match(dev, /DEV_ONLY_SENTINEL_B/);
});

test('production minifies with no sourcemap; a dev build does the reverse', async () => {
  const frameworkRoot = makeFramework();
  const sources = makeSources({ 'entry.js': 'const aVeryLongLocalName = "SENTINEL";\nexport default aVeryLongLocalName;\n' });

  const build = async (dev) => {
    const outdir = outdirFor(`rules-${dev ? 'dev' : 'prod'}`);
    await bundle({ frameworkRoot, entries: [path.join(sources, 'entry.js')], outdir, format: 'esm', dev });
    return outdir;
  };

  const prodDir = await build(false);
  const prod = fs.readFileSync(path.join(prodDir, 'entry.js'), 'utf8');
  assert.doesNotMatch(prod, /aVeryLongLocalName/, 'production is minified');
  assert.ok(!fs.existsSync(path.join(prodDir, 'entry.js.map')), 'production ships no sourcemap');

  const devDir = await build(true);
  const dev = fs.readFileSync(path.join(devDir, 'entry.js'), 'utf8');
  assert.match(dev, /aVeryLongLocalName/, 'a dev build is readable');
  assert.ok(fs.existsSync(path.join(devDir, 'entry.js.map')), 'a dev build ships a sourcemap');
});

test('a bare specifier the framework declares resolves from the FRAMEWORK\'s node_modules', async () => {
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
  assert.match(out, /FRAMEWORK_COPY/, "the framework's copy won");
  assert.doesNotMatch(out, /CONSUMER_COPY/, "the consumer's copy was not used");
});

test('a name the framework does not declare still fails with esbuild\'s own resolution error', async () => {
  const frameworkRoot = makeFramework({ dependencies: { 'fixture-lib': '^1.0.0' } });
  const sources = makeSources({ 'entry.js': "import 'totally-not-a-framework-dep';\n" });

  await assert.rejects(
    bundle({
      frameworkRoot,
      entries: [path.join(sources, 'entry.js')],
      outdir: outdirFor('unresolvable'),
      format: 'esm',
    }),
    /Could not resolve "totally-not-a-framework-dep"/,
  );
});

test('watch mode rebuilds on a file change, and dispose stops it', async () => {
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
  assert.doesNotMatch(fs.readFileSync(outfile, 'utf8'), /THIRD_SENTINEL/, 'the watcher stopped');
});

test('a watch build is a dev build — readable, sourcemapped, dev blocks intact', async () => {
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
    assert.ok(fs.existsSync(path.join(outdir, 'entry.js.map')));
  } finally {
    await result.dispose();
  }
});

test('a build with no frameworkRoot fails loudly rather than guessing where esbuild lives', async () => {
  await assert.rejects(
    bundle({ entries: [], outdir: outdirFor('no-root') }),
    /frameworkRoot/,
  );
});

test('a reserved esbuild key in the passthrough throws, naming it — silently defeating the composition is a programmer error', async () => {
  const frameworkRoot = makeFramework();
  const sources = makeSources({ 'entry.js': 'export default 1;\n' });

  // Each of these IS the composition: letting a caller pass its own would ship
  // an unbundled, unminified or metafile-less build that still looks like a
  // bundle() build.
  for (const key of ['bundle', 'metafile', 'minify', 'sourcemap', 'plugins', 'entryPoints']) {
    await assert.rejects(
      bundle({
        frameworkRoot,
        entries: [path.join(sources, 'entry.js')],
        outdir: outdirFor(`reserved-${key}`),
        format: 'esm',
        [key]: false,
      }),
      new RegExp(`\\b${key}\\b`),
      `passing ${key} must throw, naming it`,
    );
  }
});

test('an unknown mode throws rather than silently returning a one-shot build with no dispose', async () => {
  const frameworkRoot = makeFramework();
  const sources = makeSources({ 'entry.js': 'export default 1;\n' });

  await assert.rejects(
    bundle({
      frameworkRoot,
      entries: [path.join(sources, 'entry.js')],
      outdir: outdirFor('bad-mode'),
      format: 'esm',
      mode: 'wathc',
    }),
    /wathc/,
  );
});

test('a watch start over a BROKEN file still returns a live watcher, so fixing the file rebuilds', async () => {
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
    assert.equal(typeof result.dispose, 'function', 'a dispose came back');

    fs.writeFileSync(entry, 'export default "FIXED_SENTINEL";\n');
    await waitFor(reads(outfile, 'FIXED_SENTINEL'), 'the rebuild after the syntax error was fixed');
  } finally {
    await result.dispose();
  }
});

test('starting a watch builds ONCE — one timing line, not two', async () => {
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
    assert.equal(timing.length, 1, `exactly one timing line, got ${timing.length}: ${JSON.stringify(timing)}`);
  } finally {
    await result.dispose();
  }
});

test('one entry can name its OUTPUT FILE instead of a directory', async () => {
  const frameworkRoot = makeFramework();
  const sources = makeSources({ 'entry.js': 'export default "OUTFILE_SENTINEL";\n' });
  const outfile = path.join(outdirFor('outfile'), 'nested', 'service-worker.js');

  await bundle({
    frameworkRoot,
    entries: [path.join(sources, 'entry.js')],
    outfile,
    format: 'iife',
  });

  assert.ok(fs.existsSync(outfile), 'the build wrote exactly the named file');
  assert.match(fs.readFileSync(outfile, 'utf8'), /OUTFILE_SENTINEL/);
});

test('an outfile build still gets the composition — minify by mode, the strip, a timing line naming the file', async () => {
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
  assert.match(out, /PROD_SENTINEL/);
  assert.doesNotMatch(out, /DEV_ONLY_SENTINEL/, 'the strip ran');
  assert.doesNotMatch(out, /aVeryLongLocalName/, 'production is minified');
  assert.ok(!fs.existsSync(`${outfile}.map`), 'production ships no sourcemap');
  assert.ok(
    lines.some((line) => line.includes(':bundle]') && line.includes('worker.js')),
    `the timing line names the outfile, got ${JSON.stringify(lines)}`,
  );
});

test('a build that names both an outfile and an outdir throws — the destination cannot be two places', async () => {
  const frameworkRoot = makeFramework();
  const sources = makeSources({ 'entry.js': 'export default 1;\n' });

  await assert.rejects(
    bundle({
      frameworkRoot,
      entries: [path.join(sources, 'entry.js')],
      outdir: outdirFor('both'),
      outfile: path.join(outdirFor('both'), 'entry.js'),
      format: 'esm',
    }),
    /\[devkit bundle\].*(outdir.*outfile|outfile.*outdir)/,
  );
});

test('a build that names NEITHER destination throws rather than letting esbuild guess', async () => {
  const frameworkRoot = makeFramework();
  const sources = makeSources({ 'entry.js': 'export default 1;\n' });

  await assert.rejects(
    bundle({ frameworkRoot, entries: [path.join(sources, 'entry.js')], format: 'esm' }),
    /\[devkit bundle\].*(outdir.*outfile|outfile.*outdir)/,
  );
});

test('a NULL optional option is ABSENT, not an esbuild type error — an unanswered lookup must not crash the build', async () => {
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

  assert.match(fs.readFileSync(path.join(outdir, 'entry.js'), 'utf8'), /NULL_OPTIONS_SENTINEL/);
});

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

test('a build survives the deletion of the directory the process bundled from FIRST (#777)', () => {
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

  assert.equal(child.status, 0, `the build after the deletion failed: ${child.stderr}`);
  assert.match(fs.readFileSync(outfile, 'utf8'), /DEAD_CWD_SENTINEL/);
});

// Every build lane prints what it produced, and each one used to carry its own
// copy of this (extension's bundle task, desktop's bundle and sass tasks).
test('formatBytes speaks the one size vocabulary every build lane prints', () => {
  assert.equal(formatBytes(0), '0B');
  assert.equal(formatBytes(1023), '1023B');
  assert.equal(formatBytes(1024), '1.0kB');
  assert.equal(formatBytes(1536), '1.5kB');
  assert.equal(formatBytes(1024 * 1024), '1.00MB');
  assert.equal(formatBytes(1024 * 1024 * 1.5), '1.50MB');
});
