/**
 * The plugin's MCP entry (#144). The omega Claude plugin declares exactly one
 * server, and it launches through `agent-plugins/claude/mcp-router-launch.js`,
 * a file INSIDE the plugin, so the declaration travels with the plugin
 * wherever it is fetched to. The launcher resolves this package from the
 * plugin folder first (the monorepo), then from the open project (a brand's
 * install); a copy with neither answers with an empty tool list, so a folder
 * with no brand shows no failed server. Each case runs the real launcher as a
 * child process and speaks MCP over its stdin and stdout.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PLUGIN_DIR = path.join(__dirname, '..', '..', '..', 'agent-plugins', 'claude');
const LAUNCHER = 'mcp-router-launch.js';
const ROUTER_BIN = '@omega.js/mcp-router/cli';

// A router a brand has installed, standing in for whatever version it pinned:
// it names itself apart from the real one, and goes when its input closes.
const STUB_ROUTER = `const readline = require('node:readline');
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const result = message.method === 'initialize'
    ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'brand-router-stub', version: '0.0.0' } }
    : { tools: [{ name: 'brand_stub_tool', inputSchema: { type: 'object' } }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
});
lines.on('close', () => process.exit(0));
`;

const tmpdir = (label) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `plugin-launch-${label}-`)));

/** A brand root with @omega.js/mcp-router installed in the package's real shape, its code the stub. */
function brandWithRouter() {
  const brand = tmpdir('brand');
  const pkg = path.join(brand, 'node_modules', '@omega.js', 'mcp-router');
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(pkg, 'src'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({
    name: '@omega.js/mcp-router',
    version: '0.0.1',
    main: './src/router.js',
    exports: { '.': './src/router.js', './cli': './bin/mcp-router.js', './package.json': './package.json' },
    bin: { 'mcp-router': 'bin/mcp-router.js' },
  }));
  fs.writeFileSync(path.join(pkg, 'src', 'router.js'), STUB_ROUTER);
  fs.writeFileSync(path.join(pkg, 'bin', 'mcp-router.js'), '#!/usr/bin/env node\nrequire(\'../src/router.js\');\n', { mode: 0o755 });
  fs.mkdirSync(path.join(brand, 'node_modules', '.bin'));
  fs.symlinkSync(path.join(pkg, 'bin', 'mcp-router.js'), path.join(brand, 'node_modules', '.bin', 'mcp-router'));
  fs.writeFileSync(path.join(brand, 'package.json'), JSON.stringify({ name: 'a-brand', devDependencies: { '@omega.js/manager': '0.0.1' } }));
  return brand;
}

/** The plugin as a machine fetches it from GitHub: the folder alone, with no install around it. */
function fetchedPlugin() {
  const copy = path.join(tmpdir('fetched'), 'claude');
  fs.cpSync(PLUGIN_DIR, copy, { recursive: true });
  return copy;
}

/**
 * Start a launcher the way Claude Code does, in a project, and talk MCP to it.
 * @param {string} pluginRoot - The plugin folder the launcher sits in
 * @param {string} project - The open project
 */
function launch(pluginRoot, project) {
  const child = spawn(process.execPath, [path.join(pluginRoot, LAUNCHER)], {
    cwd: project,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PROJECT_DIR: project },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  let stderr = '';
  let next = 0;
  const waiting = new Map();
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (waiting.has(message.id)) waiting.get(message.id)(message);
    }
  });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));

  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => reject(new Error(`no answer to ${method}; stderr: ${stderr}`)), 15000);
    waiting.set(id, (message) => { clearTimeout(timer); resolve(message); });
    send({ id, method, params });
  });

  return {
    async initialize() {
      const answer = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'plugin-launch-test', version: '1.0.0' } });
      send({ method: 'notifications/initialized' });
      return answer;
    },
    request,
    /** End its input, as a host does at session end, and resolve with its exit code. */
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
      const code = await exited;
      clearTimeout(timer);
      return code;
    },
  };
}

test('the plugin declares one server, launched from inside the plugin', () => {
  const declaration = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, '.mcp.json'), 'utf8'));

  assert.deepEqual(Object.keys(declaration.mcpServers), ['mcp-router']);
  assert.deepEqual(declaration.mcpServers['mcp-router'].args, ['${CLAUDE_PLUGIN_ROOT}/mcp-router-launch.js']);
  assert.ok(!JSON.stringify(declaration).includes('..'), 'the declaration never reaches outside the plugin');
  assert.ok(fs.existsSync(path.join(PLUGIN_DIR, LAUNCHER)), 'the launcher it names is there');
});

test('the launcher resolves this package\'s bin from the plugin directory', () => {
  assert.equal(
    require.resolve(ROUTER_BIN, { paths: [PLUGIN_DIR] }),
    path.join(__dirname, '..', 'bin', 'mcp-router.js')
  );
});

test('case 12: the launcher in this monorepo runs the workspace router, even in a brand that installs its own', async () => {
  const server = launch(PLUGIN_DIR, brandWithRouter());
  try {
    const answer = await server.initialize();
    assert.equal(answer.result.serverInfo.name, 'mcp-router', 'the plugin folder wins over the open project');
  } finally {
    await server.close();
  }
});

test('case 12: a fetched launcher in a brand runs the brand\'s installed router', async () => {
  const server = launch(fetchedPlugin(), brandWithRouter());
  try {
    const answer = await server.initialize();
    assert.equal(answer.result.serverInfo.name, 'brand-router-stub');
  } finally {
    await server.close();
  }
});

test('case 12: a fetched launcher with no router anywhere answers with an empty tool list and exits 0 when its input closes', async () => {
  const server = launch(fetchedPlugin(), tmpdir('empty'));

  const init = await server.initialize();
  assert.ok(init.result, `initialize is answered, not refused: ${JSON.stringify(init)}`);
  assert.ok(init.result.serverInfo && init.result.protocolVersion, 'a well-formed initialize result');

  const list = await server.request('tools/list');
  assert.deepEqual(list.result, { tools: [] });

  assert.equal(await server.close(), 0);
});
