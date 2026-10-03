/**
 * The test-child stdout guard (#321, shared from devkit in #356): inside a
 * `node --test` child, the pipe that carries the runner's v8 frames carries
 * NOTHING else — console output goes to stderr instead. Outside a runner child
 * the guard is inert, and a second load leaves the first application alone.
 *
 * Run: node --test test/stdout-guard.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUARD = path.join(__dirname, '..', 'src', 'test', 'stdout-guard.js');

// A frame-shaped Buffer (the reporter's own writes) plus the kind of line the
// manage walk prints — box drawing is what makes the parser's signed length
// negative when it lands behind a frame.
const SCRIPT = `
  console.log('─── [1/2] website ───');
  process.stdout.write('  → a direct write\\n');
  process.stdout.write(Buffer.from([0xff, 0x0f, 0x00, 0x01]));
`;

/** Run SCRIPT under the guard with the given env, capturing both streams raw; `expect` is the case's. */
function run(expect, env) {
  const result = spawnSync(process.execPath, ['--require', GUARD, '-e', SCRIPT], {
    env: { ...process.env, ...env },
  });
  expect(result.status, result.stderr?.toString()).toBe(0);
  return result;
}

module.exports = defineCases({
  type: 'group',
  description: 'stdout-guard',
  tests: [
    {
      name: 'stdout-guard: in a runner child, stdout carries the frame bytes alone',
      run: (ctx) => {
        const { stdout, stderr } = run(ctx.expect, { NODE_TEST_CONTEXT: 'child-v8' });

        ctx.expect([...stdout]).toEqual([0xff, 0x0f, 0x00, 0x01]);
        ctx.expect(stderr.toString()).toMatch(/─── \[1\/2\] website ───/);
        ctx.expect(stderr.toString()).toMatch(/→ a direct write/);
      },
    },

    {
      name: 'stdout-guard: a spawned child inherits stderr in place of the frame pipe',
      run: (ctx) => {
        // `stdio: 'inherit'` would hand the grandchild our fd 1 — output this process
        // cannot patch, landing straight in the frames.
        const spawner = `
    const { spawnSync } = require('node:child_process');
    spawnSync(process.execPath, ['-e', "process.stdout.write('grandchild ─ line\\\\n')"], { stdio: 'inherit' });
    process.stdout.write(Buffer.from([0xff, 0x0f]));
  `;
        const result = spawnSync(process.execPath, ['--require', GUARD, '-e', spawner], {
          env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' },
        });

        ctx.expect(result.status, result.stderr.toString()).toBe(0);
        ctx.expect([...result.stdout]).toEqual([0xff, 0x0f]);
        ctx.expect(result.stderr.toString()).toMatch(/grandchild ─ line/);
      },
    },

    {
      name: 'stdout-guard: outside a runner child it leaves stdout alone',
      run: (ctx) => {
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const result = spawnSync(process.execPath, ['--require', GUARD, '-e', SCRIPT], { env });

        ctx.expect(result.status, result.stderr.toString()).toBe(0);
        ctx.expect(result.stdout.toString()).toMatch(/─── \[1\/2\] website ───/);
        ctx.expect(result.stderr.toString()).toBe('');
      },
    },

    {
      name: 'stdout-guard: loading it twice re-applies nothing',
      run: (ctx) => {
        // Every wired package preloads the same file, but a suite can reach the guard
        // a second way (its own require, a vendored copy) — the second application
        // would wrap the ALREADY guarded stdout.write, stacking a layer per load.
        const reload = `
    const first = process.stdout.write;
    delete require.cache[require.resolve(${JSON.stringify(GUARD)})];
    require(${JSON.stringify(GUARD)});
    process.stderr.write(String(process.stdout.write === first) + '\\n');
    process.stdout.write(Buffer.from([0xff, 0x0f]));
  `;
        const result = spawnSync(process.execPath, ['--require', GUARD, '-e', reload], {
          env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' },
        });

        ctx.expect(result.status, result.stderr.toString()).toBe(0);
        ctx.expect(result.stderr.toString()).toMatch(/^true$/m);
        ctx.expect([...result.stdout]).toEqual([0xff, 0x0f]);
      },
    },
  ],
});
