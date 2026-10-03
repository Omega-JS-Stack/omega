/**
 * bundle()'s browser floor and its source maps: a build that names no target
 * is lowered to the floor (es2020), a caller's own target wins, and a
 * production build leaves a public `.map` beside every file it writes.
 *
 * Fixture framework roots live under `.temp/`, as in bundle.test.js: only a
 * path inside this monorepo resolves the installed esbuild.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { bundle } = require('../src/bundle.js');

const TEMP = path.join(__dirname, '..', '.temp', `bundle-target-${process.pid}`);

// An es2021 form: logical assignment. es2020 has `??` but not `??=`.
const LOGICAL_ASSIGNMENT = 'export function pick(a, b) {\n  a ??= b;\n  return a;\n}\n';

let counter = 0;

function makeDir(name, files = {}) {
  const dir = path.join(TEMP, `${name}-${counter += 1}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, contents] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), contents);
  return dir;
}

function makeFramework() {
  return makeDir('framework', { 'package.json': JSON.stringify({ name: '@omega.js/fixture' }) });
}

function jsFiles(dir) {
  return fs.readdirSync(dir, { recursive: true }).filter((rel) => rel.endsWith('.js')).map((rel) => path.join(dir, rel));
}

test.after(() => fs.rmSync(TEMP, { recursive: true, force: true }));

test('a build with no target lowers an es2021 form to es2020', async () => {
  const frameworkRoot = makeFramework();
  const sources = makeDir('sources', { 'entry.js': LOGICAL_ASSIGNMENT });
  const outdir = makeDir('out');

  await bundle({ frameworkRoot, entries: [path.join(sources, 'entry.js')], outdir, format: 'esm', dev: true });

  const out = fs.readFileSync(path.join(outdir, 'entry.js'), 'utf8');
  assert.doesNotMatch(out, /\?\?=/, 'the logical assignment is gone');
  assert.match(out, /a \?\? \(a = b\)/, 'rewritten as its es2020 form');
});

test("a caller's own target is used, not the default", async () => {
  const frameworkRoot = makeFramework();
  const sources = makeDir('sources', { 'entry.js': LOGICAL_ASSIGNMENT });
  const outdir = makeDir('out');

  await bundle({ frameworkRoot, entries: [path.join(sources, 'entry.js')], outdir, format: 'esm', dev: true, target: 'es2022' });

  assert.match(fs.readFileSync(path.join(outdir, 'entry.js'), 'utf8'), /a \?\?= b/);
});

test('a node build with no target keeps esbuild\'s default, not the browser floor', async () => {
  const frameworkRoot = makeFramework();
  const sources = makeDir('sources', { 'entry.js': LOGICAL_ASSIGNMENT });
  const outdir = makeDir('out');

  await bundle({ frameworkRoot, entries: [path.join(sources, 'entry.js')], outdir, platform: 'node', format: 'cjs', dev: true });

  assert.match(fs.readFileSync(path.join(outdir, 'entry.js'), 'utf8'), /a \?\?= b/);
});

test('a production build leaves a .map beside every file and ends each with its sourceMappingURL', async () => {
  const frameworkRoot = makeFramework();
  // Two entries sharing a module, so splitting writes a chunk as well.
  const sources = makeDir('sources', {
    'shared.js': 'export const shared = () => "SHARED_SENTINEL";\n',
    'one.js': 'import { shared } from "./shared.js";\nexport default shared() + "ONE";\n',
    'two.js': 'import { shared } from "./shared.js";\nexport default shared() + "TWO";\n',
    'worker.js': 'self.addEventListener("install", () => self.skipWaiting());\n',
  });
  const outdir = makeDir('out');
  const outfile = path.join(makeDir('out'), 'service-worker.js');

  await bundle({
    frameworkRoot,
    entries: [path.join(sources, 'one.js'), path.join(sources, 'two.js')],
    outdir,
    format: 'esm',
    splitting: true,
  });
  await bundle({ frameworkRoot, entries: [path.join(sources, 'worker.js')], outfile, format: 'iife' });

  const outputs = [...jsFiles(outdir), outfile];
  assert.ok(outputs.length >= 4, `two entries, a chunk and the worker, got ${outputs.map((file) => path.basename(file))}`);
  for (const file of outputs) {
    const name = path.basename(file);
    assert.ok(fs.existsSync(`${file}.map`), `${name}.map sits beside ${name}`);
    assert.ok(fs.readFileSync(file, 'utf8').trimEnd().endsWith(`//# sourceMappingURL=${name}.map`), `${name} ends with its sourceMappingURL`);
  }
});
