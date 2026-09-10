/**
 * Brand-root `omega test` fan-out (C5 brand layer) — real execution over a
 * staged fixture brand: fake framework packages whose `omega` bins record
 * every invocation (cwd + argv) to a log, so routing, forwarding, and exit
 * aggregation are asserted from what actually got spawned.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testCommand = require('../src/commands/test.js');

// ─── Fixture staging ─────────────────────────────────────────────────────────

/**
 * Fake framework bin: appends { name, cwd, argv } to <brand>/calls.log and
 * exits 1 when <brand>/FAIL-<name> exists.
 */
function fakeBinSource(name) {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const brandRoot = path.resolve(__dirname, '..', '..', '..');
fs.appendFileSync(path.join(brandRoot, 'calls.log'), JSON.stringify({
  name: ${JSON.stringify(name)},
  cwd: process.cwd(),
  argv: process.argv.slice(2),
  fanout: process.env.OMEGA_TEST_FANOUT || null,
}) + '\\n');
if (fs.existsSync(path.join(brandRoot, 'FAIL-' + ${JSON.stringify(name)}))) process.exit(1);
// A target CLI whose scope named a path it does not carry answers with the
// distinct no-match code under the fan-out signal (#814).
if (fs.existsSync(path.join(brandRoot, 'NOMATCH-' + ${JSON.stringify(name)}))) process.exit(3);
`;
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

/**
 * Stage a brand monorepo with a web target (dep in its own package.json) and a
 * backend target (functions/ layout), plus fake @omega.js/web + @omega.js/backend
 * packages hoisted to the brand root.
 */
function stageBrand({ backend = {}, backendScripts, lanes = {}, brandE2e } = {}) {
  // realpath: macOS tmpdir is a symlink (/var → /private/var) and spawned
  // children report the real cwd
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-test-cmd-')));
  const brand = path.join(scratch, 'brand');

  write(path.join(brand, 'package.json'), JSON.stringify({
    name: 'fixture-brand', private: true, workspaces: ['targets/*'],
  }));
  write(path.join(brand, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: {}, backend: ${JSON.stringify(backend)} },
}
`);

  write(path.join(brand, 'targets', 'website', 'package.json'), JSON.stringify({
    name: 'website', private: true, devDependencies: { '@omega.js/web': '*' },
  }));
  write(path.join(brand, 'targets', 'website', 'config', 'omega.json5'), '{ targets: { web: {} } }\n');

  // Target-root manifest (src/dist pillar): the backend's framework dep is a
  // RUNTIME dependency on the ONE target package.json — no functions/ manifest.
  write(path.join(brand, 'targets', 'backend', 'package.json'), JSON.stringify({
    name: 'backend', private: true, dependencies: { '@omega.js/backend': '*' },
    ...(backendScripts ? { scripts: backendScripts } : {}),
  }));
  write(path.join(brand, 'targets', 'backend', 'config', 'omega.json5'), '{ targets: { backend: {} } }\n');

  for (const [pkg, short] of [['@omega.js/web', 'web'], ['@omega.js/backend', 'backend']]) {
    const pkgDir = path.join(brand, 'node_modules', pkg);
    write(path.join(pkgDir, 'package.json'), JSON.stringify({
      name: pkg, bin: { omega: './bin.js' },
      // A framework declares the opt-in lanes it serves (#775) — the brand
      // root reads it to know which targets a --lane run applies to.
      ...(lanes[pkg] ? { omega: { testLanes: lanes[pkg] } } : {}),
    }));
    write(path.join(pkgDir, 'bin.js'), fakeBinSource(short));
  }

  // The brand's OWN e2e lane (#775): test/e2e/run.js, recording like a bin
  // (two levels up to the brand root, not three — it is not in node_modules).
  if (brandE2e === 'entry' || brandE2e === 'failing') {
    write(path.join(brand, 'test', 'e2e', 'run.js'), fakeBinSource('brand-e2e').replace("'..', '..', '..'", "'..', '..'"));
    if (brandE2e === 'failing') write(path.join(brand, 'FAIL-brand-e2e'), '');
  } else if (brandE2e === 'dir-only') {
    write(path.join(brand, 'test', 'e2e', 'helpers.js'), '');
  }

  return { scratch, brand };
}

