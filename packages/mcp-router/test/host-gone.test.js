/**
 * Host-gone shutdown: the router process is driven over a raw stdio pipe here,
 * not by the SDK client, because the thing under test is what happens when the
 * HOST goes away — the client's own close() would kill the router itself and
 * prove nothing.
 *
 * `main()` connected the stdio transport and never handled its close, so a host
 * that exited without signalling left the router alive, and a spawned child's
 * handle then held it open for good. The proof is the router exiting on its own
 * once its stdin ends, with its child gone and the WHOLE tree that child
 * started gone with it: session end is the everyday close, and a shutdown that
 * beat its own grace period was how a browser survived one.
 *
 * A host does not stop at EOF either. It ends stdin, SIGTERMs a moment later,
 * and SIGKILLs after that — so the second test is that teardown exactly: the
 * signal lands mid-shutdown, and it must join the shutdown already running
 * rather than start a second one that exits over the top of it.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const registry = require('../src/lib/registry.js');

const SLEEP_SERVER = path.join(__dirname, 'fixtures', 'sleep-server.js');
const TREE_SERVER = path.join(__dirname, 'fixtures', 'tree-server.js');
const DEEP_TREE_SERVER = path.join(__dirname, 'fixtures', 'deep-tree-server.js');
const ROUTER = path.join(__dirname, '..', 'src', 'router.js');

// The router process reads the fixture overlay; this side reads the bundled
// layer alone, so a real user overlay cannot colour the expectations.
const BUNDLED_ONLY = { overlayDir: path.join(os.tmpdir(), 'mcp-router-no-such-overlay') };

const schema = { type: 'object', properties: {} };

// Every process a run started, so a run that goes red still cleans up after
// itself: the fixtures below outlive a polite close by design.
const started = [];

after(() => {
  for (const pid of started) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone — fine
    }
  }
});

/**
 * Build one run's own overlay, with the three fixture upstreams in it.
 *
 * @param {string} label - Names this run's temp dir apart from the other's
 * @returns {object} The overlay dir and the marker files the fixtures write
 */
const buildOverlay = (label) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `mcp-router-${label}-`));
  const overlayDir = path.join(root, 'servers');
  const pidFile = path.join(root, 'child.pid');
  const treeMarker = path.join(root, 'tree.json');
  const deepMarker = path.join(root, 'deep.json');

  const entries = {
    // Every bundled default off, by the one-key overlay the layering promises.
    ...Object.fromEntries(Object.keys(registry.loadUpstreams(BUNDLED_ONLY)).map((name) => [name, { enabled: false }])),
    'fixture-host': {
      enabled: true,
      command: 'node',
      args: [SLEEP_SERVER],
      env: { SLEEP_PID_FILE: pidFile },
      tools: [{ name: 'ping', description: 'Answer with pong.', inputSchema: schema }],
    },
    'fixture-tree': {
      enabled: true,
      command: 'node',
      args: [TREE_SERVER],
      env: { TREE_MARKER: treeMarker },
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

  return { overlayDir, pidFile, treeMarker, deepMarker };
};

/**
 * Start a router and speak raw JSON-RPC to it over its stdio pipe.
 *
 * @param {string} overlayDir - The overlay this router reads
 * @returns {object} The child process, and `request` / `notify` senders
 */
const startRouter = (overlayDir) => {
  const router = spawn(process.execPath, [ROUTER], {
    env: { ...process.env, MCP_ROUTER_SERVERS_DIR: overlayDir },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  started.push(router.pid);

  // The MCP stdio wire is newline-delimited JSON-RPC; answers carry the id
  // their request did.
  const pending = new Map();
  let nextId = 0;
  let buffer = '';
  router.stdout.on('data', (chunk) => {
    buffer += chunk;
    let cut = buffer.indexOf('\n');
    while (cut !== -1) {
      const line = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      if (line.trim()) {
        const message = JSON.parse(line);
        const resolve = pending.get(message.id);
        if (resolve) {
          pending.delete(message.id);
          resolve(message);
        }
      }
      cut = buffer.indexOf('\n');
    }
  });

  const request = (method, params) => {
    nextId += 1;
    const id = nextId;
    const answered = new Promise((resolve) => pending.set(id, resolve));
    router.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return answered;
  };

  const notify = (method) => {
    router.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  };

  return { router, request, notify };
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
  let answer = condition();
  while (!answer && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    answer = condition();
  }
  return answer;
};

/**
 * Handshake a router and spawn all three fixture upstreams through it.
 *
 * @param {object} session - What startRouter answered
 * @param {object} markers - The marker files buildOverlay named
 * @returns {Promise<object>} The pids the fixtures reported, all running
 */
const spawnFixtures = async ({ request, notify }, markers) => {
  const initialized = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'host-gone-e2e', version: '1.0.0' },
  });
  assert.ok(initialized.result, `initialize failed: ${JSON.stringify(initialized.error)}`);
  notify('notifications/initialized');

  for (const name of ['fixture-host__ping', 'fixture-tree__ping', 'fixture-deep__ping']) {
    const called = await request('tools/call', { name, arguments: {} });
    assert.equal(called.result.content[0].text, 'pong', `${name} did not answer`);
  }

  const child = Number(fs.readFileSync(markers.pidFile, 'utf8').trim());
  const tree = JSON.parse(fs.readFileSync(markers.treeMarker, 'utf8'));
  const deep = await waitFor(
    () => (fs.existsSync(markers.deepMarker) ? JSON.parse(fs.readFileSync(markers.deepMarker, 'utf8')) : null),
    5000,
  );
  assert.ok(deep, 'the depth-2 fixture never reported its tree');
  started.push(child, tree.grandchild, deep.mid, deep.leaf);

  assert.ok(alive(child), 'the upstream child is running');
  assert.ok(alive(tree.grandchild), 'the grandchild an upstream started is running');
  assert.ok(alive(deep.leaf), 'the leaf two levels down is running');

  return { child, tree, deep };
};

