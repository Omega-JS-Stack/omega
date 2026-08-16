/**
 * N7 web-side port resolution: `omega dev`'s website-port allocator (pin via
 * --port or config ports.website, bump when taken, env-derived wanted) and
 * the sibling ports-file reader that composes the injected dev.ports map.
 * Real execution — real sockets hold ports, real temp-dir brands with real
 * ports files. High port numbers (428xx) avoid anything a dev machine runs.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { resolveWebsitePort, websiteWantedPort, devPortsOption } = require('../src/commands/dev.js');
const { buildWith, miniData } = require('./lib/build.js');

function occupy(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen({ port, host: '127.0.0.1' }, () => resolve(server));
  });
}

// ---- resolveWebsitePort

test('free wanted port resolves unbumped (env-derived wanted)', async () => {
  process.env.OMEGA_WEBSITE_PORT = '42800';
  try {
    const { port, bumped } = await resolveWebsitePort(os.tmpdir(), null);
    assert.equal(port, 42800);
    assert.equal(bumped, false);
  } finally {
    delete process.env.OMEGA_WEBSITE_PORT;
  }
});

test('taken wanted port bumps +1', async () => {
  process.env.OMEGA_WEBSITE_PORT = '42810';
  const squatter = await occupy(42810);
  try {
    const { port, bumped } = await resolveWebsitePort(os.tmpdir(), null);
    assert.equal(port, 42811);
    assert.equal(bumped, true);
  } finally {
    delete process.env.OMEGA_WEBSITE_PORT;
    squatter.close();
  }
});

test('--port pins: free uses it verbatim, busy is a hard error', async () => {
  const { port, bumped } = await resolveWebsitePort(os.tmpdir(), 42820);
  assert.equal(port, 42820);
  assert.equal(bumped, false);

  const squatter = await occupy(42821);
  try {
    await assert.rejects(() => resolveWebsitePort(os.tmpdir(), 42821), /pinned via --port/);
  } finally {
    squatter.close();
  }
});

test('config ports.website pins', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-pin-'));
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), '{ ports: { website: 42830 } }');
  const { port, bumped } = await resolveWebsitePort(root, null);
  assert.equal(port, 42830);
  assert.equal(bumped, false);
});

// ---- websiteWantedPort (multi-instance offsets — deterministic, no binding)

test('websiteWantedPort: each instance wants base + its array position, side-by-side capable', () => {
  // 2-instance web brand: apps/website (main) + apps/website-admin
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-instances-'));
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), `{
    brand: { id: 'acme', name: 'Acme' },
    targets: { web: [{ id: 'main' }, { id: 'admin', url: 'https://admin.acme.test' }] },
  }`);
  const website = path.join(brand, 'apps', 'website');
  const admin = path.join(brand, 'apps', 'website-admin');
  fs.mkdirSync(website, { recursive: true });
  fs.mkdirSync(admin, { recursive: true });

  assert.equal(websiteWantedPort(website), 4000, 'main stays on the classic base');
  assert.equal(websiteWantedPort(admin), 4001, 'admin offsets by its instances-array position');

  // Env-derived base carries the offset too
  process.env.OMEGA_WEBSITE_PORT = '42840';
  try {
    assert.equal(websiteWantedPort(admin), 42841);
  } finally {
    delete process.env.OMEGA_WEBSITE_PORT;
  }
});

test('websiteWantedPort: single-object brands and config-less dirs stay on the classic base (zero breaking change)', () => {
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-single-'));
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), `{
    brand: { id: 'acme', name: 'Acme' },
    targets: { web: {} },
  }`);
  const website = path.join(brand, 'apps', 'website');
  fs.mkdirSync(website, { recursive: true });

  assert.equal(websiteWantedPort(website), 4000);
  assert.equal(websiteWantedPort(os.tmpdir()), 4000, 'no config → classic base, never a dev-loop failure');
});

// ---- devPortsOption (the live dev chrome the engine bakes per render)

/** A brand with a website app and a backend publishing `ports`. */
function bumpedBrand(ports) {
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-brand-'));
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), '{}');
  const backend = path.join(brand, 'apps', 'backend');
  const website = path.join(brand, 'apps', 'website');
  fs.mkdirSync(path.join(backend, '.temp'), { recursive: true });
  fs.mkdirSync(path.join(website, '.temp'), { recursive: true });
  const publish = (map) => fs.writeFileSync(path.join(backend, '.temp', 'ports.json'), JSON.stringify({
    ports: map, pid: process.pid, startedAt: 'x',
  }));
  publish(ports);
  return { brand, backend, website, publish };
}

