// Self-hosted Firebase auth helpers (cp268) — skip semantics (no project /
// demo-* / env opt-out) plus the real fetch-and-write path against a local
// HTTP server standing in for {projectId}.firebaseapp.com.
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'firebase-auth-helpers',
  tests: [
    {
      name: 'firebase-auth-helpers: no cloud.config.projectId skips without touching the network',
      run: async (ctx) => {
        const outDir = tmpOut();
        const result = await fetchFirebaseAuthHelpers({ siteData: {}, outDir, logger: silentLogger });
        ctx.expect(result.skipped).toBe('no-project');
        ctx.expect(!fs.existsSync(path.join(outDir, '__')), 'nothing written').toBeTruthy();
      },
    },

    {
      name: 'firebase-auth-helpers: demo-* project (offline fixture) skips',
      run: async (ctx) => {
        const outDir = tmpOut();
        const siteData = { cloud: { config: { projectId: 'demo-sandbox' } } };
        const result = await fetchFirebaseAuthHelpers({ siteData, outDir, logger: silentLogger });
        ctx.expect(result.skipped).toBe('demo-project');
      },
    },

    {
      name: 'firebase-auth-helpers: OMEGA_SKIP_FIREBASE_AUTH=true skips with a loud warning',
      run: async (ctx) => {
        process.env.OMEGA_SKIP_FIREBASE_AUTH = 'true';
        try {
          const warnings = [];
          const siteData = { cloud: { config: { projectId: 'real-proj' } } };
          const result = await fetchFirebaseAuthHelpers({
            siteData,
            outDir: tmpOut(),
            logger: { log: () => {}, warn: (message) => warnings.push(message) },
          });
          ctx.expect(result.skipped).toBe('env');
          ctx.expect(warnings.join('\n')).toMatch(/sign-in redirects will 404/);
        } finally {
          delete process.env.OMEGA_SKIP_FIREBASE_AUTH;
        }
      },
    },

    {
      name: 'firebase-auth-helpers: fetches all six helper files into /__/ and stamps the iframe cache breaker',
      run: async (ctx) => {
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

          ctx.expect(result.skipped).toBe(false);
          for (const file of HELPER_FILES) {
            ctx.expect(fs.existsSync(path.join(outDir, file.local || file.remote)), `${file.local || file.remote} written`).toBeTruthy();
          }
          // The PAGE files land as .html so GitHub Pages serves them as text/html —
          // and the extensionless names must NOT exist, because a literal
          // extensionless file wins over Pages' clean-URL .html fallback and serves
          // as application/octet-stream (#135)
          ctx.expect(fs.readFileSync(path.join(outDir, '__/auth/handler.html'), 'utf8')).toBe('content of /__/auth/handler');
          ctx.expect(!fs.existsSync(path.join(outDir, '__/auth/handler')), 'extensionless handler not emitted').toBeTruthy();
          ctx.expect(!fs.existsSync(path.join(outDir, '__/auth/iframe')), 'extensionless iframe not emitted').toBeTruthy();
          ctx.expect(fs.readFileSync(path.join(outDir, '__/firebase/init.json'), 'utf8')).toBe('content of /__/firebase/init.json');
          // iframe.js reference carries a cache breaker HASHED from iframe.js'
          // fetched content — changes exactly when Firebase ships a new helper
          // (the scaffolded Cloudflare rule caches it for a year)
          const iframePage = fs.readFileSync(path.join(outDir, '__/auth/iframe.html'), 'utf8');
          const expectedHash = crypto.createHash('md5').update('content of /__/auth/iframe.js').digest('hex').slice(0, 8);
          ctx.expect(iframePage).toBe(`<script src="iframe.js?cb=${expectedHash}"></script>`);
          ctx.expect(served.length).toBe(HELPER_FILES.length);
        } finally {
          server.close();
        }
      },
    },

    {
      name: 'firebase-auth-helpers: a changed iframe markup warns loudly instead of silently skipping the breaker',
      run: async (ctx) => {
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

          ctx.expect(result.skipped).toBe(false);
          ctx.expect(warnings.join('\n')).toMatch(/cache breaker NOT applied/);
          // The page still ships verbatim — only the breaker is missing
          ctx.expect(fs.readFileSync(path.join(outDir, '__/auth/iframe.html'), 'utf8')).toBe('<script type="module" src="./iframe.mjs"></script>');
        } finally {
          server.close();
        }
      },
    },

    // #548 — nothing was cached: every production build fetched the six files
    // fresh, so one offline (or sandboxed, or rate-limited) build failed the whole
    // run AFTER emitting every page. The fetch is now write-through, and a failure
    // serves the last good copy loudly instead of taking the build down.
    {
      name: 'firebase-auth-helpers: a fetch failure serves the cached copy with a loud warn (#548)',
      run: async (ctx) => {
        const server = http.createServer((request, response) => {
          response.end(request.url === '/__/auth/iframe' ? '<script src="iframe.js"></script>' : `content of ${request.url}`);
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const cacheDir = tmpOut();
        const siteData = { cloud: { config: { projectId: 'real-proj' } } };

        // A successful build warms the cache…
        const warm = await fetchFirebaseAuthHelpers({ siteData, outDir: tmpOut(), logger: silentLogger, baseUrl, cacheDir });
        ctx.expect(warm.cached).toBe(false);

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

        ctx.expect(result.skipped).toBe(false);
        ctx.expect(result.cached, 'the build survives on the cached helpers').toBe(true);
        for (const file of HELPER_FILES) {
          ctx.expect(fs.existsSync(path.join(outDir, file.local || file.remote)), `${file.local || file.remote} written from cache`).toBeTruthy();
        }
        // Byte-identical to the fetched build, cache breaker and all
        const expectedHash = crypto.createHash('md5').update('content of /__/auth/iframe.js').digest('hex').slice(0, 8);
        ctx.expect(fs.readFileSync(path.join(outDir, '__/auth/iframe.html'), 'utf8')).toBe(`<script src="iframe.js?cb=${expectedHash}"></script>`);
        ctx.expect(fs.readFileSync(path.join(outDir, '__/firebase/init.json'), 'utf8')).toBe('content of /__/firebase/init.json');

        // The warn names the staleness — a cached helper set is a dated one
        const warned = warnings.join('\n');
        ctx.expect(warned, 'the warn says the helpers came from cache').toMatch(/cached/i);
        ctx.expect(warned, 'and dates the copy it served').toMatch(/\d{4}-\d{2}-\d{2}/);
      },
    },

    {
      name: 'firebase-auth-helpers: a fetch failure with nothing cached stays fatal (#548)',
      run: async (ctx) => {
        const server = http.createServer((request, response) => {
          response.statusCode = 404;
          response.end('not found');
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const baseUrl = `http://127.0.0.1:${server.address().port}`;

        try {
          const siteData = { cloud: { config: { projectId: 'real-proj' } } };
          await ctx.expect((() => fetchFirebaseAuthHelpers({ siteData, outDir: tmpOut(), logger: silentLogger, baseUrl, cacheDir: tmpOut() }))(), 'a first-ever offline build has nothing to serve — that is still a loud failure').rejects.toThrow(/Failed to fetch Firebase auth helper.*HTTP 404/);
        } finally {
          server.close();
        }
      },
    },

    {
      name: 'firebase-auth-helpers: a failing fetch fails the build loudly — and a 4xx fails fast, no retries',
      run: async (ctx) => {
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
          await ctx.expect((() => fetchFirebaseAuthHelpers({ siteData, outDir: tmpOut(), logger: silentLogger, baseUrl }))()).rejects.toThrow(/Failed to fetch Firebase auth helper.*HTTP 404/);
          // 4xx is permanent (wrong project id / helper path gone) — one attempt per file
          for (const [url, hits] of hitsByPath) {
            ctx.expect(hits, `${url} fetched once, not retried`).toBe(1);
          }
        } finally {
          server.close();
        }
      },
    },
  ],
});
