// Main-process tests for `omega.request()`: the harmonized API fetch, built once
// on the instance through @omega.js/client's createRequest, the extension
// background's shape ([#945](https://github.com/Omega-JS-Stack/omega/issues/945)).
//
// The API is a real local HTTP server; the one seam is main's Firebase session
// (`omega.auth._firebaseAuth`), because a real signed-in session needs the auth
// emulator, which the e2e-desktop lane drives.

const http = require('http');
const defineCases = require('@omega.js/devkit/test/define-cases');

// A local API that records what reaches it and answers `{ ok: true }`
async function startApi() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  return { port: server.address().port, received, close: () => new Promise((resolve) => server.close(resolve)) };
}

module.exports = defineCases({
  type: 'suite',
  layer: 'main',
  description: 'omega.request (main)',
  tests: [
    {
      name: 'omega.request posts with the token omega.auth.getIdToken returns; signed out, getIdToken is null',
      run: async (ctx) => {
        const auth = ctx.omega.auth;
        const api = await startApi();
        const saved = {
          firebaseAuth: auth._firebaseAuth,
          https:        process.env.OMEGA_HTTPS_PORT,
          hosting:      process.env.OMEGA_HOSTING_PORT,
        };

        try {
          auth._firebaseAuth = { currentUser: { getIdToken: async () => 'token-1' } };
          ctx.expect(await auth.getIdToken()).toBe('token-1');

          // The API base is read as the call starts: the local stack, here this server
          delete process.env.OMEGA_HTTPS_PORT;
          process.env.OMEGA_HOSTING_PORT = String(api.port);
          const answer = await ctx.omega.request('/notes', { method: 'POST', body: { text: 'hi' } });

          ctx.expect(answer).toEqual({ ok: true });
          ctx.expect(api.received).toEqual([{ method: 'POST', url: '/notes', authorization: 'Bearer token-1', body: '{"text":"hi"}' }]);

          auth._firebaseAuth = { currentUser: null };
          ctx.expect(await auth.getIdToken()).toBeNull();
          auth._firebaseAuth = null;
          ctx.expect(await auth.getIdToken()).toBeNull();
        } finally {
          auth._firebaseAuth = saved.firebaseAuth;
          if (saved.https === undefined) delete process.env.OMEGA_HTTPS_PORT;
          else process.env.OMEGA_HTTPS_PORT = saved.https;
          if (saved.hosting === undefined) delete process.env.OMEGA_HOSTING_PORT;
          else process.env.OMEGA_HOSTING_PORT = saved.hosting;
          await api.close();
        }
      },
    },
  ],
});
