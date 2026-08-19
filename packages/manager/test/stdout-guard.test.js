/**
 * The test-child stdout guard (#321): inside a `node --test` child, the pipe
 * that carries the runner's v8 frames carries NOTHING else — console output
 * goes to stderr instead. Outside a runner child the guard is inert.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUARD = path.join(__dirname, 'lib', 'stdout-guard.js');

// A frame-shaped Buffer (the reporter's own writes) plus the kind of line the
// manage walk prints — box drawing is what makes the parser's signed length
// negative when it lands behind a frame.
const SCRIPT = `
  console.log('─── [1/2] website ───');
  process.stdout.write('  → a direct write\\n');
  process.stdout.write(Buffer.from([0xff, 0x0f, 0x00, 0x01]));
`;

/** Run SCRIPT under the guard with the given env, capturing both streams raw. */
function run(env) {
  const result = spawnSync(process.execPath, ['--require', GUARD, '-e', SCRIPT], {
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result;
}

test('stdout-guard: in a runner child, stdout carries the frame bytes alone', () => {
  const { stdout, stderr } = run({ NODE_TEST_CONTEXT: 'child-v8' });

  assert.deepEqual([...stdout], [0xff, 0x0f, 0x00, 0x01]);
  assert.match(stderr.toString(), /─── \[1\/2\] website ───/);
  assert.match(stderr.toString(), /→ a direct write/);
});

test('stdout-guard: a spawned child inherits stderr in place of the frame pipe', () => {
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

  assert.equal(result.status, 0, result.stderr.toString());
  assert.deepEqual([...result.stdout], [0xff, 0x0f]);
  assert.match(result.stderr.toString(), /grandchild ─ line/);
});

test('stdout-guard: outside a runner child it leaves stdout alone', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--require', GUARD, '-e', SCRIPT], { env });

  assert.equal(result.status, 0, result.stderr.toString());
  assert.match(result.stdout.toString(), /─── \[1\/2\] website ───/);
  assert.equal(result.stderr.toString(), '');
});
