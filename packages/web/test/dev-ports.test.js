/**
 * N7 web-side port resolution: `omega dev`'s website-port allocator (pin via
 * --port or config ports.website, bump when taken, env-derived wanted) and
 * the sibling ports-file reader that composes the injected dev.ports map.
 * Real execution — real sockets hold ports, real temp-dir brands with real
 * ports files. High port numbers (428xx) avoid anything a dev machine runs.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { resolveWebsitePort, readSiblingPorts } = require('../src/commands/dev.js');

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

// ---- readSiblingPorts

test('merges live sibling maps, skips own app dir and dead pids, empty without brand root', () => {
  // Brand layout: <root>/config/omega.json5 + apps/{backend,website}
  const brand = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-brand-'));
  fs.mkdirSync(path.join(brand, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brand, 'config', 'omega.json5'), '{}');
  const backend = path.join(brand, 'apps', 'backend');
  const website = path.join(brand, 'apps', 'website');
  fs.mkdirSync(path.join(backend, '.temp'), { recursive: true });
  fs.mkdirSync(path.join(website, '.temp'), { recursive: true });

  // Live backend map (our own pid = definitely alive)
  fs.writeFileSync(path.join(backend, '.temp', 'ports.json'), JSON.stringify({
    ports: { hosting: 5003, auth: 9099 }, pid: process.pid, startedAt: 'x',
  }));
  // Own app's file must be skipped even with a live pid (a previous run of THIS server)
  fs.writeFileSync(path.join(website, '.temp', 'ports.json'), JSON.stringify({
    ports: { website: 4999 }, pid: process.pid, startedAt: 'x',
  }));

  assert.deepEqual(readSiblingPorts(website), { hosting: 5003, auth: 9099 });

  // Dead-pid sibling map is a crash leftover — ignored
  fs.writeFileSync(path.join(backend, '.temp', 'ports.json'), JSON.stringify({
    ports: { hosting: 5003 }, pid: 999999999, startedAt: 'x',
  }));
  assert.deepEqual(readSiblingPorts(website), {});

  // Standalone consumer (no brand root) → empty map, client falls back to classics
  const standalone = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-ports-standalone-'));
  assert.deepEqual(readSiblingPorts(standalone), {});
});

test('devServerOptions: clean-url + image fallback middleware + live-reload watch on the built asset trees', () => {
  const { devServerOptions } = require('../src/commands/dev.js');
  const options = devServerOptions('/tmp/site-out');

  assert.equal(options.middleware.length, 2);
  assert.ok(options.middleware.every((fn) => typeof fn === 'function'));
  // The dev server chokidars the OUT-dir asset trees our watcher rebuilds
  // into — css changes hot-swap, js changes reload; no hand refresh
  assert.deepEqual(options.watch, [
    path.join('/tmp/site-out', 'assets', 'css'),
    path.join('/tmp/site-out', 'assets', 'js'),
  ]);
});

test('devCleanUrls middleware: /signin, /signin/ and dotted slugs resolve to flat .html files', () => {
  const { devServerOptions } = require('../src/commands/dev.js');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-clean-urls-'));
  fs.writeFileSync(path.join(out, 'signin.html'), 'x');
  fs.mkdirSync(path.join(out, 'updates'));
  fs.writeFileSync(path.join(out, 'updates', 'v1.0.0.html'), 'x');
  fs.writeFileSync(path.join(out, 'real.txt'), 'x');

  const middleware = devServerOptions(out).middleware[0];
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
});

test('applyDevSiteUrl: dev builds link to the local origin, never the live site', () => {
  const { applyDevSiteUrl } = require('../src/commands/dev.js');
  const siteData = { url: 'https://playground.omegajs.dev', brand: { url: 'https://playground.omegajs.dev' } };

  applyDevSiteUrl(siteData, 4000);
  assert.equal(siteData.url, 'http://localhost:4000', 'site.url is the dev origin');

  applyDevSiteUrl(siteData, 4001);
  assert.equal(siteData.url, 'http://localhost:4001', 'bumped port carries through');
});
