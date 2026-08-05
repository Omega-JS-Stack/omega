/**
 * Bundled-config sanity — these four files are the product for a fresh
 * install, they ship in the tarball, and nothing else parses them before a
 * user's first session. A personal path or an empty tools cache in one of
 * them is a shipped defect, so it fails here.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { BUNDLED_SERVERS_DIR } = require('../src/lib/paths.js');
const registry = require('../src/lib/registry.js');

// The bundled layer alone: a real user overlay must not colour these results.
const BUNDLED_ONLY = { overlayDir: path.join(os.tmpdir(), 'mcp-router-no-such-overlay') };

const EXPECTED = ['chrome-devtools', 'chrome-devtools-electron', 'chrome-devtools-extension', 'omega-extension'];

test('the package ships exactly the four default upstreams', () => {
  assert.deepEqual(fs.readdirSync(BUNDLED_SERVERS_DIR).sort(), EXPECTED);
  assert.deepEqual(Object.keys(registry.loadUpstreams(BUNDLED_ONLY)).sort(), EXPECTED);
});

for (const name of EXPECTED) {
  test(`${name} parses, is enabled, and carries a command and a tools cache`, () => {
    const raw = fs.readFileSync(path.join(BUNDLED_SERVERS_DIR, name, 'config.json'), 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw));
    assert.equal(raw.includes('/Users/'), false, 'a bundled config must carry no personal path');

    const upstream = registry.loadUpstream(name, BUNDLED_ONLY);
    assert.equal(upstream.enabled_on_disk, true);
    assert.ok(upstream.command, 'no command');
    assert.ok(upstream.args.length > 0, 'no args');
    assert.ok(upstream.tools.length > 0, 'empty tools cache');
    for (const tool of upstream.tools) {
      assert.ok(tool.name && tool.inputSchema, `tool ${tool.name} has no schema`);
    }
  });
}

test('the electron upstream carries its port default as a placeholder the router resolves', () => {
  const upstream = registry.loadUpstream('chrome-devtools-electron', BUNDLED_ONLY);
  assert.equal(upstream.command, 'npx');
  const browserUrl = upstream.args.find((arg) => arg.startsWith('--browserUrl='));
  assert.equal(browserUrl, '--browserUrl=http://127.0.0.1:${OMEGA_CDP_PORT:-9222}');
  assert.equal(upstream.args.join(' ').includes('EM_CDP_PORT'), false, 'the legacy port fallback is gone');
});

test('no bundled upstream launches through a shell', () => {
  // A shell command bypasses resolveBin entirely (Omega-JS-Stack/omega#178) and
  // hands the child's argv to a word-splitter nobody audits.
  for (const name of EXPECTED) {
    const upstream = registry.loadUpstream(name, BUNDLED_ONLY);
    assert.equal(['sh', 'bash', 'zsh', 'cmd', 'cmd.exe', 'powershell'].includes(upstream.command), false, `${name} launches through a shell`);
  }
});

test('the launcher upstreams point at scripts this package ships, via the reserved placeholder', () => {
  const { resolveSpawn } = require('../src/lib/env.js');
  for (const [name, script] of [['chrome-devtools-extension', 'launch-cft.js'], ['omega-extension', 'launch-omega-extension.js']]) {
    const upstream = registry.loadUpstream(name, BUNDLED_ONLY);
    assert.equal(upstream.command, 'node');
    assert.equal(upstream.args[0], `\${MCP_ROUTER_ROOT}/src/${script}`);
    assert.equal(fs.existsSync(resolveSpawn(upstream).args[0]), true, `${script} is not on disk`);
  }
});

test('the extension upstream is on-demand; the others load automatically', () => {
  assert.equal(registry.loadUpstream('chrome-devtools-extension', BUNDLED_ONLY).default, 'on-demand');
  for (const name of ['chrome-devtools', 'chrome-devtools-electron', 'omega-extension']) {
    assert.equal(registry.loadUpstream(name, BUNDLED_ONLY).default, 'auto');
  }
});