test('devPortsOption: the backend map merges OVER the website\'s own, re-read on every call (#300)', () => {
  const { website, publish } = bumpedBrand({ auth: 9100, firestore: 8081, hosting: 5003 });

  const dev = devPortsOption(website, 4001);
  assert.deepEqual(dev(), {
    ports: { auth: 9100, firestore: 8081, hosting: 5003, website: 4001 },
    authEmulatorProxy: true,
  }, 'the sibling backend map rides along with this server\'s own port');

  // The emulator restarted onto different numbers — the NEXT read carries them
  // (a boot-time read would still be handing out 9100 here)
  publish({ auth: 9200, firestore: 8181, hosting: 5103 });
  assert.deepEqual(dev().ports, { auth: 9200, firestore: 8181, hosting: 5103, website: 4001 });

  // A website-only dev session still publishes its own port, never a stale guess
  const standalone = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-standalone-'));
  assert.deepEqual(devPortsOption(standalone, 4000)().ports, { website: 4000 });
});

test('the rendered dev page carries the BUMPED emulator ports, refreshed per render (#300)', async () => {
  const { website, publish } = bumpedBrand({ auth: 9100, firestore: 8081, hosting: 5003 });
  const dev = devPortsOption(website, 4001);

  const first = await buildWith(miniData, { environment: 'development', dev }, 'dev-ports-render-1');
  const html = first.get('/');
  assert.ok(html, 'the dev page rendered');
  const baked = JSON.parse(html.match(/dev: (\{.*?\}),\n/s)[1]);
  assert.deepEqual(baked.ports, { auth: 9100, firestore: 8081, hosting: 5003, website: 4001 },
    'the browser is handed the map of the stack that is ACTUALLY running');

  // Emulator restart between renders: the next render bakes the new numbers,
  // because the ports file is read at render time and not once at boot
  publish({ auth: 9200, firestore: 8181, hosting: 5103 });
  const second = await buildWith(miniData, { environment: 'development', dev }, 'dev-ports-render-2');
  const rebaked = JSON.parse(second.get('/').match(/dev: (\{.*?\}),\n/s)[1]);
  assert.deepEqual(rebaked.ports, { auth: 9200, firestore: 8181, hosting: 5103, website: 4001 });
});

test('a production build bakes no dev chrome at all', async () => {
  const pages = await buildWith(miniData, { environment: 'production' }, 'dev-ports-render-prod');
  // Minified output — the chrome is `dev:null`, so no port map can ever ship
  assert.ok(pages.get('/').includes('environment:"production",dev:null,'));
});

test('devServerOptions: auth-emulator proxy + clean-url + image fallback middleware + live-reload watch on the built asset trees', () => {
  const { devServerOptions } = require('../src/commands/dev.js');
  const options = devServerOptions('/tmp/site-out');

  assert.equal(options.middleware.length, 3);
  assert.ok(options.middleware.every((fn) => typeof fn === 'function'));
  // The dev server chokidars the OUT-dir asset trees our watcher rebuilds
  // into — css changes hot-swap, js changes reload; no hand refresh
  assert.deepEqual(options.watch, [
    path.join('/tmp/site-out', 'assets', 'css'),
    path.join('/tmp/site-out', 'assets', 'js'),
  ]);
});

