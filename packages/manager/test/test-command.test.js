/**
 * Brand-root `omega test` fan-out (C5 brand layer) — real execution over a
 * staged fixture brand: fake framework packages whose `omega` bins record
 * every invocation (cwd + argv) to a log, so routing, forwarding, and exit
 * aggregation are asserted from what actually got spawned.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { withoutCI } = require('@omega.js/devkit/test/without-ci');

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
 * The target's own `omega` on its npm-script PATH, pointing at the fake
 * framework bin: `npm run test` in the target reaches it as `omega test`.
 */
function linkTargetBin(brand, target, pkg) {
  const binDir = path.join(brand, 'targets', target, 'node_modules', '.bin');
  const bin = path.join(brand, 'node_modules', pkg, 'bin.js');
  fs.chmodSync(bin, 0o755);
  fs.mkdirSync(binDir, { recursive: true });
  fs.symlinkSync(bin, path.join(binDir, 'omega'));
}

/**
 * Stage a brand monorepo with a web target (dep in its own package.json) and a
 * backend target (functions/ layout), plus fake @omega.js/web + @omega.js/backend
 * packages hoisted to the brand root; `extension` adds an extension target the same way.
 */
function stageBrand({ backend = {}, backendScripts, lanes = {}, brandE2e, extension = false } = {}) {
  // realpath: macOS tmpdir is a symlink (/var → /private/var) and spawned
  // children report the real cwd
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-test-cmd-')));
  const brand = path.join(scratch, 'brand');

  write(path.join(brand, 'package.json'), JSON.stringify({
    name: 'fixture-brand', private: true, workspaces: ['targets/*'],
  }));
  write(path.join(brand, 'config', 'omega.json5'), `{
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
  targets: { web: { type: 'web' }, backend: ${JSON.stringify({ type: 'backend', ...backend })}${extension ? ", extension: { type: 'extension' }" : ''} },
}
`);

  write(path.join(brand, 'targets', 'web', 'package.json'), JSON.stringify({
    name: 'web', private: true, devDependencies: { '@omega.js/web': '*' }, scripts: { test: 'omega test' },
  }));

  // Target-root manifest (src/dist pillar): the backend's framework dep is a
  // RUNTIME dependency on the ONE target package.json — no functions/ manifest.
  write(path.join(brand, 'targets', 'backend', 'package.json'), JSON.stringify({
    name: 'backend', private: true, dependencies: { '@omega.js/backend': '*' },
    scripts: backendScripts === undefined ? { test: 'omega test' } : backendScripts,
  }));


  const frameworks = [['@omega.js/web', 'web'], ['@omega.js/backend', 'backend']];
  if (extension) {
    write(path.join(brand, 'targets', 'extension', 'package.json'), JSON.stringify({
      name: 'extension', private: true, devDependencies: { '@omega.js/extension': '*' }, scripts: { test: 'omega test' },
    }));
    frameworks.push(['@omega.js/extension', 'extension']);
  }

  for (const [pkg, short] of frameworks) {
    const pkgDir = path.join(brand, 'node_modules', pkg);
    write(path.join(pkgDir, 'package.json'), JSON.stringify({
      name: pkg, bin: { omega: './bin.js' },
      // A framework declares the opt-in lanes it serves (#775) — the brand
      // root reads it to know which targets a --lane run applies to.
      ...(lanes[pkg] ? { omega: { testLanes: lanes[pkg] } } : {}),
    }));
    write(path.join(pkgDir, 'bin.js'), fakeBinSource(short));
    linkTargetBin(brand, short, pkg);
  }

  // The brand's OWN e2e lane: a defineCases suite in test/e2e/, run in-process,
  // so its first case records this process's pid; FAIL-brand-e2e fails its second.
  if (brandE2e === 'suite' || brandE2e === 'failing') {
    write(path.join(brand, 'test', 'e2e', 'a.test.js'), BRAND_SUITE_SOURCE);
    if (brandE2e === 'failing') write(path.join(brand, 'FAIL-brand-e2e'), '');
  } else if (brandE2e === 'run-js') {
    write(path.join(brand, 'test', 'e2e', 'run.js'), fakeBinSource('brand-e2e').replace("'..', '..', '..'", "'..', '..'"));
  } else if (brandE2e === 'dir-only') {
    write(path.join(brand, 'test', 'e2e', 'helpers.js'), '');
  }

  return { scratch, brand };
}