function readCalls(brand) {
  const logPath = path.join(brand, 'calls.log');
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

/** Run the command from `cwd` with positional targets, restoring cwd + exitCode. */
async function runTestCommand(cwd, targets, flags = {}) {
  const cwd0 = process.cwd();
  process.chdir(cwd);
  try {
    await testCommand({ _: ['test', ...targets], ...flags });
    return process.exitCode;
  } finally {
    // The verb tees to <brandRoot>/logs/<verb>.log (#623) — release the writers
    // so the next case starts from an unpatched stdout.
    require('@omega.js/devkit/attach-log-file').detach();
    process.chdir(cwd0);
    process.exitCode = undefined;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('bare run fans out to every target: each spawned bare, in its own cwd', async () => {
  const { brand } = stageBrand();
  const code = await runTestCommand(brand, []);

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  assert.deepEqual(new Set(calls.map((c) => c.name)), new Set(['web', 'backend']));
  for (const call of calls) {
    assert.deepEqual(call.argv, ['test'], 'bare per-target: only the test command, no ids');
  }
  const byName = Object.fromEntries(calls.map((c) => [c.name, c]));
  assert.equal(byName.web.cwd, path.join(brand, 'targets', 'website'));
  assert.equal(byName.backend.cwd, path.join(brand, 'targets', 'backend'));
  assert.equal(code, undefined, 'all targets green → no error exit code');
});

test('per-framework id routes ONLY to the owning target, id forwarded verbatim', async () => {
  const { brand } = stageBrand();
  await runTestCommand(brand, ['web:pages/']);

  const calls = readCalls(brand);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'web');
  assert.deepEqual(calls[0].argv, ['test', 'web:pages/']);
});

test('universal framework: forwards to every target', async () => {
  const { brand } = stageBrand();
  await runTestCommand(brand, ['framework:']);

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['test', 'framework:']);
  }
});

test('mixed ids: shared paths to every target, id-scoped only to its owner', async () => {
  const { brand } = stageBrand();
  await runTestCommand(brand, ['backend:routes/x', 'checkout']);

  const byName = Object.fromEntries(readCalls(brand).map((c) => [c.name, c]));
  assert.deepEqual(byName.backend.argv, ['test', 'checkout', 'backend:routes/x']);
  assert.deepEqual(byName.web.argv, ['test', 'checkout']);
});

test('id with no matching target: warns, runs nothing, exits clean (target-level filter parity)', async () => {
  const { brand } = stageBrand();
  const code = await runTestCommand(brand, ['desktop:']);

  assert.deepEqual(readCalls(brand), []);
  assert.equal(code, undefined);
});

test('only-invalid targets fall back to bare-everywhere (scope.js parity)', async () => {
  const { brand } = stageBrand();
  await runTestCommand(brand, ['framwork:oops']);

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['test']);
  }
});

test('a failing target fails the run, but every target still runs (sequential, no bail)', async () => {
  const { brand } = stageBrand();
  fs.writeFileSync(path.join(brand, 'FAIL-backend'), '');
  const code = await runTestCommand(brand, []);

  assert.equal(readCalls(brand).length, 2, 'web still ran after the backend failure');
  assert.equal(code, 1);
});

test('#814: a PATH whose framework has no target in this brand fails the run', async () => {
  // Zero runs executed and a path was named: nothing was tested, which is the
  // same typo the target-level rule catches. A bare prefix (`desktop:`) names
  // no file and keeps its warning + exit 0, one case above.
  const { brand } = stageBrand();
  const code = await runTestCommand(brand, ['desktop:renderer/typo']);

  assert.deepEqual(readCalls(brand), [], 'no target could be asked');
  assert.equal(code, 1);

  const log = fs.readFileSync(path.join(brand, 'logs', 'test.log'), 'utf8');
  assert.match(log, /No target matches the requested scope/, 'the warning still says which scope missed');
  assert.match(log, /\[@omega\.js\/manager:test\] No test file matches "desktop:renderer\/typo"\./);
});

test('#814: the fan-out signal rides every forwarded run', async () => {
  // The signal is what lets a target tell "this brand root asked every target"
  // from "a human asked me": a miss is a no-op there and a failure here.
  const { brand } = stageBrand();
  await runTestCommand(brand, ['checkout']);

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.fanout, '1', call.name);
  }
  assert.equal(process.env.OMEGA_TEST_FANOUT, undefined, 'the signal does not outlive the run');
});