test('devAuthEmulator middleware: the proxy target follows the LIVE map, per request (#300)', async (t) => {
  const { devServerOptions } = require('../src/commands/dev.js');
  const open = [];
  t.after(() => Promise.all(open.map((server) => new Promise((resolve) => server.close(resolve)))));

  // Two real stand-in emulators: the "foreign" one squatting the port this
  // session started on, and this brand's, which came up later on a bumped one
  const listen = async (label) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(label);
    });
    await new Promise((resolve) => server.listen({ port: 0, host: '127.0.0.1' }, resolve));
    open.push(server);
    return { server, port: server.address().port };
  };
  const foreign = await listen('foreign-emulator');
  const ours = await listen('our-emulator');

  // The live map: empty at boot (the backend had not published yet), then the
  // brand's own suite lands on its bumped port
  let live = foreign.port;
  const middleware = devServerOptions('/tmp/site-out-live', () => live).middleware[0];
  const site = http.createServer((req, res) => middleware(req, res, () => {
    res.writeHead(200);
    res.end('site');
  }));
  await new Promise((resolve) => site.listen({ port: 0, host: '127.0.0.1' }, resolve));
  open.push(site);
  const url = `http://127.0.0.1:${site.address().port}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=k`;
  const get = async () => (await fetch(url, { signal: AbortSignal.timeout(5000) })).text();

  assert.equal(await get(), 'foreign-emulator');

  live = ours.port;
  assert.equal(await get(), 'our-emulator',
    'no dev-server restart: the very next auth call goes to the stack that is running now');
});

test('devCleanUrls middleware: /signin, /signin/ and dotted slugs resolve to flat .html files', () => {
  const { devServerOptions } = require('../src/commands/dev.js');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-clean-urls-'));
  fs.writeFileSync(path.join(out, 'signin.html'), 'x');
  fs.mkdirSync(path.join(out, 'updates'));
  fs.writeFileSync(path.join(out, 'updates', 'v1.0.0.html'), 'x');
  fs.writeFileSync(path.join(out, 'real.txt'), 'x');

  const middleware = devServerOptions(out).middleware[1];
  const rewritten = (url) => {
    const req = { url };
    middleware(req, {}, () => {});
    return req.url;
  };

  assert.equal(rewritten('/signin'), '/signin.html', 'extensionless page resolves');
  assert.equal(rewritten('/signin/'), '/signin.html', 'stray trailing slash strips (legacy serve.js contract)');
  assert.equal(rewritten('/signin?next=/account'), '/signin.html?next=/account', 'query survives');
  assert.equal(rewritten('/updates/v1.0.0'), '/updates/v1.0.0.html', 'dotted slug is a page URL too');
  assert.equal(rewritten('/real.txt'), '/real.txt', 'real files pass through');
  assert.equal(rewritten('/missing'), '/missing', 'no .html candidate — untouched');
  assert.equal(rewritten('/%E0%A4%A'), '/%E0%A4%A', 'malformed percent-escape falls through instead of throwing URIError (wave-3 W6)');
});

