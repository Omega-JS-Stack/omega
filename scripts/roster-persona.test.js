/**
 * The sign-in lanes' persona helper: the email every lane builds (the localpart
 * on the brand's HOST, the seeder's one derivation, never the contact address),
 * and the roster lookup a lane makes with nothing but its persona's localpart.
 * The roster stand-in is a real local HTTP server in the route's response shape;
 * the route itself is proven against the emulator by the lanes.
 */
const assert = require('node:assert');
const http = require('node:http');
const { test } = require('node:test');
const { personaEmail, fetchRosterPersona } = require('./roster-persona');

// Serves `GET /omega/test/roster` with the given personas, recording each request url
async function startRoster(personas) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ personas }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return { apiBase: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('a persona lives on the brand host, not the contact address', () => {
  const config = {
    brand: { url: 'https://Playground.Example.dev/start', contact: { email: 'support@example.dev' } },
  };

  assert.equal(personaEmail(config, '_test.flows-signin'), '_test.flows-signin@playground.example.dev');
});

test('a brand with no url is a loud failure, never an address on nothing', () => {
  assert.throws(() => personaEmail({ brand: { contact: { email: 'support@example.dev' } } }, '_test.basic'), /brand\.url is missing/);
});

test('a lane names only its localpart: the helper asks for machinery and builds the playground address itself', async (t) => {
  const roster = await startRoster([{ localpart: '_test.referrer', label: 'Referrer' }, { localpart: '_test.desktop-auth-e2e', label: null }]);
  t.after(roster.close);

  const persona = await fetchRosterPersona({ apiBase: roster.apiBase, localpart: '_test.desktop-auth-e2e' });

  assert.deepEqual(persona, { email: '_test.desktop-auth-e2e@playground.omegajs.dev', password: 'omega-test-password' });
  assert.deepEqual(roster.requests, ['/omega/test/roster?machinery=true']);
});

test('a persona the roster does not offer is a loud failure, never an unseeded address', async (t) => {
  const roster = await startRoster([{ localpart: '_test.referrer', label: 'Referrer' }]);
  t.after(roster.close);

  await assert.rejects(fetchRosterPersona({ apiBase: roster.apiBase, localpart: '_test.desktop-auth-e2e' }), /does not offer _test\.desktop-auth-e2e/);
});
