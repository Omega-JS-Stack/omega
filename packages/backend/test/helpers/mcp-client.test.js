/**
 * Test: the MCP HTTP client (src/mcp/client.js): a route tool's `path` is the
 * HTTP path AS SERVED, so the client prefixes nothing
 *
 * Run: npx omega test backend:helpers/mcp-client
 *
 * A built-in tool names `/omega/admin/firestore` and a consumer tool names its
 * own function's path (`/notes`): the client joins the base URL and the path,
 * untouched. Each case calls a REAL local HTTP server and reads the request it
 * received, so nothing about the wire is stubbed.
 */
const assert = require('node:assert');
const http = require('node:http');
const BEMClient = require('../../dist/mcp/client.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// One request against a real local server: the method and PATHNAME it received
// (wonderful-fetch appends its own `cb` cache-buster query), then it closes
async function callOnce(fn) {
  const received = [];
  const server = http.createServer((req, res) => {
    received.push({ method: req.method, path: new URL(req.url, 'http://127.0.0.1').pathname });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
    return received;
  } finally {
    server.close();
  }
}

module.exports = defineCases({
  description: 'MCP client call(): the path as served',
  type: 'group',

  tests: [
    {
      name: 'a-consumer-path-reaches-the-host-untouched',
      async run() {
        const received = await callOnce((baseUrl) => new BEMClient({ baseUrl }).call('POST', '/notes', { text: 'hi' }));

        assert.deepEqual(received, [{ method: 'POST', path: '/notes' }], 'no /omega/ prefix is added');
      },
    },

    {
      name: 'a-built-in-path-carries-its-own-omega-prefix',
      async run() {
        const received = await callOnce((baseUrl) => new BEMClient({ baseUrl: `${baseUrl}/` }).call('GET', '/omega/health', {}));

        assert.deepEqual(received, [{ method: 'GET', path: '/omega/health' }], 'the base URL\'s trailing slash is dropped, the path kept whole');
      },
    },

    {
      name: 'a-path-without-the-leading-slash-throws-by-name',
      async run() {
        const client = new BEMClient({ baseUrl: 'http://127.0.0.1:1' });

        await assert.rejects(
          () => client.call('GET', 'notes', {}),
          /path "notes" must be the HTTP path as served, starting with "\/"/,
        );
      },
    },
  ],
});
