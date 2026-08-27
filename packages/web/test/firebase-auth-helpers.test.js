// Self-hosted Firebase auth helpers (cp268) — skip semantics (no project /
// demo-* / env opt-out) plus the real fetch-and-write path against a local
// HTTP server standing in for {projectId}.firebaseapp.com.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { fetchFirebaseAuthHelpers, HELPER_FILES } = require('../src/firebase-auth-helpers.js');

const silentLogger = { log: () => {}, warn: () => {} };

function tmpOut() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'omega-auth-helpers-'));
}

test('firebase-auth-helpers: no cloud.config.projectId skips without touching the network', async () => {
  const outDir = tmpOut();
  const result = await fetchFirebaseAuthHelpers({ siteData: {}, outDir, logger: silentLogger });
  assert.equal(result.skipped, 'no-project');
  assert.ok(!fs.existsSync(path.join(outDir, '__')), 'nothing written');
});

test('firebase-auth-helpers: demo-* project (offline fixture) skips', async () => {
  const outDir = tmpOut();
  const siteData = { cloud: { config: { projectId: 'demo-sandbox' } } };
  const result = await fetchFirebaseAuthHelpers({ siteData, outDir, logger: silentLogger });
  assert.equal(result.skipped, 'demo-project');
});

test('firebase-auth-helpers: OMEGA_SKIP_FIREBASE_AUTH=true skips with a loud warning', async () => {
  process.env.OMEGA_SKIP_FIREBASE_AUTH = 'true';
  try {
    const warnings = [];
    const siteData = { cloud: { config: { projectId: 'real-proj' } } };
    const result = await fetchFirebaseAuthHelpers({
      siteData,
      outDir: tmpOut(),
      logger: { log: () => {}, warn: (message) => warnings.push(message) },
    });
    assert.equal(result.skipped, 'env');
    assert.match(warnings.join('\n'), /sign-in redirects will 404/);
  } finally {
    delete process.env.OMEGA_SKIP_FIREBASE_AUTH;
  }
});