test('#814: a target that answers no-match is a no-op when another target matched', async () => {
  const { brand } = stageBrand();
  fs.writeFileSync(path.join(brand, 'NOMATCH-web'), '');
  const code = await runTestCommand(brand, ['checkout']);

  assert.equal(readCalls(brand).length, 2, 'both targets were still asked');
  assert.equal(code, undefined, 'the backend carried the path, so the run is green');
});

test('#814: when EVERY target misses, the brand run fails and names the target', async () => {
  const { brand } = stageBrand();
  fs.writeFileSync(path.join(brand, 'NOMATCH-web'), '');
  fs.writeFileSync(path.join(brand, 'NOMATCH-backend'), '');
  const code = await runTestCommand(brand, ['checkout']);

  assert.equal(code, 1, 'a path no target carries is a typo, not a quiet green');

  const log = fs.readFileSync(path.join(brand, 'logs', 'test.log'), 'utf8');
  assert.match(log, /\[@omega\.js\/manager:test\] No test file matches "checkout"\./);
});

test('#814: a miss beside a real failure still fails the run', async () => {
  const { brand } = stageBrand();
  fs.writeFileSync(path.join(brand, 'NOMATCH-web'), '');
  fs.writeFileSync(path.join(brand, 'FAIL-backend'), '');
  const code = await runTestCommand(brand, ['checkout']);

  assert.equal(code, 1);
});

test('outside any brand: errors with exit 1', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-test-cmd-nobrand-'));
  const code = await runTestCommand(scratch, []);
  assert.equal(code, 1);
});

test('cli routes `test` through ALIASES to the command file', () => {
  const Main = require('../src/cli.js');
  assert.ok(Object.prototype.hasOwnProperty.call(Main.config.aliases, 'test'));
  assert.ok(fs.existsSync(path.join(Main.config.commandsDir, 'test.js')));
});

// ─── A backend in custom-server mode (#584) ──────────────────────────────────

// Its framework `omega test` is the EMULATOR lane and refuses in that mode, so
// the fan-out runs the target's own `test` script instead — the same lane a
// custom target takes, scope vocabulary and all.
const RECORDING_SCRIPT = "node -e \"require('fs').appendFileSync(require('path').join(process.cwd(),'..','..','calls.log'), JSON.stringify({name:'backend-script',cwd:process.cwd(),argv:process.argv.slice(1)})+'\\n')\"";

test("custom-server backend: a bare run takes its own `test` script, and no framework id is forwarded", async () => {
  const { brand } = stageBrand({ backend: { projectType: 'custom' }, backendScripts: { test: RECORDING_SCRIPT } });

  await runTestCommand(brand, []);

  const calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name).sort(), ['backend-script', 'web'], 'the backend ran its script, the website its framework bin');
  const script = calls.find((c) => c.name === 'backend-script');
  assert.equal(script.cwd, path.join(brand, 'targets', 'backend'));
  assert.deepEqual(script.argv, [], 'a package script hears no scope ids and no flags');
});

test('custom-server backend: a SCOPED run never addresses it — the scope vocabulary is the frameworks\'', async () => {
  const { brand } = stageBrand({ backend: { projectType: 'custom' }, backendScripts: { test: RECORDING_SCRIPT } });

  await runTestCommand(brand, ['backend:']);

  assert.deepEqual(readCalls(brand), [], 'nothing ran: the scoped id means nothing to a package script');
});

test('custom-server backend with no `test` script: skipped loudly on a bare run, never failed', async () => {
  const { brand } = stageBrand({ backend: { projectType: 'custom' } });

  const code = await runTestCommand(brand, []);

  assert.deepEqual(readCalls(brand).map((c) => c.name), ['web'], 'only the website ran');
  assert.equal(code, undefined, 'an absent script is a brand that has not wired it, not a failure');
});

// ─── The --target picker (#775) ──────────────────────────────────────────────

test('--target narrows a bare run to the named targets, by key or by dir name', async () => {
  const byKey = stageBrand().brand;
  await runTestCommand(byKey, [], { target: 'web' });
  assert.deepEqual(readCalls(byKey).map((c) => c.name), ['web']);

  const byDir = stageBrand().brand;
  await runTestCommand(byDir, [], { target: 'website' });
  assert.deepEqual(readCalls(byDir).map((c) => c.name), ['web'], 'the dir name matches too');
});

