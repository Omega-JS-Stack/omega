/**
 * Bundled-config sanity — these four files are the product for a fresh
 * install, they ship in the tarball, and nothing else parses them before a
 * user's first session. A personal path or an empty tools cache in one of
 * them is a shipped defect, so it fails here.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { BUNDLED_SERVERS_DIR } = require('../src/lib/paths.js');
const registry = require('../src/lib/registry.js');

// The bundled layer alone: a real user overlay must not colour these results.
const BUNDLED_ONLY = { overlayDir: path.join(os.tmpdir(), 'mcp-router-no-such-overlay') };

const EXPECTED = ['chrome-devtools', 'chrome-devtools-electron', 'chrome-devtools-extension', 'omega-extension'];

module.exports = defineCases({
  type: 'group',
  description: 'bundled-configs',
  tests: [
    {
      name: 'the package ships exactly the four default upstreams',
      run: (ctx) => {
        ctx.expect(fs.readdirSync(BUNDLED_SERVERS_DIR).sort()).toEqual(EXPECTED);
        ctx.expect(Object.keys(registry.loadUpstreams(BUNDLED_ONLY)).sort()).toEqual(EXPECTED);
      },
    },

    ...(() => {
      const cases = [];
      for (const name of EXPECTED) {
        cases.push({
          name: `${name} parses, is enabled, and carries a command and a tools cache`,
          run: (ctx) => {
            const raw = fs.readFileSync(path.join(BUNDLED_SERVERS_DIR, name, 'config.json'), 'utf8');
            ctx.expect(() => JSON.parse(raw)).not.toThrow();
            ctx.expect(raw.includes('/Users/'), 'a bundled config must carry no personal path').toBe(false);

            const upstream = registry.loadUpstream(name, BUNDLED_ONLY);
            ctx.expect(upstream.enabled_on_disk).toBe(true);
            ctx.expect(upstream.command, 'no command').toBeTruthy();
            ctx.expect(upstream.args.length > 0, 'no args').toBeTruthy();
            ctx.expect(upstream.tools.length > 0, 'empty tools cache').toBeTruthy();
            for (const tool of upstream.tools) {
              ctx.expect(tool.name && tool.inputSchema, `tool ${tool.name} has no schema`).toBeTruthy();
            }
          },
        });
      }
      return cases;
    })(),

    {
      name: 'the electron upstream carries its port default as a placeholder the router resolves',
      run: (ctx) => {
        const upstream = registry.loadUpstream('chrome-devtools-electron', BUNDLED_ONLY);
        ctx.expect(upstream.command).toBe('npx');
        const browserUrl = upstream.args.find((arg) => arg.startsWith('--browserUrl='));
        ctx.expect(browserUrl).toBe('--browserUrl=http://127.0.0.1:${OMEGA_CDP_PORT:-9222}');
        ctx.expect(upstream.args.join(' ').includes('EM_CDP_PORT'), 'the legacy port fallback is gone').toBe(false);
      },
    },

    {
      name: 'no bundled upstream launches through a shell',
      run: (ctx) => {
        // A shell command bypasses resolveBin entirely (Omega-JS-Stack/omega#178) and
        // hands the child's argv to a word-splitter nobody audits.
        for (const name of EXPECTED) {
          const upstream = registry.loadUpstream(name, BUNDLED_ONLY);
          ctx.expect(['sh', 'bash', 'zsh', 'cmd', 'cmd.exe', 'powershell'].includes(upstream.command), `${name} launches through a shell`).toBe(false);
        }
      },
    },

    {
      name: 'the launcher upstreams point at scripts this package ships, via the reserved placeholder',
      run: (ctx) => {
        const { resolveSpawn } = require('../src/lib/env.js');
        for (const [name, script] of [['chrome-devtools-extension', 'launch-cft.js'], ['omega-extension', 'launch-omega-extension.js']]) {
          const upstream = registry.loadUpstream(name, BUNDLED_ONLY);
          ctx.expect(upstream.command).toBe('node');
          // Root-relative through the placeholder, inside a folder `files` publishes.
          const [root, folder, file] = upstream.args[0].split('/');
          ctx.expect([root, file]).toEqual(['${MCP_ROUTER_ROOT}', script]);
          ctx.expect(require('../package.json').files, `${script} lives in ${folder}/, which never publishes`).toContain(`${folder}/`);
          ctx.expect(fs.existsSync(resolveSpawn(upstream).args[0]), `${script} is not on disk`).toBe(true);
        }
      },
    },

    {
      name: 'the extension upstream is on-demand; the others load automatically',
      run: (ctx) => {
        ctx.expect(registry.loadUpstream('chrome-devtools-extension', BUNDLED_ONLY).default).toBe('on-demand');
        for (const name of ['chrome-devtools', 'chrome-devtools-electron', 'omega-extension']) {
          ctx.expect(registry.loadUpstream(name, BUNDLED_ONLY).default).toBe('auto');
        }
      },
    },
  ],
});
