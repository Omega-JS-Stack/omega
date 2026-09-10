/**
 * Killing the whole tree, not just the pid the router holds.
 *
 * The process an upstream command starts is often a WRAPPER: `npx` starts npm,
 * which starts the real server, which starts a browser. Signalling that one
 * pid ends the wrapper and REPARENTS everything below it, where nothing the
 * router knows about can reach it again — which is how a stopped upstream left
 * a browser running for the rest of the day.
 *
 * Three proofs: the helper against a real tree built by the shell, and the
 * whole lane end to end at each depth — a fixture upstream whose grandchild has
 * to be gone once `router__disable_upstream` has answered, and a two-deep one
 * whose MIDDLE level dies with the root, leaving a leaf that only a capture of
 * the whole tree ever named.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const registry = require('../src/lib/registry.js');
const { killTree } = require('../src/lib/kill-tree.js');

const TREE_SERVER = path.join(__dirname, 'fixtures', 'tree-server.js');
const DEEP_TREE_SERVER = path.join(__dirname, 'fixtures', 'deep-tree-server.js');
const ROUTER = path.join(__dirname, '..', 'src', 'router.js');

// The router process reads the fixture overlay; this side reads the bundled
// layer alone, so a real user overlay cannot colour the expectations.
const BUNDLED_ONLY = { overlayDir: path.join(os.tmpdir(), 'mcp-router-no-such-overlay') };

const schema = { type: 'object', properties: {} };

let client;
let markerFile;
let deepMarker;

before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-tree-'));
  const overlayDir = path.join(root, 'servers');
  markerFile = path.join(root, 'pids.json');
  deepMarker = path.join(root, 'deep.json');

  const entries = {
    // Every bundled default off, by the one-key overlay the layering promises.
    ...Object.fromEntries(Object.keys(registry.loadUpstreams(BUNDLED_ONLY)).map((name) => [name, { enabled: false }])),
    'fixture-tree': {
      enabled: true,
      command: 'node',
      args: [TREE_SERVER],
      env: { TREE_MARKER: markerFile },
      tools: [{ name: 'ping', description: 'Answer with pong.', inputSchema: schema }],
    },
    'fixture-deep': {
      enabled: true,
      command: 'node',
      args: [DEEP_TREE_SERVER],
      env: { DEEP_MARKER: deepMarker },
      tools: [{ name: 'ping', description: 'Answer with pong.', inputSchema: schema }],
    },
  };
  for (const [name, config] of Object.entries(entries)) {
    fs.mkdirSync(path.join(overlayDir, name), { recursive: true });
    fs.writeFileSync(path.join(overlayDir, name, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  }

  client = new Client({ name: 'router-tree-e2e', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [ROUTER],
    env: { ...process.env, MCP_ROUTER_SERVERS_DIR: overlayDir },
    stderr: 'ignore',
  }));
});

after(async () => {
  await client.close();
});

const callTool = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return {
    text: result.content.map((part) => part.text).join(''),
    isError: result.isError === true,
  };
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Poll a condition until it holds, or give up.
 *
 * @param {Function} condition - Called until it answers truthy
 * @param {number} timeout - How long to keep asking, in ms
 * @returns {Promise<*>} Whatever the condition last answered
 */
const waitFor = async (condition, timeout) => {
  const deadline = Date.now() + timeout;
  let answer = await condition();
  while (!answer && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    answer = await condition();
  }
  return answer;
};

test('killTree takes the descendants with the root', async () => {
  // The shell reports its own children's pids, so the check never leans on the
  // same `pgrep` walk the helper under test uses.
  const root = spawn('sh', ['-c', 'sleep 30 & echo $!; sleep 30 & echo $!; wait'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const exited = new Promise((resolve) => root.once('exit', resolve));

  let out = '';
  root.stdout.on('data', (chunk) => { out += chunk; });
  const children = await waitFor(() => {
    const pids = out.trim().split('\n').filter(Boolean).map(Number);
    return pids.length === 2 ? pids : null;
  }, 5000);

  assert.ok(children, `the shell never reported two children (got "${out}")`);
  assert.ok(children.every(alive), 'both children are running');

  killTree(root.pid, 'SIGKILL');
  await exited;

  assert.ok(await waitFor(() => children.every((pid) => !alive(pid)), 5000), `${children} outlived the tree kill`);
  assert.equal(alive(root.pid), false, 'the root is gone too');
});

test('an upstream grandchild does not outlive router__disable_upstream', async () => {
  const result = await callTool('fixture-tree__ping', {});
  assert.equal(result.isError, false, result.text);

  const pids = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  assert.ok(alive(pids.server), 'the upstream child is running');
  assert.ok(alive(pids.grandchild), 'the grandchild it started is running');

  const disabled = await callTool('router__disable_upstream', { name: 'fixture-tree' });
  assert.equal(disabled.isError, false, disabled.text);

  // The root goes on close(); the grandchild it orphaned is what the grace
  // fallback exists for, so the window covers that grace plus a margin.
  assert.ok(await waitFor(() => !alive(pids.server), 5000), `the upstream child ${pids.server} is still alive`);
  assert.ok(await waitFor(() => !alive(pids.grandchild), 5000), `the grandchild ${pids.grandchild} is still alive`);
});

test('a whole tree goes with a disabled upstream, not just its top level', async () => {
  const result = await callTool('fixture-deep__ping', {});
  assert.equal(result.isError, false, result.text);

  // The middle level writes the marker once it has started the leaf.
  const deep = await waitFor(() => (fs.existsSync(deepMarker) ? JSON.parse(fs.readFileSync(deepMarker, 'utf8')) : null), 5000);
  assert.ok(deep, 'the fixture never reported its tree');
  assert.ok(alive(deep.mid) && alive(deep.leaf), 'both levels under the child are running');

  const disabled = await callTool('router__disable_upstream', { name: 'fixture-deep' });
  assert.equal(disabled.isError, false, disabled.text);

  // The middle dies with the root, so at grace time the leaf is an orphan two
  // levels from anything the router can walk to: only a capture of the whole
  // tree, taken before the close, still names it.
  assert.ok(await waitFor(() => !alive(deep.leaf), 5000), `the leaf ${deep.leaf} is still alive`);
});
