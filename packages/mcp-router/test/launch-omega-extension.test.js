/**
 * launch-omega-extension tests. The upstream is only as portable as this
 * resolution, and since [#927](https://github.com/Omega-JS-Stack/omega/issues/927)
 * there is only one thing to resolve: the server file this package ships
 * beside the launcher. It used to be hunted down inside an installed
 * `@omega.js/manager`, which never publishes the tree it lived in.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');

const { SERVER, resolveServerPath, main } = require('../src/launch-omega-extension.js');

/**
 * Capture everything written to stderr while running a function.
 *
 * @param {Function} run - The body to run
 * @returns {string} What was written
 */
function captureStderr(run) {
  const chunks = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    run();
  } finally {
    process.stderr.write = write;
  }
  return chunks.join('');
}

module.exports = defineCases({
  type: 'group',
  description: 'launch-omega-extension',
  tests: [
    {
      name: 'the server is the file this package ships beside the launcher',
      run: (ctx) => {
        const resolved = resolveServerPath();
        ctx.expect(resolved.error, resolved.error).toBe(undefined);
        ctx.expect(resolved.server).toBe(SERVER);
        ctx.expect(resolved.server).toMatch(/mcp-router[/\\]servers[/\\]omega-extension[/\\]index\.js$/);
        ctx.expect(fs.existsSync(resolved.server), 'the shipped server is not on disk').toBe(true);
      },
    },

    {
      name: 'the shipped server imports nothing but this package own dependencies',
      run: (ctx) => {
        // The whole point of the move: the upstream starts with no manager, no brand
        // and no NODE_PATH, so every bare import must resolve from the server itself.
        const source = fs.readFileSync(SERVER, 'utf8');
        const bare = [...source.matchAll(/require\('([^.][^']*)'\)/g)].map((match) => match[1]);
        ctx.expect(bare.length > 0, 'no imports found: the scan is broken, not the server').toBeTruthy();
        for (const request of bare) {
          ctx.expect(() => require.resolve(request, { paths: [path.dirname(SERVER)] }), `${request} does not resolve for the shipped server`).not.toThrow();
        }
      },
    },

    {
      name: 'a broken install fails loudly, naming the file this package ships',
      run: (ctx) => {
        const resolved = resolveServerPath({ exists: () => false });
        ctx.expect(resolved.error).toMatch(/servers[/\\]omega-extension[/\\]index\.js is missing/);
        ctx.expect(resolved.error).toMatch(/@omega\.js\/mcp-router ships/);
      },
    },

    {
      name: 'main runs the shipped server on this node and forwards its exit code',
      run: (ctx) => {
        const calls = [];
        const exits = [];
        main({
          exists: () => true,
          execPath: '/usr/bin/node',
          exit: (code) => exits.push(code),
          spawn: (command, args, options) => {
            calls.push({ command, args, options });
            return { on: (event, handler) => { if (event === 'exit') handler(0, null); } };
          },
        });
        ctx.expect(calls.length).toBe(1);
        ctx.expect(calls[0].command).toBe('/usr/bin/node');
        ctx.expect(calls[0].args).toEqual([SERVER]);
        ctx.expect(calls[0].options.stdio).toBe('inherit');
        // No env override at all: a NODE_PATH used to carry this package's
        // node_modules to a server that sat in someone else's tree.
        ctx.expect(calls[0].options.env).toBe(undefined);
        ctx.expect(exits).toEqual([0]);
      },
    },

    {
      name: 'a missing server exits 1 without spawning',
      run: (ctx) => {
        const exits = [];
        const said = captureStderr(() => {
          main({
            exists: () => false,
            exit: (code) => exits.push(code),
            spawn: () => ctx.expect.fail('must not spawn when the server is missing'),
          });
        });
        ctx.expect(exits).toEqual([1]);
        ctx.expect(said).toMatch(/omega-extension/);
      },
    },
  ],
});