const BRAND_SUITE_SOURCE = `const defineCases = require(${JSON.stringify(require.resolve('@omega.js/devkit/test/define-cases'))});
const fs = require('fs');
const path = require('path');
const brandRoot = path.join(__dirname, '..', '..');
module.exports = defineCases({
  type: 'suite',
  description: 'brand e2e fixture',
  tests: [
    {
      name: 'records its run',
      run: () => {
        fs.appendFileSync(path.join(brandRoot, 'calls.log'), JSON.stringify({ name: 'brand-e2e', cwd: process.cwd(), pid: process.pid }) + '\\n');
      },
    },
    {
      name: 'fails when the brand asks it to',
      run: (ctx) => {
        ctx.expect(fs.existsSync(path.join(brandRoot, 'FAIL-brand-e2e')), 'FAIL-brand-e2e').toBe(false);
      },
    },
  ],
});
`;

function readCalls(brand) {
  const logPath = path.join(brand, 'calls.log');
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

/** The walk summary's `✓`/`✗` row for `name` in the brand's logs/test.log, or null. */
function summaryRow(brand, name) {
  const log = fs.readFileSync(path.join(brand, 'logs', 'test.log'), 'utf8');
  const lines = log.split('\n').map((line) => line.trim());
  return lines.find((line) => line.startsWith(`✓ ${name}`) || line.startsWith(`✗ ${name}`)) || null;
}

/** Run the command from `cwd` with positional targets, restoring cwd + exitCode. */
async function runTestCommand(cwd, targets, flags = {}) {
  const cwd0 = process.cwd();
  const restoreTee = require('@omega.js/devkit/attach-log-file').mark();
  process.chdir(cwd);
  try {
    // The tee declines under a runner; the cases read logs/test.log on every machine.
    await withoutCI(() => testCommand({ _: ['test', ...targets], ...flags }));
    return process.exitCode;
  } finally {
    // The verb tees to <brandRoot>/logs/<verb>.log (#623) — release the writers
    // so the next case starts from an unpatched stdout.
    restoreTee();
    process.chdir(cwd0);
    process.exitCode = undefined;
  }
}

// ─── A backend in custom-server mode (#584) ──────────────────────────────────

// It is a framework target like any other: the fan-out runs its own `test`
// script, which in this mode is the brand's command, the scope after `--`.
const RECORDING_SCRIPT = "node -e \"require('fs').appendFileSync(require('path').join(process.cwd(),'..','..','calls.log'), JSON.stringify({name:'backend-script',cwd:process.cwd(),argv:process.argv.slice(1)})+'\\n')\"";

module.exports = defineCases({
  type: 'group',
  description: 'test-command',
  tests: [
    // ─── Tests ───────────────────────────────────────────────────────────────────

    {
      name: 'bare run fans out to every target: each spawned bare, in its own cwd',
      run: async (ctx) => {
        const { brand } = stageBrand();
        const code = await runTestCommand(brand, []);

        const calls = readCalls(brand);
        ctx.expect(calls.length).toBe(2);
        ctx.expect(new Set(calls.map((c) => c.name))).toEqual(new Set(['web', 'backend']));
        for (const call of calls) {
          ctx.expect(call.argv, 'bare per-target: only the test command, no ids').toEqual(['test']);
        }
        const byName = Object.fromEntries(calls.map((c) => [c.name, c]));
        ctx.expect(byName.web.cwd).toBe(path.join(brand, 'targets', 'web'));
        ctx.expect(byName.backend.cwd).toBe(path.join(brand, 'targets', 'backend'));
        ctx.expect(code, 'all targets green → no error exit code').toBe(undefined);
      },
    },

    {
      name: 'per-framework id routes ONLY to the owning target, id forwarded verbatim',
      run: async (ctx) => {
        const { brand } = stageBrand();
        await runTestCommand(brand, ['web:pages/']);

        const calls = readCalls(brand);
        ctx.expect(calls.length).toBe(1);
        ctx.expect(calls[0].name).toBe('web');
        ctx.expect(calls[0].argv).toEqual(['test', 'web:pages/']);
      },
    },

    {
      name: 'universal framework: forwards to every target',
      run: async (ctx) => {
        const { brand } = stageBrand();
        await runTestCommand(brand, ['framework:']);

        const calls = readCalls(brand);
        ctx.expect(calls.length).toBe(2);
        for (const call of calls) {
          ctx.expect(call.argv).toEqual(['test', 'framework:']);
        }
      },
    },

    {
      name: 'mixed ids: shared paths to every target, id-scoped only to its owner',
      run: async (ctx) => {
        const { brand } = stageBrand();
        await runTestCommand(brand, ['backend:routes/x', 'checkout']);

        const byName = Object.fromEntries(readCalls(brand).map((c) => [c.name, c]));
        ctx.expect(byName.backend.argv).toEqual(['test', 'checkout', 'backend:routes/x']);
        ctx.expect(byName.web.argv).toEqual(['test', 'checkout']);
      },
    },

    {
      name: 'id with no matching target: warns, runs nothing, exits clean (target-level filter parity)',
      run: async (ctx) => {
        const { brand } = stageBrand();
        const code = await runTestCommand(brand, ['desktop:']);

        ctx.expect(readCalls(brand)).toEqual([]);
        ctx.expect(code).toBe(undefined);
      },
    },

    {
      name: 'only-invalid targets fall back to bare-everywhere (scope.js parity)',
      run: async (ctx) => {
        const { brand } = stageBrand();
        await runTestCommand(brand, ['framwork:oops']);

        const calls = readCalls(brand);
        ctx.expect(calls.length).toBe(2);
        for (const call of calls) {
          ctx.expect(call.argv).toEqual(['test']);
        }
      },
    },

    {
      name: 'a failing target fails the run, but every target still runs (sequential, no bail)',
      run: async (ctx) => {
        const { brand } = stageBrand();
        fs.writeFileSync(path.join(brand, 'FAIL-backend'), '');
        const code = await runTestCommand(brand, []);

        ctx.expect(readCalls(brand).length, 'web still ran after the backend failure').toBe(2);
        ctx.expect(code).toBe(1);
      },
    },

    {
      name: '#814: a PATH whose framework has no target in this brand fails the run',
      run: async (ctx) => {
        // Zero runs executed and a path was named: nothing was tested, which is the
        // same typo the target-level rule catches. A bare prefix (`desktop:`) names
        // no file and keeps its warning + exit 0, one case above.
        const { brand } = stageBrand();
        const code = await runTestCommand(brand, ['desktop:renderer/typo']);

        ctx.expect(readCalls(brand), 'no target could be asked').toEqual([]);
        ctx.expect(code).toBe(1);

        const log = fs.readFileSync(path.join(brand, 'logs', 'test.log'), 'utf8');
        ctx.expect(log, 'the warning still says which scope missed').toMatch(/No target matches the requested scope/);
        ctx.expect(log).toMatch(/\[@omega\.js\/manager:test\] No test file matches "desktop:renderer\/typo"\./);
      },
    },

    {
      name: '#814: the fan-out signal rides every forwarded run',
      run: async (ctx) => {
        // The signal is what lets a target tell "this brand root asked every target"
        // from "a human asked me": a miss is a no-op there and a failure here.
        const { brand } = stageBrand();
        await runTestCommand(brand, ['checkout']);

        const calls = readCalls(brand);
        ctx.expect(calls.length).toBe(2);
        for (const call of calls) {
          ctx.expect(call.fanout, call.name).toBe('1');
        }
        ctx.expect(process.env.OMEGA_TEST_FANOUT, 'the signal does not outlive the run').toBe(undefined);
      },
    },

    {
      name: '#814: a target that answers no-match is a no-op when another target matched',
      run: async (ctx) => {
        const { brand } = stageBrand();
        fs.writeFileSync(path.join(brand, 'NOMATCH-web'), '');
        const code = await runTestCommand(brand, ['checkout']);

        ctx.expect(readCalls(brand).length, 'both targets were still asked').toBe(2);
        ctx.expect(code, 'the backend carried the path, so the run is green').toBe(undefined);
      },
    },

    {
      name: '#814: when EVERY target misses, the brand run fails and names the target',
      run: async (ctx) => {
        const { brand } = stageBrand();
        fs.writeFileSync(path.join(brand, 'NOMATCH-web'), '');
        fs.writeFileSync(path.join(brand, 'NOMATCH-backend'), '');
        const code = await runTestCommand(brand, ['checkout']);

        ctx.expect(code, 'a path no target carries is a typo, not a quiet green').toBe(1);

        const log = fs.readFileSync(path.join(brand, 'logs', 'test.log'), 'utf8');
        ctx.expect(log).toMatch(/\[@omega\.js\/manager:test\] No test file matches "checkout"\./);
      },
    },

    {
      name: '#814: a miss beside a real failure still fails the run',
      run: async (ctx) => {
        const { brand } = stageBrand();
        fs.writeFileSync(path.join(brand, 'NOMATCH-web'), '');
        fs.writeFileSync(path.join(brand, 'FAIL-backend'), '');
        const code = await runTestCommand(brand, ['checkout']);

        ctx.expect(code).toBe(1);
      },
    },

    {
      name: 'outside any brand: errors with exit 1',
      run: async (ctx) => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-test-cmd-nobrand-'));
        const code = await runTestCommand(scratch, []);
        ctx.expect(code).toBe(1);
      },
    },

    {
      name: 'cli routes `test` through ALIASES to the command file',
      run: (ctx) => {
        const Main = require('../src/cli.js');
        ctx.expect(Object.prototype.hasOwnProperty.call(Main.config.aliases, 'test')).toBeTruthy();
        ctx.expect(fs.existsSync(path.join(Main.config.commandsDir, 'test.js'))).toBeTruthy();
      },
    },

    {
      name: 'custom-server backend: a bare run takes its own `test` script, forwarding nothing',
      run: async (ctx) => {
        const { brand } = stageBrand({ backend: { projectType: 'custom' }, backendScripts: { test: RECORDING_SCRIPT } });

        await runTestCommand(brand, []);

        const calls = readCalls(brand);
        ctx.expect(calls.map((c) => c.name).sort(), 'the backend ran its script, the web target its own').toEqual(['backend-script', 'web']);
        const script = calls.find((c) => c.name === 'backend-script');
        ctx.expect(script.cwd).toBe(path.join(brand, 'targets', 'backend'));
        ctx.expect(script.argv, 'a bare run forwards no scope ids and no flags').toEqual([]);
      },
    },

    {
      name: 'custom-server backend: a brand-owned test script runs bare',
      run: async (ctx) => {
        const { brand } = stageBrand({ backend: { projectType: 'custom' }, backendScripts: { test: RECORDING_SCRIPT } });

        // A scope is the frameworks' vocabulary: a scoped run never addresses the brand's script
        await runTestCommand(brand, ['backend:']);
        ctx.expect(readCalls(brand), 'nothing ran: the scoped id means nothing to a package script').toEqual([]);

        // A bare run reaches it, and a mode flag never does
        await runTestCommand(brand, [], { extended: true });
        const script = readCalls(brand).find((c) => c.name === 'backend-script');
        ctx.expect(script.argv, 'the brand\'s script hears no scope and no flags').toEqual([]);
      },
    },

    {
      name: 'custom-server backend with no `test` script: skipped loudly on a bare run, never failed',
      run: async (ctx) => {
        const { brand } = stageBrand({ backend: { projectType: 'custom' }, backendScripts: {} });

        const code = await runTestCommand(brand, []);

        ctx.expect(readCalls(brand).map((c) => c.name), 'only the web target ran').toEqual(['web']);
        ctx.expect(code, 'an absent script is a brand that has not wired it, not a failure').toBe(undefined);
      },
    },

    // ─── The --target picker (#775) ──────────────────────────────────────────────

    {
      name: '--target narrows a bare run to the named targets',
      run: async (ctx) => {
        const { brand } = stageBrand();
        await runTestCommand(brand, [], { target: 'web' });
        ctx.expect(readCalls(brand).map((c) => c.name)).toEqual(['web']);
      },
    },

    {
      name: '--target narrows a framework: run the same way it narrows a bare one',
      run: async (ctx) => {
        const { brand } = stageBrand();
        await runTestCommand(brand, ['framework:'], { target: 'backend' });

        const calls = readCalls(brand);
        ctx.expect(calls.map((c) => c.name)).toEqual(['backend']);
        ctx.expect(calls[0].argv, 'the scope still forwards verbatim').toEqual(['test', 'framework:']);
      },
    },

    {
      name: '--target composes with a full: run, keeping both sources on the picked target',
      run: async (ctx) => {
        const { brand } = stageBrand();
        await runTestCommand(brand, ['full:auth'], { target: 'web,web' });

        const calls = readCalls(brand);
        ctx.expect(calls.map((c) => c.name), 'a target named twice still runs once').toEqual(['web']);
        ctx.expect(calls[0].argv).toEqual(['test', 'full:auth']);
      },
    },

    {
      name: 'a framework scope whose owner --target excludes REFUSES, and nothing ran',
      run: async (ctx) => {
        const { brand } = stageBrand();

        await ctx.expect((() => runTestCommand(brand, ['web:pages/'], { target: 'backend' }))()).rejects.toThrow((error) => {
            ctx.expect(error.refusal, 'a refusal prints its message alone (no stack)').toBe(true);
            ctx.expect(error.message).toMatch(/refusing --target=backend beside the "web:pages\/" scope/);
            ctx.expect(error.message).toMatch(/targets\/web owns that framework/);
            return true;
          });

        ctx.expect(readCalls(brand)).toEqual([]);
      },
    },

    {
      name: 'a framework scope whose owner --target includes runs normally',
      run: async (ctx) => {
        const { brand } = stageBrand();
        await runTestCommand(brand, ['web:pages/'], { target: 'web' });

        ctx.expect(readCalls(brand).map((c) => c.name)).toEqual(['web']);
      },
    },

    // The retired pickers (#780) — the same refusal every other brand-root verb
    // gives: never ignored, never aliased onto --target=
    {
      name: '--only and --except are REFUSED, naming --target=; nothing ran',
      run: async (ctx) => {
        const { brand } = stageBrand();

        await ctx.expect((() => runTestCommand(brand, [], { only: 'web' }))()).rejects.toThrow((error) => {
            ctx.expect(error.refusal, 'a refusal prints its message alone (no stack)').toBe(true);
            ctx.expect(error.message).toMatch(/--only is retired: pick targets with --target=/);
            return true;
          });
        await ctx.expect((() => runTestCommand(brand, [], { except: 'backend' }))()).rejects.toThrow(/--except is retired/);

        ctx.expect(readCalls(brand)).toEqual([]);
      },
    },

    {
      name: 'an unknown --target token STOPS the run — never a matched subset, never test-everything',
      run: async (ctx) => {
        const { brand } = stageBrand();

        await ctx.expect((() => runTestCommand(brand, [], { target: 'mobile' }))()).rejects.toThrow((error) => {
            ctx.expect(error.refusal, 'a refusal prints its message alone (no stack)').toBe(true);
            ctx.expect(error.message).toMatch(/Unknown --target token "mobile"/);
            ctx.expect(error.message, 'the error names what the brand actually has').toMatch(/this brand's targets are backend, web/);
            return true;
          });

        // A typo beside a real target never tests the matched half — a green exit
        // must never stand for a target that was silently dropped
        await ctx.expect((() => runTestCommand(brand, [], { target: 'web,mobile' }))()).rejects.toThrow(/Unknown --target token "mobile"/);

        ctx.expect(readCalls(brand)).toEqual([]);
      },
    },

    // ─── Mode flags fan out (#775) ───────────────────────────────────────────────

    {
      name: '--extended reaches every target',
      run: async (ctx) => {
        const { brand } = stageBrand();
        await runTestCommand(brand, [], { extended: true });

        const calls = readCalls(brand);
        ctx.expect(calls.length).toBe(2);
        for (const call of calls) {
          ctx.expect(call.argv).toEqual(['test', '--extended']);
        }
      },
    },

    {
      name: '--extended rides ahead of the forwarded scope ids',
      run: async (ctx) => {
        const { brand } = stageBrand();
        await runTestCommand(brand, ['backend:payments'], { extended: true });

        const calls = readCalls(brand);
        ctx.expect(calls.map((c) => c.name)).toEqual(['backend']);
        ctx.expect(calls[0].argv).toEqual(['test', '--extended', 'backend:payments']);
      },
    },

    {
      name: '--lane reaches only the frameworks that DECLARE it; the rest are a clean skip',
      run: async (ctx) => {
        const { brand } = stageBrand({ lanes: { '@omega.js/backend': ['stripe-live'] } });
        const code = await runTestCommand(brand, [], { lane: 'stripe-live' });

        const calls = readCalls(brand);
        ctx.expect(calls.map((c) => c.name)).toEqual(['backend']);
        ctx.expect(calls[0].argv).toEqual(['test', '--lane=stripe-live']);
        ctx.expect(code, 'a target with no such lane is not a failure').toBe(undefined);
      },
    },

    {
      name: 'every test flag the root does not own reaches the target after --: --layer, --filter, --offline, an unknown one',
      run: async (ctx) => {
        const { BOOLEAN_FLAGS } = require('../src/cli-run.js');
        const { brand } = stageBrand({ extension: true });
        const { _: positionals, ...flags } = require('@omega.js/devkit/argv').parseArgv(['test', '--layer=background', '--filter=x', '--key=X', '--offline'], { booleans: BOOLEAN_FLAGS });
        const code = await runTestCommand(brand, positionals.slice(1), flags);

        const extension = readCalls(brand).find((call) => call.name === 'extension');
        ctx.expect(extension, 'the extension target ran').toBeTruthy();
        ctx.expect(extension.argv[0]).toBe('test');
        ctx.expect([...extension.argv.slice(1)].sort(), 'a layer pick from the root is never silently the full run').toEqual(['--filter=x', '--key=X', '--layer=background', '--offline']);
        ctx.expect(code).toBe(undefined);
      },
    },

    {
      name: 'a --lane no framework declares runs nothing and still exits clean',
      run: async (ctx) => {
        const { brand } = stageBrand({ lanes: { '@omega.js/backend': ['stripe-live'] } });
        const code = await runTestCommand(brand, [], { lane: 'nonexistent' });

        ctx.expect(readCalls(brand)).toEqual([]);
        ctx.expect(code).toBe(undefined);
      },
    },

    {
      name: 'a --lane run reaches a custom-server backend only when its framework declares the lane',
      run: async (ctx) => {
        const { brand } = stageBrand({ backend: { projectType: 'custom' }, backendScripts: { test: RECORDING_SCRIPT } });
        await runTestCommand(brand, [], { lane: 'stripe-live' });

        ctx.expect(readCalls(brand), 'the backend framework declares no stripe-live lane here').toEqual([]);
      },
    },

    // ─── The brand's own e2e lane: suite files in test/e2e/ ───────────────────────

    {
      name: 'a bare run runs the test/e2e/ suite in-process after every target, its Results block in the log',
      run: async (ctx) => {
        const { brand } = stageBrand({ brandE2e: 'suite' });
        const code = await runTestCommand(brand, []);

        const calls = readCalls(brand);
        ctx.expect(calls.map((c) => c.name), 'after every target').toEqual(['backend', 'web', 'brand-e2e']);
        ctx.expect(calls[2].pid, 'in this process, not a spawned child').toBe(process.pid);
        ctx.expect(code).toBe(undefined);

        const log = fs.readFileSync(path.join(brand, 'logs', 'test.log'), 'utf8');
        ctx.expect(log, 'the runner reports through the walk\'s own tee').toMatch(/Results\s+2 passing/);
        ctx.expect(log).toMatch(/Total: 2 tests in \d+ms/);
      },
    },

    {
      name: 'the walk\'s summary carries a test/e2e row beside the targets',
      run: async (ctx) => {
        const green = stageBrand({ brandE2e: 'suite' }).brand;
        await runTestCommand(green, []);
        ctx.expect(summaryRow(green, 'test/e2e'), 'a green suite').toMatch(/^✓ /);

        const red = stageBrand({ brandE2e: 'failing' }).brand;
        await runTestCommand(red, []);
        ctx.expect(summaryRow(red, 'test/e2e'), 'a failing suite').toMatch(/^✗ /);
      },
    },

    {
      name: 'a failing case in the test/e2e/ suite fails the whole run',
      run: async (ctx) => {
        const { brand } = stageBrand({ brandE2e: 'failing' });
        const code = await runTestCommand(brand, []);

        ctx.expect(readCalls(brand).map((c) => c.name), 'the targets still ran first').toEqual(['backend', 'web', 'brand-e2e']);
        ctx.expect(code).toBe(1);
        const log = fs.readFileSync(path.join(brand, 'logs', 'test.log'), 'utf8');
        ctx.expect(log).toMatch(/1 failing/);
      },
    },

    {
      name: 'a scoped, picked or laned run never runs the test/e2e/ suite',
      run: async (ctx) => {
        const scoped = stageBrand({ brandE2e: 'suite' }).brand;
        await runTestCommand(scoped, ['framework:']);
        ctx.expect(readCalls(scoped).some((c) => c.name === 'brand-e2e')).toBe(false);

        const picked = stageBrand({ brandE2e: 'suite' }).brand;
        await runTestCommand(picked, [], { target: 'web' });
        ctx.expect(readCalls(picked).some((c) => c.name === 'brand-e2e')).toBe(false);

        const laned = stageBrand({ brandE2e: 'suite', lanes: { '@omega.js/backend': ['stripe-live'] } }).brand;
        await runTestCommand(laned, [], { lane: 'stripe-live' });
        ctx.expect(readCalls(laned).some((c) => c.name === 'brand-e2e')).toBe(false);
      },
    },

    {
      name: 'a test/e2e/ directory with no suite file runs empty and green',
      run: async (ctx) => {
        const { brand } = stageBrand({ brandE2e: 'dir-only' });
        const code = await runTestCommand(brand, []);

        ctx.expect(readCalls(brand).map((c) => c.name).sort()).toEqual(['backend', 'web']);
        ctx.expect(code).toBe(undefined);
      },
    },

    {
      name: 'a run.js left in test/e2e/ is ignored, never run',
      run: async (ctx) => {
        const { brand } = stageBrand({ brandE2e: 'run-js' });
        const code = await runTestCommand(brand, []);

        ctx.expect(readCalls(brand).map((c) => c.name).sort(), 'no brand-e2e call: run.js never ran').toEqual(['backend', 'web']);
        ctx.expect(code).toBe(undefined);
      },
    },

    {
      name: 'a brand with no test/e2e/ at all runs its targets and nothing else',
      run: async (ctx) => {
        const { brand } = stageBrand();
        await runTestCommand(brand, []);

        ctx.expect(readCalls(brand).length).toBe(2);
      },
    },

    // ─── The real CLI parse, not just the options object (#775) ──────────────────

    {
      name: '`omega test --extended full:` parses as a value-less flag and still carries the scope',
      run: async (ctx) => {
        const { BOOLEAN_FLAGS } = require('../src/cli-run.js');
        ctx.expect(BOOLEAN_FLAGS.includes('extended'), '--extended takes no value — it must be declared boolean').toBeTruthy();

        // The parse the bin really performs. Undeclared, the next token is read as
        // the flag's VALUE: `extended: 'full:'` with the scope gone, which ran every
        // target BARE while looking like it had been asked for both.
        const argv = require('@omega.js/devkit/argv').parseArgv(['test', '--extended', 'full:'], {
          booleans: BOOLEAN_FLAGS,
        });

        ctx.expect(argv.extended).toBe(true);
        ctx.expect(argv._, 'the scope stayed a positional').toEqual(['test', 'full:']);

        // …and that argv drives the fan-out for real
        const { brand } = stageBrand();
        const cwd0 = process.cwd();
        const restoreTee = require('@omega.js/devkit/attach-log-file').mark();
        process.chdir(brand);
        try {
          await testCommand(argv);
        } finally {
          restoreTee();
          process.chdir(cwd0);
          process.exitCode = undefined;
        }

        const calls = readCalls(brand);
        ctx.expect(calls.length).toBe(2);
        for (const call of calls) {
          ctx.expect(call.argv).toEqual(['test', '--extended', 'full:']);
        }
      },
    },

    {
      name: '`omega test --offline mgr:` parses as a value-less flag and still carries the scope',
      run: async (ctx) => {
        const { BOOLEAN_FLAGS } = require('../src/cli-run.js');
        const argv = require('@omega.js/devkit/argv').parseArgv(['test', '--offline', 'mgr:'], { booleans: BOOLEAN_FLAGS });

        ctx.expect(argv.offline, 'undeclared, the scope is read as the flag\'s value').toBe(true);
        ctx.expect(argv._, 'the scope stayed a positional').toEqual(['test', 'mgr:']);

        const { brand } = stageBrand();
        const { _: positionals, ...flags } = argv;
        await runTestCommand(brand, positionals.slice(1), flags);

        const calls = readCalls(brand);
        ctx.expect(calls.length).toBe(2);
        for (const call of calls) {
          ctx.expect([...call.argv].sort(), `${call.name} hears the flag and the scope`).toEqual(['--offline', 'mgr:', 'test']);
        }
      },
    },

    {
      name: 'the value-taking flags stay value-taking through the same parse',
      run: (ctx) => {
        const { BOOLEAN_FLAGS } = require('../src/cli-run.js');
        const { parseArgv } = require('@omega.js/devkit/argv');
        const parse = (args) => parseArgv(args, { booleans: BOOLEAN_FLAGS });

        const argv = parse(['test', '--target=web,backend', '--lane=stripe-live']);
        ctx.expect(argv.target).toBe('web,backend');
        ctx.expect(argv.lane).toBe('stripe-live');
        ctx.expect(BOOLEAN_FLAGS.includes('target'), 'a picker with a value must never be boolean').toBe(false);
        ctx.expect(BOOLEAN_FLAGS.includes('lane')).toBe(false);

        // And in the SPACE-separated spelling the docs teach for the manage walk
        // (`omega manage --service publishing`), which nothing declares.
        const spaced = parse(['manage', '--service', 'publishing']);
        ctx.expect(spaced.service).toBe('publishing');
        ctx.expect(spaced._, 'the value is the flag\'s, never a positional').toEqual(['manage']);

        // A flag the manager never heard of rides through to the target with its
        // value intact, which is what the fan-out forwards (#920).
        const forwarded = parse(['test', '--filter', 'auth', '--dry-run']);
        ctx.expect(forwarded.filter).toBe('auth');
        ctx.expect(forwarded.dryRun).toBe(true);
        ctx.expect(forwarded._).toEqual(['test']);
      },
    },

    {
      name: 'every value-LESS manage flag is declared, and the value-taking one is not',
      run: (ctx) => {
        const { BOOLEAN_FLAGS } = require('../src/cli-run.js');
        const { parseArgv } = require('@omega.js/devkit/argv');
        const parse = (args) => parseArgv(args, { booleans: BOOLEAN_FLAGS });

        for (const flag of ['verbose', 'strict', 'dry-run', 'major', 'force-fresh']) {
          ctx.expect(BOOLEAN_FLAGS.includes(flag), `--${flag} takes no value, so it must be declared boolean`).toBeTruthy();
        }

        // The pin: a declared boolean never eats the token after it.
        const argv = parse(['manage', '--strict', 'payment']);
        ctx.expect(argv.strict).toBe(true);
        ctx.expect(argv._).toEqual(['manage', 'payment']);

        // --reset-assets is value-TAKING (bare = both kinds, `logos`/`templates`
        // names one), so declaring it boolean would drop the kind.
        ctx.expect(BOOLEAN_FLAGS.includes('reset-assets')).toBe(false);
        ctx.expect(parse(['manage', '--reset-assets', 'logos']).resetAssets).toBe('logos');
        ctx.expect(parse(['manage', '--reset-assets']).resetAssets, 'and the bare form still means both').toBe(true);
      },
    },
  ],
});
