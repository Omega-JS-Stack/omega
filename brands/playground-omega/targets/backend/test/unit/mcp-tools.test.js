/**
 * Consumer MCP tools guard: src/mcp.js loads through the framework's own loader,
 * every route-delegating tool points at a route this target ships, and the
 * handler tool carries its code instead of a path. A tool whose `path` names no
 * route answers 404 on every call, and nothing else would notice.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { defineCases } = require('@omega.js/backend/test');

const APP_DIR = path.join(__dirname, '..', '..');
const SRC = path.join(APP_DIR, 'src');
const { loadConsumerTools } = require(require.resolve('@omega.js/backend/lib/mcp-utils', { paths: [APP_DIR] }));

module.exports = defineCases({
  description: 'Consumer MCP tools: they load, and every route tool names a shipped route',
  type: 'group',

  tests: [
    {
      name: 'src-mcp-js-loads-through-the-framework-loader',

      run() {
        const tools = loadConsumerTools(SRC);

        // The loader answers [] for a missing, non-array, or malformed file, so an
        // empty answer is the failure signal
        assert.ok(tools.length > 0, 'the loader rejected src/mcp.js (see its console.error for why)');
        assert.deepEqual(tools.map((tool) => tool.name).sort(), ['count_notes', 'create_note', 'list_notes']);
      },
    },

    {
      name: 'every-route-tool-points-at-a-shipped-route-and-method',

      run() {
        // A tool's `path` is the HTTP path as served (`/notes`), so it maps to src/routes/<path>/
        for (const tool of loadConsumerTools(SRC).filter((t) => t.path)) {
          const route = tool.path.replace(/^\//, '');
          const file = path.join(SRC, 'routes', route, `${tool.method.toLowerCase()}.js`);

          assert.ok(fs.existsSync(file), `${tool.name} calls ${tool.method} ${tool.path}, but src/routes/${route}/${tool.method.toLowerCase()}.js does not exist`);
          assert.equal(tool.role, 'user', `${tool.name} is a signed-in user's tool`);
        }
      },
    },

    {
      name: 'the-handler-tool-runs-its-own-code-and-names-no-path',

      run() {
        const tool = loadConsumerTools(SRC).find((t) => t.name === 'count_notes');

        assert.equal(typeof tool.handler, 'function', 'count_notes carries a handler');
        assert.equal(tool.path, undefined, 'and no path: it never goes over HTTP');
        assert.equal(tool.role, 'user', 'a handler tool receives the signed-in caller, so it counts that user\'s own notes');
      },
    },
  ],
});