test('devAuthEmulator middleware: the emulator surface answers on the SITE origin, everything else falls through (#156)', async () => {
  const { devServerOptions } = require('../src/commands/dev.js');

  // A real stand-in emulator on a real socket — the proxy is plumbing, and
  // plumbing is only proven by traffic actually arriving
  const seen = [];
  const emulator = http.createServer((req, res) => {
    seen.push(req.url);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`emulator:${req.url}`);
  });
  await new Promise((resolve) => emulator.listen({ port: 0, host: '127.0.0.1' }, resolve));
  const emulatorPort = emulator.address().port;

  // A real site server with the middleware in front, so a fall-through is a
  // real fall-through — and `res` goes through ELEVENTY'S OWN wrapper, the one
  // that defers a text/html writeHead into a replay queue to inject its
  // live-reload script. Proxying with writeHead + pipe crashes the whole dev
  // server on that replay (ERR_HTTP_HEADERS_SENT), and a bare http server
  // never sees it — the wrapper is the contract this middleware must satisfy.
  const wrapResponse = require('@11ty/eleventy-dev-server/server/wrapResponse.js');
  const middleware = devServerOptions('/tmp/site-out', emulatorPort).middleware[0];
  const site = http.createServer((req, res) => middleware(req, wrapResponse(res, (html) => `${html}<!--livereload-->`), () => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('site');
  }));
  await new Promise((resolve) => site.listen({ port: 0, host: '127.0.0.1' }, resolve));
  const sitePort = site.address().port;

  // Timeout, because the wrapper regression this pins does not answer wrong —
  // it kills the response and hangs the request
  const get = async (url) => {
    const response = await fetch(`http://127.0.0.1:${sitePort}${url}`, { signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: await response.text() };
  };

  // The OAuth handler and the helper iframe: BOTH first-party now, which is
  // the whole point — they share one storage partition with the page
  assert.deepEqual(await get('/emulator/auth/handler?apiKey=k&providerId=google.com'), {
    status: 200,
    body: 'emulator:/emulator/auth/handler?apiKey=k&providerId=google.com',
  });
  assert.deepEqual(await get('/emulator/auth/iframe?apiKey=k&appName=%5BDEFAULT%5D'), {
    status: 200,
    body: 'emulator:/emulator/auth/iframe?apiKey=k&appName=%5BDEFAULT%5D',
  });

  // The REST surface the SDK addresses as <emulator origin>/<apiHost><path>
  assert.equal((await get('/identitytoolkit.googleapis.com/v1/accounts:lookup?key=k')).body,
    'emulator:/identitytoolkit.googleapis.com/v1/accounts:lookup?key=k');
  assert.equal((await get('/securetoken.googleapis.com/v1/token?key=k')).body,
    'emulator:/securetoken.googleapis.com/v1/token?key=k');

  // Out-of-band action links ride the same prefix
  assert.equal((await get('/emulator/action?mode=verifyEmail')).body, 'emulator:/emulator/action?mode=verifyEmail');

  // Page URLs are untouched — no prefix can collide with one, including a
  // near-miss that merely starts with the same letters. Their HTML still gets
  // the wrapper's live-reload injection; the emulator's pages above do not.
  assert.equal((await get('/signin')).body, 'site<!--livereload-->');
  assert.equal((await get('/emulator-notes')).body, 'site<!--livereload-->');
  assert.equal(seen.length, 5, 'only the emulator surface was proxied');

  // A website-only dev session (no emulator) gets a named 502, not a hang
  await new Promise((resolve) => emulator.close(resolve));
  const dead = await get('/emulator/auth/handler?apiKey=k&providerId=google.com');
  assert.equal(dead.status, 502);
  assert.match(dead.body, new RegExp(`port ${emulatorPort}`));

  await new Promise((resolve) => site.close(resolve));
});

test('devAuthEmulator middleware: a non-loopback client never reaches the emulator (#156)', () => {
  const { devServerOptions } = require('../src/commands/dev.js');
  const middleware = devServerOptions('/tmp/site-out', 9099).middleware[0];

  // The emulator binds loopback only, on purpose; the site listens on every
  // interface. A LAN client hitting the proxied surface must fall through to
  // the normal 404 instead of being bridged to the emulator.
  let fellThrough = false;
  const req = {
    url: '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=k',
    method: 'POST',
    headers: {},
    socket: { remoteAddress: '192.168.86.42' },
  };
  middleware(req, {}, () => { fellThrough = true; });
  assert.equal(fellThrough, true, 'a LAN client falls through, the emulator stays loopback-only');
});

test('applyDevSiteUrl: dev builds link to the local origin, never the live site', () => {
  const { applyDevSiteUrl } = require('../src/commands/dev.js');
  const siteData = { url: 'https://playground.omegajs.dev', brand: { url: 'https://playground.omegajs.dev' } };

  applyDevSiteUrl(siteData, 4000);
  assert.equal(siteData.url, 'http://localhost:4000', 'site.url is the dev origin');

  applyDevSiteUrl(siteData, 4001);
  assert.equal(siteData.url, 'http://localhost:4001', 'bumped port carries through');

  applyDevSiteUrl(siteData, 4000, true);
  assert.equal(siteData.url, 'https://localhost:4000', 'https flag flips the scheme (mkcert proxy live)');
});