test('firebase-auth-helpers: fetches all six helper files into /__/ and stamps the iframe cache breaker', async () => {
  const served = [];
  const server = http.createServer((request, response) => {
    served.push(request.url);
    if (request.url === '/__/auth/iframe') {
      response.end('<script src="iframe.js"></script>');
      return;
    }
    response.end(`content of ${request.url}`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const outDir = tmpOut();

  try {
    const siteData = { cloud: { config: { projectId: 'real-proj' } } };
    const result = await fetchFirebaseAuthHelpers({ siteData, outDir, logger: silentLogger, baseUrl });

    assert.equal(result.skipped, false);
    for (const file of HELPER_FILES) {
      assert.ok(fs.existsSync(path.join(outDir, file.local || file.remote)), `${file.local || file.remote} written`);
    }
    // The PAGE files land as .html so GitHub Pages serves them as text/html —
    // and the extensionless names must NOT exist, because a literal
    // extensionless file wins over Pages' clean-URL .html fallback and serves
    // as application/octet-stream (#135)
    assert.equal(fs.readFileSync(path.join(outDir, '__/auth/handler.html'), 'utf8'), 'content of /__/auth/handler');
    assert.ok(!fs.existsSync(path.join(outDir, '__/auth/handler')), 'extensionless handler not emitted');
    assert.ok(!fs.existsSync(path.join(outDir, '__/auth/iframe')), 'extensionless iframe not emitted');
    assert.equal(fs.readFileSync(path.join(outDir, '__/firebase/init.json'), 'utf8'), 'content of /__/firebase/init.json');
    // iframe.js reference carries a cache breaker HASHED from iframe.js'
    // fetched content — changes exactly when Firebase ships a new helper
    // (the scaffolded Cloudflare rule caches it for a year)
    const iframePage = fs.readFileSync(path.join(outDir, '__/auth/iframe.html'), 'utf8');
    const expectedHash = crypto.createHash('md5').update('content of /__/auth/iframe.js').digest('hex').slice(0, 8);
    assert.equal(iframePage, `<script src="iframe.js?cb=${expectedHash}"></script>`);
    assert.equal(served.length, HELPER_FILES.length);
  } finally {
    server.close();
  }
});

test('firebase-auth-helpers: a changed iframe markup warns loudly instead of silently skipping the breaker', async () => {
  const server = http.createServer((request, response) => {
    response.end(request.url === '/__/auth/iframe'
      ? '<script type="module" src="./iframe.mjs"></script>' // marker gone
      : `content of ${request.url}`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const outDir = tmpOut();

  try {
    const warnings = [];
    const siteData = { cloud: { config: { projectId: 'real-proj' } } };
    const result = await fetchFirebaseAuthHelpers({
      siteData,
      outDir,
      logger: { log: () => {}, warn: (message) => warnings.push(message) },
      baseUrl,
    });

    assert.equal(result.skipped, false);
    assert.match(warnings.join('\n'), /cache breaker NOT applied/);
    // The page still ships verbatim — only the breaker is missing
    assert.equal(fs.readFileSync(path.join(outDir, '__/auth/iframe.html'), 'utf8'), '<script type="module" src="./iframe.mjs"></script>');
  } finally {
    server.close();
  }
});

// #548 — nothing was cached: every production build fetched the six files
// fresh, so one offline (or sandboxed, or rate-limited) build failed the whole
// run AFTER emitting every page. The fetch is now write-through, and a failure
// serves the last good copy loudly instead of taking the build down.
test('firebase-auth-helpers: a fetch failure serves the cached copy with a loud warn (#548)', async () => {
  const server = http.createServer((request, response) => {
    response.end(request.url === '/__/auth/iframe' ? '<script src="iframe.js"></script>' : `content of ${request.url}`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const cacheDir = tmpOut();
  const siteData = { cloud: { config: { projectId: 'real-proj' } } };

  // A successful build warms the cache…
  const warm = await fetchFirebaseAuthHelpers({ siteData, outDir: tmpOut(), logger: silentLogger, baseUrl, cacheDir });
  assert.equal(warm.cached, false);

  // …and the origin goes away (offline build, sandboxed run, rate limit).
  // fetch() keeps its socket alive, so the pool is dropped with the listener.
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));

  const warnings = [];
  const outDir = tmpOut();
  const result = await fetchFirebaseAuthHelpers({
    siteData,
    outDir,
    logger: { log: () => {}, warn: (message) => warnings.push(message) },
    baseUrl,
    cacheDir,
  });

  assert.equal(result.skipped, false);
  assert.equal(result.cached, true, 'the build survives on the cached helpers');
  for (const file of HELPER_FILES) {
    assert.ok(fs.existsSync(path.join(outDir, file.local || file.remote)), `${file.local || file.remote} written from cache`);
  }
  // Byte-identical to the fetched build, cache breaker and all
  const expectedHash = crypto.createHash('md5').update('content of /__/auth/iframe.js').digest('hex').slice(0, 8);
  assert.equal(fs.readFileSync(path.join(outDir, '__/auth/iframe.html'), 'utf8'), `<script src="iframe.js?cb=${expectedHash}"></script>`);
  assert.equal(fs.readFileSync(path.join(outDir, '__/firebase/init.json'), 'utf8'), 'content of /__/firebase/init.json');

  // The warn names the staleness — a cached helper set is a dated one
  const warned = warnings.join('\n');
  assert.match(warned, /cached/i, 'the warn says the helpers came from cache');
  assert.match(warned, /\d{4}-\d{2}-\d{2}/, 'and dates the copy it served');
});

test('firebase-auth-helpers: a fetch failure with nothing cached stays fatal (#548)', async () => {
  const server = http.createServer((request, response) => {
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const siteData = { cloud: { config: { projectId: 'real-proj' } } };
    await assert.rejects(
      () => fetchFirebaseAuthHelpers({ siteData, outDir: tmpOut(), logger: silentLogger, baseUrl, cacheDir: tmpOut() }),
      /Failed to fetch Firebase auth helper.*HTTP 404/,
      'a first-ever offline build has nothing to serve — that is still a loud failure',
    );
  } finally {
    server.close();
  }
});

test('firebase-auth-helpers: a failing fetch fails the build loudly — and a 4xx fails fast, no retries', async () => {
  const hitsByPath = new Map();
  const server = http.createServer((request, response) => {
    hitsByPath.set(request.url, (hitsByPath.get(request.url) || 0) + 1);
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const siteData = { cloud: { config: { projectId: 'real-proj' } } };
    await assert.rejects(
      () => fetchFirebaseAuthHelpers({ siteData, outDir: tmpOut(), logger: silentLogger, baseUrl }),
      /Failed to fetch Firebase auth helper.*HTTP 404/,
    );
    // 4xx is permanent (wrong project id / helper path gone) — one attempt per file
    for (const [url, hits] of hitsByPath) {
      assert.equal(hits, 1, `${url} fetched once, not retried`);
    }
  } finally {
    server.close();
  }
});