/**
 * Assert nothing an upstream started outlived the router.
 *
 * @param {object} pids - What spawnFixtures answered
 * @returns {Promise<void>} Resolves once every pid is gone
 */
const assertTreesGone = async ({ child, tree, deep }) => {
  assert.ok(await waitFor(() => !alive(child), 2000), `the child ${child} outlived the router`);
  // Nothing but the router knew these pids: a shutdown that skipped its grace,
  // or a capture that only went one level down, left them running for good.
  assert.ok(await waitFor(() => !alive(tree.grandchild), 2000), `the grandchild ${tree.grandchild} outlived the router`);
  assert.ok(await waitFor(() => !alive(deep.leaf), 2000), `the leaf ${deep.leaf} outlived the router`);
};

test('ending the router stdin shuts it down and takes every tree with it', async () => {
  const markers = buildOverlay('host-gone');
  const session = startRouter(markers.overlayDir);
  const pids = await spawnFixtures(session, markers);

  const exited = new Promise((resolve) => session.router.once('exit', (code) => resolve(code)));
  session.router.stdin.end();

  // Long enough for the 2s grace the shutdown waits out, far short of a router
  // that never leaves at all.
  const code = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve('still running'), 8000)),
  ]);
  assert.equal(code, 0, 'the router exits when the host goes away');
  await assertTreesGone(pids);
});

test('a SIGTERM landing mid-shutdown joins it instead of exiting over it', async () => {
  const markers = buildOverlay('host-sigterm');
  const session = startRouter(markers.overlayDir);
  const pids = await spawnFixtures(session, markers);

  const exited = new Promise((resolve) => session.router.once('exit', (code, signal) => resolve({ code, signal })));
  session.router.stdin.end();

  // The host's own teardown, to the letter: EOF, then a signal while the
  // shutdown is still waiting out its grace. A second shutdown run would find
  // every slot already emptied, await nothing, and exit(0) on top of the timers
  // that had yet to kill the trees.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (session.router.exitCode === null) session.router.kill('SIGTERM');

  const result = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve({ code: 'still running' }), 8000)),
  ]);
  assert.equal(result.code, 0, `the router left on its own terms (signal ${result.signal})`);
  await assertTreesGone(pids);
});