test('--target narrows a framework: run the same way it narrows a bare one', async () => {
  const { brand } = stageBrand();
  await runTestCommand(brand, ['framework:'], { target: 'backend' });

  const calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name), ['backend']);
  assert.deepEqual(calls[0].argv, ['test', 'framework:'], 'the scope still forwards verbatim');
});

test('--target composes with a full: run, keeping both sources on the picked target', async () => {
  const { brand } = stageBrand();
  await runTestCommand(brand, ['full:auth'], { target: 'web,website' });

  const calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name), ['web'], 'a target named twice still runs once');
  assert.deepEqual(calls[0].argv, ['test', 'full:auth']);
});

test('a framework scope whose owner --target excludes REFUSES, and nothing ran', async () => {
  const { brand } = stageBrand();

  await assert.rejects(
    () => runTestCommand(brand, ['web:pages/'], { target: 'backend' }),
    (error) => {
      assert.equal(error.refusal, true, 'a refusal prints its message alone (no stack)');
      assert.match(error.message, /refusing --target=backend beside the "web:pages\/" scope/);
      assert.match(error.message, /targets\/website owns that framework/);
      return true;
    },
  );

  assert.deepEqual(readCalls(brand), []);
});

test('a framework scope whose owner --target includes runs normally', async () => {
  const { brand } = stageBrand();
  await runTestCommand(brand, ['web:pages/'], { target: 'web' });

  assert.deepEqual(readCalls(brand).map((c) => c.name), ['web']);
});

// The retired pickers (#780) — the same refusal every other brand-root verb
// gives: never ignored, never aliased onto --target=
test('--only and --except are REFUSED, naming --target=; nothing ran', async () => {
  const { brand } = stageBrand();

  await assert.rejects(
    () => runTestCommand(brand, [], { only: 'web' }),
    (error) => {
      assert.equal(error.refusal, true, 'a refusal prints its message alone (no stack)');
      assert.match(error.message, /--only is retired: pick targets with --target=/);
      return true;
    },
  );
  await assert.rejects(() => runTestCommand(brand, [], { except: 'backend' }), /--except is retired/);

  assert.deepEqual(readCalls(brand), []);
});

test('an unknown --target token STOPS the run — never a matched subset, never test-everything', async () => {
  const { brand } = stageBrand();

  await assert.rejects(
    () => runTestCommand(brand, [], { target: 'mobile' }),
    (error) => {
      assert.equal(error.refusal, true, 'a refusal prints its message alone (no stack)');
      assert.match(error.message, /Unknown --target token "mobile"/);
      assert.match(error.message, /this brand's targets are backend, web/, 'the error names what the brand actually has');
      return true;
    },
  );

  // A typo beside a real target never tests the matched half — a green exit
  // must never stand for a target that was silently dropped
  await assert.rejects(() => runTestCommand(brand, [], { target: 'web,mobile' }), /Unknown --target token "mobile"/);

  assert.deepEqual(readCalls(brand), []);
});

// ─── Mode flags fan out (#775) ───────────────────────────────────────────────

test('--extended reaches every target', async () => {
  const { brand } = stageBrand();
  await runTestCommand(brand, [], { extended: true });

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['test', '--extended']);
  }
});

test('--extended rides ahead of the forwarded scope ids', async () => {
  const { brand } = stageBrand();
  await runTestCommand(brand, ['backend:payments'], { extended: true });

  const calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name), ['backend']);
  assert.deepEqual(calls[0].argv, ['test', '--extended', 'backend:payments']);
});

test('--lane reaches only the frameworks that DECLARE it; the rest are a clean skip', async () => {
  const { brand } = stageBrand({ lanes: { '@omega.js/backend': ['stripe-live'] } });
  const code = await runTestCommand(brand, [], { lane: 'stripe-live' });

  const calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name), ['backend']);
  assert.deepEqual(calls[0].argv, ['test', '--lane=stripe-live']);
  assert.equal(code, undefined, 'a target with no such lane is not a failure');
});

test('a --lane no framework declares runs nothing and still exits clean', async () => {
  const { brand } = stageBrand({ lanes: { '@omega.js/backend': ['stripe-live'] } });
  const code = await runTestCommand(brand, [], { lane: 'nonexistent' });

  assert.deepEqual(readCalls(brand), []);
  assert.equal(code, undefined);
});

