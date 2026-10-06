/**
 * N7 web-side port resolution: `omega dev`'s website-port allocator (pin via
 * --port or config ports.website, bump when taken, env-derived wanted) and
 * the sibling ports-file reader that composes the injected dev.ports map.
 * Real execution — real sockets hold ports, real temp-dir brands with real
 * ports files. High port numbers (428xx) avoid anything a dev machine runs.
 */
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { resolveWebsitePort, websiteWantedPort, devPortsOption, devWebsiteOrigin } = require('../src/commands/dev.js');
const { writePortsFile, readPortsFile } = require('@omega.js/config');
const { buildWith, readBuildJson, runBuildJs, miniData } = require('./lib/build.js');

function occupy(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen({ port, host: '127.0.0.1' }, () => resolve(server));
  });
}

// ---- devPortsOption (the live dev chrome the engine bakes per render)

/**
 * A brand with a website target and a backend publishing `ports` — no `ports`
 * means the backend has not published yet (the boot-order case, #346).
 */
function bumpedBrand(ports) {
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-brand-'));
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), '{}');
  const backend = path.join(brand, 'targets', 'backend');
  const website = path.join(brand, 'targets', 'web');
  fs.mkdirSync(path.join(backend, '.temp'), { recursive: true });
  fs.mkdirSync(path.join(website, '.temp'), { recursive: true });
  const publish = (map) => fs.writeFileSync(path.join(backend, '.temp', 'ports.json'), JSON.stringify({
    ports: map, pid: process.pid, startedAt: 'x',
  }));
  if (ports) publish(ports);
  return { brand, backend, website, publish };
}

/** The dev chrome a BUILD wrote, read back out of its /build.js (#743). */
function buildChrome(pages) {
  return readBuildJson(pages).config.dev;
}

/** The dev chrome a SERVED build.js carries, read the way a browser runs it. */
function servedChrome(source) {
  return runBuildJs(source).config.dev;
}

/**
 * GET a path off a dev server the way a BROWSER asks for it. Raw http, not
 * fetch: the request announces itself as a navigation (sec-fetch-mode), which
 * is what eleventy's live-reload injection keys on — and fetch strips that
 * header, so a page requested with it is served the client-request way no
 * browser ever sees.
 */
function navigate(port, urlPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1',
      port,
      path: urlPath,
      headers: { 'sec-fetch-mode': 'navigate' },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    });
    request.on('error', reject);
  });
}

/** A dev server over `outDir`, wired exactly as the dev loop wires it. */
function devServer(name, outDir, port, dev) {
  const { devServerOptions } = require('../src/commands/dev.js');
  const EleventyDevServer = require('@11ty/eleventy-dev-server');
  const server = new EleventyDevServer(name, outDir, {
    ...devServerOptions(outDir, () => dev().ports.auth, dev),
    logger: { info: () => {}, log: () => {}, error: () => {} },
  });
  server.serve(port);
  return server;
}

