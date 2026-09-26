/**
 * Shared harness for the CMS target-path cases
 * ([#887](https://github.com/Omega-JS-Stack/omega/issues/887)).
 *
 * The technique: the REAL route handlers, against a REAL composed brand config
 * (written to disk and read back through the backend loader, so the target
 * overlay rules apply), with only the two external sinks doubled: the express
 * response `respond()` writes to, and GitHub's HTTP API. Everything the cases
 * assert (which target a request resolves to, the path a commit lands at, the
 * workflow a publish dispatches) is composed by the route itself.
 *
 * GitHub is doubled at `globalThis.fetch`, the seam Octokit resolves per call:
 * a real write would need a token, a network, and a repo to litter, and that is
 * exactly the "would destroy the run" case a stub is for. The double RECORDS
 * every call, so the request Octokit would have sent is the assertion.
 *
 * `_`-prefixed, so the runner never discovers it as a suite.
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');

const { loadConfig } = require('./_shared-config.js');
const Utilities = require('../../dist/omega/services/utilities.js');

/**
 * A real brand config on disk, composed through the real backend loader.
 *
 * @param {object} targets - The `targets` map, e.g. `{ web: { type: 'web' }, backend: { type: 'backend' } }`.
 * @returns {object} The composed config a route receives as `omega.config`.
 */
function brandConfig(targets) {
  const root = jetpack.tmpDir({ prefix: 'cms-target-' }).path();

  jetpack.write(path.join(root, 'config', 'omega.json5'), `{
    brand: { id: 'acme', name: 'Acme' },
    repo: { provider: 'github', org: 'Acme-Org' },
    targets: ${JSON.stringify(targets)},
  }`);

  try {
    return loadConfig(root, 'backend').config;
  } finally {
    jetpack.remove(root);
  }
}

/**
 * The omega surface the CMS routes actually touch: the composed config, the
 * module resolver, and Utilities (the real one, because slugify decides a
 * post's filename).
 *
 * @param {object} config - A brandConfig() result.
 * @param {object} [overrides] - Extra omega members (e.g. a `require` that answers `wonderful-fetch`).
 * @returns {object} The omega double.
 */
function fakeOmega(config, overrides) {
  const omega = {
    config: config,
    require: (name) => require(name),
    getApiUrl: () => 'https://example.com/api',
    ...overrides,
  };

  omega.utilities = new Utilities(omega);

  return omega;
}

/**
 * The route context double: `respond()` is the sink the handler writes its
 * answer to, and the rest is the ctx surface the CMS routes read.
 *
 * @param {object} omega - A fakeOmega() result.
 * @param {object} [options] - `{ now }` the request's start timestamp.
 * @returns {object} The ctx, carrying `sent` = `{ code, body }`.
 */
function recordingCtx(omega, options) {
  const settings = options || {};
  const sent = { code: null, body: null };

  return {
    sent: sent,
    omega: omega,
    tmpdir: jetpack.tmpDir({ prefix: 'cms-target-tmp-' }).path(),
    meta: { startTime: { timestamp: settings.now || new Date().toISOString() } },
    request: { data: settings.data || {} },
    log() {},
    warn() {},
    error() {},
    respond(body, opts) {
      sent.code = (opts || {}).code || 200;
      sent.body = body;
      return sent;
    },
  };
}

/**
 * A JSON reply in the shape Octokit's fetch seam expects.
 * @param {number} status - HTTP status.
 * @param {object} body - The payload.
 * @returns {Response} The reply.
 */
function jsonResponse(status, body) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status: status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * A GitHub API double: every call the CMS routes make, answered from memory and
 * RECORDED.
 *
 * @param {object} [options] - `{ searchItems }` the code-search hits to answer with, `{ contents }` a path -> file-body map the contents API serves.
 * @returns {{ fetch: Function, calls: Array<object> }} The fetch seam and the call log.
 */
function githubDouble(options) {
  const settings = options || {};
  const calls = [];
  let blobs = 0;

  const fetchDouble = async (url, init) => {
    const method = ((init || {}).method || 'GET').toUpperCase();
    const body = (init || {}).body ? JSON.parse(init.body) : null;
    const target = String(url);
    calls.push({ method: method, url: target, body: body });

    // The code search behind GET /content/post
    if (target.includes('/search/code')) {
      const items = settings.searchItems || [];
      return jsonResponse(200, { total_count: items.length, items: items });
    }

    // The single-file read/write behind POST /admin/repo/content and the post
    // body behind GET /content/post
    if (target.includes('/contents/')) {
      const filePath = decodeURIComponent(target.split('/contents/')[1]);

      if (method === 'GET') {
        const file = (settings.contents || {})[filePath];
        if (file === undefined) return jsonResponse(404, { message: 'Not Found' });

        return jsonResponse(200, {
          name: path.basename(filePath),
          path: filePath,
          size: file.length,
          sha: 'file-sha',
          content: Buffer.from(file).toString('base64'),
        });
      }

      return jsonResponse(200, { content: { path: filePath } });
    }

    // The Git Trees commit behind POST /admin/post
    if (target.includes('/git/ref/')) return jsonResponse(200, { ref: 'refs/heads/master', object: { sha: 'base-commit-sha' } });
    if (target.includes('/git/commits/')) return jsonResponse(200, { tree: { sha: 'base-tree-sha' } });
    if (target.endsWith('/git/blobs')) return jsonResponse(201, { sha: `blob-sha-${++blobs}` });
    if (target.endsWith('/git/trees')) return jsonResponse(201, { sha: 'new-tree-sha' });
    if (target.endsWith('/git/commits')) return jsonResponse(201, { sha: 'new-commit-sha' });
    if (target.includes('/git/refs/')) return jsonResponse(200, { object: { sha: 'new-commit-sha' } });

    // The D13 publish dispatch
    if (target.includes('/actions/workflows/')) return jsonResponse(204, null);
    if (/\/repos\/[^/]+\/[^/]+$/.test(target)) return jsonResponse(200, { default_branch: 'main' });

    return jsonResponse(404, { message: `No double for ${method} ${target}` });
  };

  return { fetch: fetchDouble, calls: calls };
}

/**
 * Run the thunk with GitHub doubled and GH_TOKEN present, restoring both after.
 *
 * @param {object} github - A githubDouble() result.
 * @param {Function} fn - The thunk.
 * @returns {Promise<*>} Whatever the thunk returns.
 */
async function withGithub(github, fn) {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GH_TOKEN;

  globalThis.fetch = github.fetch;
  process.env.GH_TOKEN = 'test-token';

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.GH_TOKEN;
    } else {
      process.env.GH_TOKEN = originalToken;
    }
  }
}

/**
 * A `wonderful-fetch` stand-in for the post route's image downloader: it writes
 * a REAL 8x8 JPEG at the requested destination, so sharp's metadata read and
 * the base64 encode downstream are the real ones.
 *
 * @returns {Function} The downloader.
 */
function imageDownloader() {
  const sharp = require('sharp');

  return async (url, options) => {
    const destination = `${options.download}.jpg`;
    const buffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();

    jetpack.write(destination, buffer);

    return { path: destination };
  };
}

/** An admin user the CMS routes accept. */
const ADMIN_USER = { authenticated: true, roles: { admin: true, blogger: false } };

module.exports = {
  ADMIN_USER,
  brandConfig,
  fakeOmega,
  recordingCtx,
  jsonResponse,
  githubDouble,
  withGithub,
  imageDownloader,
};