test('a --lane run never addresses a custom-server backend\'s own test script', async () => {
  const { brand } = stageBrand({ backend: { projectType: 'custom' }, backendScripts: { test: RECORDING_SCRIPT } });
  await runTestCommand(brand, [], { lane: 'stripe-live' });

  assert.deepEqual(readCalls(brand), [], 'a package script has no lane vocabulary');
});

// ─── The brand's own e2e lane (#775) ─────────────────────────────────────────

test('a bare run walks <brandRoot>/test/e2e/run.js LAST, from the brand root', async () => {
  const { brand } = stageBrand({ brandE2e: 'entry' });
  const code = await runTestCommand(brand, []);

  const calls = readCalls(brand);
  assert.deepEqual(calls.map((c) => c.name).slice(-1), ['brand-e2e'], 'after every target');
  assert.equal(calls.length, 3);
  const lane = calls[2];
  assert.equal(lane.cwd, brand);
  assert.deepEqual(lane.argv, [], 'a runner script hears no scope ids and no flags');
  assert.equal(code, undefined);
});

test('a failing brand e2e lane fails the whole run', async () => {
  const { brand } = stageBrand({ brandE2e: 'failing' });
  const code = await runTestCommand(brand, []);

  assert.equal(code, 1);
});

test('a scoped, picked or laned run never addresses the brand e2e lane', async () => {
  const scoped = stageBrand({ brandE2e: 'entry' }).brand;
  await runTestCommand(scoped, ['framework:']);
  assert.equal(readCalls(scoped).some((c) => c.name === 'brand-e2e'), false);

  const picked = stageBrand({ brandE2e: 'entry' }).brand;
  await runTestCommand(picked, [], { target: 'web' });
  assert.equal(readCalls(picked).some((c) => c.name === 'brand-e2e'), false);

  const laned = stageBrand({ brandE2e: 'entry', lanes: { '@omega.js/backend': ['stripe-live'] } }).brand;
  await runTestCommand(laned, [], { lane: 'stripe-live' });
  assert.equal(readCalls(laned).some((c) => c.name === 'brand-e2e'), false);
});

test('a test/e2e/ directory with no run.js is skipped loudly, never failed', async () => {
  const { brand } = stageBrand({ brandE2e: 'dir-only' });
  const code = await runTestCommand(brand, []);

  assert.deepEqual(readCalls(brand).map((c) => c.name).sort(), ['backend', 'web']);
  assert.equal(code, undefined);
});

test('a brand with no test/e2e/ at all runs its targets and nothing else', async () => {
  const { brand } = stageBrand();
  await runTestCommand(brand, []);

  assert.equal(readCalls(brand).length, 2);
});

// ─── The real CLI parse, not just the options object (#775) ──────────────────

test('`omega test --extended full:` parses as a value-less flag and still carries the scope', async () => {
  const { BOOLEAN_FLAGS } = require('../src/cli-run.js');
  assert.ok(BOOLEAN_FLAGS.includes('extended'), '--extended takes no value — it must be declared boolean');

  // The parse the bin really performs. Undeclared, yargs reads the next
  // positional as the flag's VALUE: `extended: 'full:'` with the scope gone,
  // which ran every target BARE while looking like it had been asked for both.
  const argv = require('yargs')(['test', '--extended', 'full:'])
    .boolean(BOOLEAN_FLAGS).version(false).help(false).parseSync();

  assert.equal(argv.extended, true);
  assert.deepEqual(argv._, ['test', 'full:'], 'the scope stayed a positional');

  // …and that argv drives the fan-out for real
  const { brand } = stageBrand();
  const cwd0 = process.cwd();
  process.chdir(brand);
  try {
    await testCommand(argv);
  } finally {
    require('@omega.js/devkit/attach-log-file').detach();
    process.chdir(cwd0);
    process.exitCode = undefined;
  }

  const calls = readCalls(brand);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.argv, ['test', '--extended', 'full:']);
  }
});

test('the value-taking flags stay value-taking through the same parse', () => {
  const { BOOLEAN_FLAGS } = require('../src/cli-run.js');
  const argv = require('yargs')(['test', '--target=web,backend', '--lane=stripe-live'])
    .boolean(BOOLEAN_FLAGS).version(false).help(false).parseSync();

  assert.equal(argv.target, 'web,backend');
  assert.equal(argv.lane, 'stripe-live');
  assert.equal(BOOLEAN_FLAGS.includes('target'), false, 'a picker with a value must never be boolean');
  assert.equal(BOOLEAN_FLAGS.includes('lane'), false);
});