module.exports = defineCases({
  type: 'group',
  description: 'dev-ports',
  tests: [
    // ---- resolveWebsitePort

    {
      name: 'free wanted port resolves unbumped (env-derived wanted)',
      run: async (ctx) => {
        process.env.OMEGA_WEBSITE_PORT = '42800';
        try {
          const { port, bumped } = await resolveWebsitePort(os.tmpdir(), null);
          ctx.expect(port).toBe(42800);
          ctx.expect(bumped).toBe(false);
        } finally {
          delete process.env.OMEGA_WEBSITE_PORT;
        }
      },
    },

    {
      name: 'taken wanted port bumps +1',
      run: async (ctx) => {
        process.env.OMEGA_WEBSITE_PORT = '42810';
        const squatter = await occupy(42810);
        try {
          const { port, bumped } = await resolveWebsitePort(os.tmpdir(), null);
          ctx.expect(port).toBe(42811);
          ctx.expect(bumped).toBe(true);
        } finally {
          delete process.env.OMEGA_WEBSITE_PORT;
          squatter.close();
        }
      },
    },

    {
      name: '--port pins: free uses it verbatim, busy is a hard error',
      run: async (ctx) => {
        const { port, bumped } = await resolveWebsitePort(os.tmpdir(), 42820);
        ctx.expect(port).toBe(42820);
        ctx.expect(bumped).toBe(false);

        const squatter = await occupy(42821);
        try {
          await ctx.expect((() => resolveWebsitePort(os.tmpdir(), 42821))()).rejects.toThrow(/pinned via --port/);
        } finally {
          squatter.close();
        }
      },
    },

    {
      name: 'config ports.website pins',
      run: async (ctx) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-pin-'));
        fs.mkdirSync(path.join(root, 'config'));
        fs.writeFileSync(path.join(root, 'config', 'omega.json5'), '{ ports: { website: 42830 } }');
        const { port, bumped } = await resolveWebsitePort(root, null);
        ctx.expect(port).toBe(42830);
        ctx.expect(bumped).toBe(false);
      },
    },

    // ---- websiteWantedPort (per-target offsets: deterministic, no binding)

    {
      name: 'websiteWantedPort: each web target wants base + its position among the web targets (#886)',
      run: (ctx) => {
        // A brand running two NAMED web targets: targets/web + targets/admin
        const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-named-'));
        fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
        fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), `{
    brand: { id: 'acme', name: 'Acme' },
    targets: {
      web: { type: 'web' },
      admin: { type: 'web', url: 'https://admin.acme.test' },
    },
  }`);
        const web = path.join(brand, 'targets', 'web');
        const admin = path.join(brand, 'targets', 'admin');
        fs.mkdirSync(web, { recursive: true });
        fs.mkdirSync(admin, { recursive: true });

        ctx.expect(websiteWantedPort(web), 'the first web target stays on the classic base').toBe(4000);
        ctx.expect(websiteWantedPort(admin), 'admin offsets by its position among the web targets').toBe(4001);

        // Env-derived base carries the offset too
        process.env.OMEGA_WEBSITE_PORT = '42840';
        try {
          ctx.expect(websiteWantedPort(admin)).toBe(42841);
        } finally {
          delete process.env.OMEGA_WEBSITE_PORT;
        }
      },
    },

    {
      name: 'websiteWantedPort: a one-web-target brand and config-less dirs stay on the classic base',
      run: (ctx) => {
        const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-single-'));
        fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
        fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), `{
    brand: { id: 'acme', name: 'Acme' },
    targets: { web: { type: 'web' } },
  }`);
        const web = path.join(brand, 'targets', 'web');
        fs.mkdirSync(web, { recursive: true });

        ctx.expect(websiteWantedPort(web)).toBe(4000);
        ctx.expect(websiteWantedPort(os.tmpdir()), 'no config → classic base, never a dev-loop failure').toBe(4000);
      },
    },

    {
      name: 'devPortsOption: the classic floor, the backend map over it, this server\'s port on top (#300, #834)',
      run: (ctx) => {
        const { CLASSIC_PORTS } = require('@omega.js/config');
        const { website, publish } = bumpedBrand({ auth: 9100, firestore: 8081, hosting: 5003 });

        const dev = devPortsOption(website, 4001, 'https://localhost:4001');
        ctx.expect(dev(), 'the sibling backend map rides over the classics, under this server\'s own port').toEqual({
          // The classic map is the FLOOR, from @omega.js/config
          // ([#834](https://github.com/Omega-JS-Stack/omega/issues/834)): nothing in
          // the browser carries a copy of these numbers any more, so a page always
          // receives a COMPLETE map, with the live stack's resolved numbers over it.
          ports: { ...CLASSIC_PORTS, auth: 9100, firestore: 8081, hosting: 5003, website: 4001 },
          origin: 'https://localhost:4001',
          authEmulatorProxy: true,
        });

        // The emulator restarted onto different numbers — the NEXT read carries them
        // (a boot-time read would still be handing out 9100 here)
        publish({ auth: 9200, firestore: 8181, hosting: 5103 });
        ctx.expect(dev().ports).toEqual({ ...CLASSIC_PORTS, auth: 9200, firestore: 8181, hosting: 5103, website: 4001 });

        // A website-only dev session publishes its own port over the classic floor,
        // never a stale guess and never a hole for the browser to assume through
        const standalone = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-standalone-'));
        ctx.expect(devPortsOption(standalone, 4000, 'http://localhost:4000')().ports).toEqual({ ...CLASSIC_PORTS, website: 4000 });
      },
    },

    {
      name: 'the dev website ORIGIN is a resolved fact: published beside the map, carried in the chrome (#262)',
      run: (ctx) => {
        const { readSiblingOrigin } = require('@omega.js/config');
        const { website, brand } = bumpedBrand({ auth: 9100 });

        // Protocol is not derivable from a port number — https when the mkcert proxy
        // fronts the public port, http when it could not (`--no-https`, no mkcert)
        ctx.expect(devWebsiteOrigin(4001, true)).toBe('https://localhost:4001');
        ctx.expect(devWebsiteOrigin(4001, false)).toBe('http://localhost:4001');

        // The chrome every client reads carries it beside the ports
        ctx.expect(devPortsOption(website, 4001, devWebsiteOrigin(4001, true))().origin).toBe('https://localhost:4001');

        // And so does the ports file, so a sibling target's BUILD can bake it
        writePortsFile(website, { website: 4001 }, { origin: devWebsiteOrigin(4001, true) });
        ctx.expect(readSiblingOrigin(path.join(brand, 'targets', 'extension')), 'the extension target beside it reads the resolved origin, protocol included').toBe('https://localhost:4001');
        ctx.expect(readPortsFile(website), 'the port map reads back unchanged').toEqual({ website: 4001 });
      },
    },

    {
      name: 'the built dev snapshot carries the BUMPED emulator ports, refreshed per build (#300)',
      run: async (ctx) => {
        const { website, publish } = bumpedBrand({ auth: 9100, firestore: 8081, hosting: 5003 });
        const dev = devPortsOption(website, 4001);

        const { CLASSIC_PORTS } = require('@omega.js/config');

        const first = await buildWith(miniData, { environment: 'development', dev }, 'dev-ports-render-1');
        ctx.expect(first.get('/'), 'the dev page rendered').toBeTruthy();
        ctx.expect(buildChrome(first).ports, 'the browser is handed the map of the stack that is ACTUALLY running, over the classic floor (#834)').toEqual({ ...CLASSIC_PORTS, auth: 9100, firestore: 8081, hosting: 5003, website: 4001 });

        // Emulator restart between builds: the next build writes the new numbers,
        // because the ports file is read on the way in and not once at boot
        publish({ auth: 9200, firestore: 8181, hosting: 5103 });
        const second = await buildWith(miniData, { environment: 'development', dev }, 'dev-ports-render-2');
        ctx.expect(buildChrome(second).ports).toEqual({ ...CLASSIC_PORTS, auth: 9200, firestore: 8181, hosting: 5103, website: 4001 });
      },
    },

    {
      name: 'boot order website-then-backend: the SERVED /build.js carries the backend map, no rebuild in between (#346)',
      run: async (ctx) => {
        const { CLASSIC_PORTS } = require('@omega.js/config');
        const { website, publish } = bumpedBrand(null);
        const port = 42850;
        const dev = devPortsOption(website, port);

        // The website build finishes in under a second while the backend seeds for
        // minutes, so the snapshot it writes carries the website-only map
        const pages = await buildWith(miniData, { environment: 'development', dev }, 'dev-ports-serve');
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-serve-'));
        const buildJs = path.join(out, 'build.js');
        fs.writeFileSync(buildJs, pages.get('/build.js'));
        fs.writeFileSync(path.join(out, 'index.html'), pages.get('/'));
        ctx.expect(servedChrome(fs.readFileSync(buildJs, 'utf8')).ports, 'the written snapshot is stale by construction: the emulator suite came up after it, so only the classic floor is under this server\'s own port').toEqual({ ...CLASSIC_PORTS, website: port });

        // The REAL dev server, handed the REAL options object the dev loop builds:
        // a rewrite that only works outside eleventy's response wrapper (the one
        // that injects the live-reload script) proves nothing.
        const server = devServer('dev-ports-346', out, port, dev);
        ctx.after(() => server.close());

        // The emulator suite lands, minutes in: nothing changed under src/, so no
        // rebuild ever runs, and the very next request for thefile carries the map
        publish({ auth: 9100, firestore: 8081, hosting: 5003 });
        const served = await navigate(port, '/build.js');
        ctx.expect(servedChrome(served), 'the served snapshot is handed the stack that is ACTUALLY running').toEqual({
          ports: { ...CLASSIC_PORTS, auth: 9100, firestore: 8081, hosting: 5003, website: port },
          authEmulatorProxy: true,
        });

        // Mid-session emulator restart onto bumped numbers — same story, next request
        publish({ auth: 9200, firestore: 8181, hosting: 5103 });
        ctx.expect(servedChrome(await navigate(port, '/build.js')).ports).toEqual({ ...CLASSIC_PORTS, auth: 9200, firestore: 8181, hosting: 5103, website: port });

        // The page is untouched by the rewrite, and still gets eleventy's live-reload
        const page = await navigate(port, '/');
        ctx.expect(page.includes('/.11ty/reload-client.js'), 'a page is served as it was built, live-reload and all').toBeTruthy();

        // The written file is ADVISORY: dist on disk is byte-for-byte what the build wrote
        ctx.expect(servedChrome(fs.readFileSync(buildJs, 'utf8')).ports).toEqual({ ...CLASSIC_PORTS, website: port });
      },
    },

    {
      name: 'the serve-time rewrite is /build.js only: no asset, no page (#346)',
      run: async (ctx) => {
        const { website } = bumpedBrand({ auth: 9100 });
        const port = 42860;
        const dev = devPortsOption(website, port);
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-untouched-'));

        // A page (a redirect stub) and a js bundle whose SOURCE reads exactly like
        // the snapshot's dev statement: the PATH is all that stands between them and
        // a rewrite, so a bundle that quotes it is served verbatim.
        const stub = '<!doctype html>\n<html><head><meta http-equiv="refresh" content="0; url=/signin"></head><body></body></html>\n';
        const bundle = 'self.OMEGA_BUILD_JSON.config.dev = {"ports":{"website":1}};\nexport default {};\n';
        fs.writeFileSync(path.join(out, 'redirect.html'), stub);
        fs.mkdirSync(path.join(out, 'assets', 'js'), { recursive: true });
        fs.writeFileSync(path.join(out, 'assets', 'js', 'main.js'), bundle);

        const server = devServer('dev-ports-346-untouched', out, port, dev);
        ctx.after(() => server.close());

        ctx.expect(await navigate(port, '/assets/js/main.js'), 'a js bundle is served verbatim').toBe(bundle);
        const served = await navigate(port, '/redirect');
        ctx.expect(served.replace(/<script type="module" integrity=[^>]+><\/script>/, ''), 'a page is its own markup plus eleventy\'s live-reload script, and nothing else').toBe(stub);
      },
    },

    {
      name: 'a production build writes no dev chrome at all',
      run: async (ctx) => {
        const pages = await buildWith(miniData, { environment: 'production' }, 'dev-ports-render-prod');
        const buildJson = readBuildJson(pages);

        ctx.expect(buildJson.config.environment).toBe('production');
        // The statement is always there, so the shape is one shape everywhere and the
        // serve-time rewrite has one line to find; `null` is what a build with no
        // local stack writes, and no port map can ever ship in it.
        ctx.expect(pages.get('/build.js').includes('self.OMEGA_BUILD_JSON.config.dev = null;')).toBeTruthy();
        ctx.expect(buildJson.config.dev).toBe(null);
      },
    },

    {
      name: 'devServerOptions: auth-emulator proxy + clean-url + image fallback middleware + live-reload watch on the built asset trees',
      run: (ctx) => {
        const { devServerOptions } = require('../src/commands/dev.js');
        const options = devServerOptions('/tmp/site-out');

        ctx.expect(options.middleware.length).toBe(3);
        ctx.expect(options.middleware.every((fn) => typeof fn === 'function')).toBeTruthy();
        // The dev server chokidars the OUT-dir asset trees our watcher rebuilds
        // into — css changes hot-swap, js changes reload; no hand refresh
        ctx.expect(options.watch).toEqual([
          path.join('/tmp/site-out', 'assets', 'css'),
          path.join('/tmp/site-out', 'assets', 'js'),
        ]);
      },
    },

    {
      name: 'devAuthEmulator middleware: the proxy target follows the LIVE map, per request (#300)',
      run: async (ctx) => {
        const { devServerOptions } = require('../src/commands/dev.js');
        const open = [];
        ctx.after(() => Promise.all(open.map((server) => new Promise((resolve) => server.close(resolve)))));

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

        ctx.expect(await get()).toBe('foreign-emulator');

        live = ours.port;
        ctx.expect(await get(), 'no dev-server restart: the very next auth call goes to the stack that is running now').toBe('our-emulator');
      },
    },

    {
      name: 'devCleanUrls middleware: /signin, /signin/ and dotted slugs resolve to flat .html files',
      run: (ctx) => {
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

        ctx.expect(rewritten('/signin'), 'extensionless page resolves').toBe('/signin.html');
        ctx.expect(rewritten('/signin/'), 'stray trailing slash strips (legacy serve.js contract)').toBe('/signin.html');
        ctx.expect(rewritten('/signin?next=/account'), 'query survives').toBe('/signin.html?next=/account');
        ctx.expect(rewritten('/updates/v1.0.0'), 'dotted slug is a page URL too').toBe('/updates/v1.0.0.html');
        ctx.expect(rewritten('/real.txt'), 'real files pass through').toBe('/real.txt');
        ctx.expect(rewritten('/missing'), 'no .html candidate — untouched').toBe('/missing');
        ctx.expect(rewritten('/%E0%A4%A'), 'malformed percent-escape falls through instead of throwing URIError (wave-3 W6)').toBe('/%E0%A4%A');
      },
    },

    {
      name: 'devAuthEmulator middleware: the emulator surface answers on the SITE origin, everything else falls through (#156)',
      run: async (ctx) => {
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
        ctx.expect(await get('/emulator/auth/handler?apiKey=k&providerId=google.com')).toEqual({
          status: 200,
          body: 'emulator:/emulator/auth/handler?apiKey=k&providerId=google.com',
        });
        ctx.expect(await get('/emulator/auth/iframe?apiKey=k&appName=%5BDEFAULT%5D')).toEqual({
          status: 200,
          body: 'emulator:/emulator/auth/iframe?apiKey=k&appName=%5BDEFAULT%5D',
        });

        // The REST surface the SDK addresses as <emulator origin>/<apiHost><path>
        ctx.expect((await get('/identitytoolkit.googleapis.com/v1/accounts:lookup?key=k')).body).toBe('emulator:/identitytoolkit.googleapis.com/v1/accounts:lookup?key=k');
        ctx.expect((await get('/securetoken.googleapis.com/v1/token?key=k')).body).toBe('emulator:/securetoken.googleapis.com/v1/token?key=k');

        // Out-of-band action links ride the same prefix
        ctx.expect((await get('/emulator/action?mode=verifyEmail')).body).toBe('emulator:/emulator/action?mode=verifyEmail');

        // Page URLs are untouched — no prefix can collide with one, including a
        // near-miss that merely starts with the same letters. Their HTML still gets
        // the wrapper's live-reload injection; the emulator's pages above do not.
        ctx.expect((await get('/signin')).body).toBe('site<!--livereload-->');
        ctx.expect((await get('/emulator-notes')).body).toBe('site<!--livereload-->');
        ctx.expect(seen.length, 'only the emulator surface was proxied').toBe(5);

        // A website-only dev session (no emulator) gets a named 502, not a hang
        await new Promise((resolve) => emulator.close(resolve));
        const dead = await get('/emulator/auth/handler?apiKey=k&providerId=google.com');
        ctx.expect(dead.status).toBe(502);
        ctx.expect(dead.body).toMatch(new RegExp(`port ${emulatorPort}`));

        await new Promise((resolve) => site.close(resolve));
      },
    },

    {
      name: 'devAuthEmulator middleware: a non-loopback client never reaches the emulator (#156)',
      run: (ctx) => {
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
        ctx.expect(fellThrough, 'a LAN client falls through, the emulator stays loopback-only').toBe(true);
      },
    },

    {
      name: 'applyDevSiteUrl: dev builds link to the local origin, never the live site',
      run: (ctx) => {
        const { applyDevSiteUrl } = require('../src/commands/dev.js');
        const siteData = { url: 'https://playground.omegajs.dev', brand: { url: 'https://playground.omegajs.dev' } };

        // site.url IS the resolved dev origin — the same one the ports file and the
        // page chrome publish, never a second derivation of it (#262)
        applyDevSiteUrl(siteData, devWebsiteOrigin(4000, false));
        ctx.expect(siteData.url, 'site.url is the dev origin').toBe('http://localhost:4000');

        applyDevSiteUrl(siteData, devWebsiteOrigin(4001, false));
        ctx.expect(siteData.url, 'bumped port carries through').toBe('http://localhost:4001');

        applyDevSiteUrl(siteData, devWebsiteOrigin(4000, true));
        ctx.expect(siteData.url, 'https flag flips the scheme (mkcert proxy live)').toBe('https://localhost:4000');
      },
    },
  ],
});
