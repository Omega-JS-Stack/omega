/**
 * The idle close: a real router process, driven by the real MCP client,
 * against a fixture upstream that answers and is then left alone.
 *
 * A spawned child used to live until the router got a signal, so a session
 * left open for a day held a browser-shaped upstream open for the day — 2.5
 * cores for 20 hours, in the run that filed the issue. The proof is the child
 * going away on its own, the NEXT call answering from a new pid through the
 * unchanged lazy path, and a call IN FLIGHT surviving a sweep that runs under
 * it (the counter, not the clock, is what protects it), and a call landing
 * WHILE a close runs being served by a fresh child instead of failing against
 * the closing one.
 *
 * The limit is shrunk through its env seam (MCP_ROUTER_IDLE_MS), which drags
 * the sweep cadence down with it; the shipped 15 minutes is untouched.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const registry = require('../src/lib/registry.js');

const SLEEP_SERVER = path.join(__dirname, 'fixtures', 'sleep-server.js');
const STUBBORN_SERVER = path.join(__dirname, 'fixtures', 'stubborn-server.js');
const ROUTER = path.join(__dirname, '..', 'src', 'router.js');

// The router process reads the fixture overlay; this side reads the bundled
// layer alone, so a real user overlay cannot colour the expectations.
const BUNDLED_ONLY = { overlayDir: path.join(os.tmpdir(), 'mcp-router-no-such-overlay') };

// Shorter than any call the suite makes, so "idle" is reached the moment a
// call ends. The sweep cadence derived from it floors at 1s.
const IDLE_MS = 300;
const SWEEP_MS = 1000;

const schema = { type: 'object', properties: {} };

let client;
let firstPid;
let stubbornPidFile;

before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-idle-'));
  const overlayDir = path.join(root, 'servers');
  stubbornPidFile = path.join(root, 'stubborn.pids');

  const entries = {
    // Every bundled default off, by the one-key overlay the layering promises.
    ...Object.fromEntries(Object.keys(registry.loadUpstreams(BUNDLED_ONLY)).map((name) => [name, { enabled: false }])),
    'fixture-idle': {
      enabled: true,
      command: 'node',
      args: [SLEEP_SERVER],
      tools: [
        { name: 'ping', description: 'Answer with pong.', inputSchema: schema },
        { name: 'sleep', description: 'Answer after the given number of milliseconds.', inputSchema: schema },
      ],
    },
    'fixture-stubborn': {
      enabled: true,
      command: 'node',
      args: [STUBBORN_SERVER],
      env: { SLEEP_PID_FILE: stubbornPidFile },
      tools: [{ name: 'ping', description: 'Answer with pong.', inputSchema: schema }],
    },
  };
  for (const [name, config] of Object.entries(entries)) {
    fs.mkdirSync(path.join(overlayDir, name), { recursive: true });
    fs.writeFileSync(path.join(overlayDir, name, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  }

  client = new Client({ name: 'router-idle-e2e', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [ROUTER],
    env: {
      ...process.env,
      MCP_ROUTER_SERVERS_DIR: overlayDir,
      MCP_ROUTER_IDLE_MS: String(IDLE_MS),
    },
    stderr: 'ignore',
  }));
});

after(async () => {
  await client.close();
  // The stubborn fixture outlives a polite close by design, and the client's
  // own teardown can cut the router off mid-shutdown: whatever this run
  // started, this run ends.
  if (fs.existsSync(stubbornPidFile)) {
    for (const line of fs.readFileSync(stubbornPidFile, 'utf8').trim().split('\n').filter(Boolean)) {
      try {
        process.kill(Number(line), 'SIGKILL');
      } catch {
        // already gone — fine
      }
    }
  }
});

const callTool = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return {
    text: result.content.map((part) => part.text).join(''),
    isError: result.isError === true,
  };
};

const idleRow = async (name = 'fixture-idle') => {
  const rows = JSON.parse((await callTool('router__list_upstreams', {})).text);
  return rows.find((entry) => entry.name === name);
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

test('a cold call spawns a child the row can name', async () => {
  const result = await callTool('fixture-idle__ping', {});
  assert.equal(result.isError, false, result.text);
  assert.equal(result.text, 'pong');

  const row = await idleRow();
  assert.equal(row.spawned, true);
  assert.ok(Number.isInteger(row.pid), `expected a child pid on the row, got ${JSON.stringify(row.pid)}`);
  assert.ok(row.idle_ms >= 0 && row.idle_ms < 5000, `idle_ms was ${row.idle_ms}`);
  assert.ok(alive(row.pid), 'the child is running');

  firstPid = row.pid;
});

test('an upstream nobody is using is closed under the idle limit', async () => {
  // Meta-tools are not upstream traffic: polling the row does not keep the
  // child alive, which is the whole point of measuring PROXIED calls.
  const row = await waitFor(async () => {
    const current = await idleRow();
    return current.spawned === false ? current : null;
  }, SWEEP_MS * 4);

  assert.ok(row, `the child was still spawned ${SWEEP_MS * 4}ms after its last call`);
  assert.equal(row.pid, null, 'no pid is reported for a closed upstream');
  assert.equal(row.idle_ms, null, 'idle is only measured for a spawned child');
  assert.equal(row.active_this_session, true, 'a closed upstream stays active for the session');
  assert.ok(await waitFor(() => !alive(firstPid), 2000), `pid ${firstPid} outlived the idle close`);
});

test('the next call spawns a fresh child through the unchanged lazy path', async () => {
  const result = await callTool('fixture-idle__ping', {});
  assert.equal(result.isError, false, result.text);
  assert.equal(result.text, 'pong');

  const row = await idleRow();
  assert.equal(row.spawned, true);
  assert.notEqual(row.pid, firstPid, 'a NEW child answered the call');
  assert.ok(alive(row.pid));
});

test('a call landing while a close runs is served by a fresh child', async () => {
  // This fixture only dies on SIGKILL, so its close walks the SDK's whole
  // escalation and runs for ~4s. That is the window: long enough to fire a
  // call INTO it, which is what a call arriving mid-sweep really is.
  assert.equal((await callTool('fixture-stubborn__ping', {})).text, 'pong');
  const closingPid = (await idleRow('fixture-stubborn')).pid;

  // A tick later the sweep has started closing it, with seconds of close left
  // to run.
  await new Promise((resolve) => setTimeout(resolve, SWEEP_MS + 500));
  assert.ok(alive(closingPid), `the close of ${closingPid} was already over`);
  assert.equal((await idleRow('fixture-stubborn')).spawned, false, 'the slot is emptied when the close STARTS');

  const result = await callTool('fixture-stubborn__ping', {});

  // Against a client that was still closing, this call used to fail outright:
  // one error handed to the session for a close it never asked about.
  assert.equal(result.isError, false, result.text);
  assert.equal(result.text, 'pong');
  assert.notEqual((await idleRow('fixture-stubborn')).pid, closingPid, 'a NEW child served it');
});

test('a call in flight is never closed under it', async () => {
  assert.equal((await callTool('fixture-idle__ping', {})).text, 'pong');
  const pid = (await idleRow()).pid;

  // Longer than the sweep cadence, so a sweep RUNS while the call is in
  // flight: by the clock alone this child is long past the limit, and only the
  // in-flight counter stands between it and a kill mid-answer.
  const result = await callTool('fixture-idle__sleep', { ms: SWEEP_MS + 500 });

  assert.equal(result.isError, false, result.text);
  assert.equal(result.text, `slept ${SWEEP_MS + 500}ms`);
  assert.ok(alive(pid), 'the child that served the call was killed under it');
  assert.equal((await idleRow()).pid, pid, 'the same child answered, not a respawn');
});
