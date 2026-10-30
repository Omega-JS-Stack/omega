/**
 * Stop signals, on the router as it ships: the package's `files` copied out
 * beside its declared dependencies alone, with no @omega.js/devkit to resolve,
 * which is what a published install holds. Each of the family's stop signals
 * must run the router's own shutdown and exit 0; a signal it never registered
 * kills it outright and leaves every upstream child behind (SIGHUP is a closed
 * terminal).
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const registry = require('../src/lib/registry.js');

const PACKAGE_ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');

// This side reads the bundled layer alone, so a real user overlay cannot colour it.
const BUNDLED_ONLY = { overlayDir: path.join(os.tmpdir(), 'mcp-router-no-such-overlay') };

const started = [];
let world;

/**
 * The installed copy: every `files` entry plus the manifest, and node_modules
 * holding links to the declared dependencies and nothing else.
 *
 * @returns {{ scratch: string, main: string, overlayDir: string }}
 */
function publishedCopy() {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-router-published-')));
  const root = path.join(scratch, 'node_modules', '@omega.js', 'mcp-router');
  fs.mkdirSync(root, { recursive: true });
  for (const entry of [...pkg.files, 'package.json']) {
    fs.cpSync(path.join(PACKAGE_ROOT, entry), path.join(root, entry), { recursive: true });
  }

  for (const dep of Object.keys(pkg.dependencies || {})) {
    const home = require.resolve.paths(dep).map((dir) => path.join(dir, dep)).find((dir) => fs.existsSync(dir));
    if (!home) throw new Error(`${dep} is not installed for @omega.js/mcp-router`);
    const link = path.join(scratch, 'node_modules', dep);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(fs.realpathSync(home), link, 'dir');
  }

  // Every bundled default off, so no upstream child ever starts.
  const overlayDir = path.join(scratch, 'servers');
  for (const name of Object.keys(registry.loadUpstreams(BUNDLED_ONLY))) {
    fs.mkdirSync(path.join(overlayDir, name), { recursive: true });
    fs.writeFileSync(path.join(overlayDir, name, 'config.json'), `${JSON.stringify({ enabled: false }, null, 2)}\n`);
  }

  return { scratch, main: path.join(root, pkg.main), overlayDir };
}

/**
 * Start the copied router, handshake it, send one signal, and answer how it left.
 *
 * @param {object} ctx - The calling case's ctx
 * @param {string} signal - The signal the host sends
 * @returns {Promise<{ code: number|null, signal: string|null, stderr: string }>}
 */
async function signalRouter(ctx, signal) {
  const router = spawn(process.execPath, [world.main], {
    env: { ...process.env, MCP_ROUTER_SERVERS_DIR: world.overlayDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  started.push(router);

  let stdout = '';
  let stderr = '';
  let exit = null;
  router.stdout.on('data', (chunk) => { stdout += chunk; });
  router.stderr.on('data', (chunk) => { stderr += chunk; });
  router.on('exit', (code, killedBy) => { exit = { code, signal: killedBy, stderr }; });

  router.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stop-signals', version: '1.0.0' } },
  })}\n`);

  // Ready is the answer to initialize; a router that died loading answers nothing.
  await ctx.waitFor(() => stdout.includes('"id":1') || exit);
  ctx.expect(exit, `the published router did not start: ${stderr}`).toBe(null);

  router.kill(signal);
  return ctx.waitFor(() => exit);
}

module.exports = defineCases({
  type: 'group',
  description: 'stop-signals',
  skip: process.platform === 'win32' ? 'POSIX signals: Windows delivers none of them to a child' : false,
  setup: () => {
    world = publishedCopy();
  },
  cleanup: () => {
    for (const child of started) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    if (world) fs.rmSync(world.scratch, { recursive: true, force: true });
  },
  tests: [
    {
      name: 'SIGINT, SIGTERM and SIGHUP each run the shipped router\'s own shutdown and exit 0',
      run: async (ctx) => {
        for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
          const left = await signalRouter(ctx, signal);
          ctx.expect({ code: left.code, signal: left.signal }, `${signal} killed it outright, the trees left behind: ${left.stderr}`).toEqual({ code: 0, signal: null });
        }
      },
    },
  ],
});
