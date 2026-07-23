const { assert } = require('../helpers.js');

// createRequest is pure wiring (deps-injected) — testable without the singleton.
// The real-wire proof (live emulator, real backend, real omega-properties) is
// the root `npm run test:auth` lane.
let createRequest;
let mergeUsageIntoBindings;

// Minimal fetch stand-in: the only seam is the network itself (stubbing the
// transport boundary, not our own modules). Each call records the request and
// returns the queued response.
function fetchStub(queue) {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    const next = queue.shift() || {};
    const headers = new Map(Object.entries(next.headers || {}));
    return {
      ok: next.ok !== false,
      status: next.status || 200,
      headers: {
        get: (name) => headers.get(name.toLowerCase()) || null,
      },
      json: async () => next.json,
      text: async () => next.text || '',
    };
  };
  return calls;
}

describe('Request Module', () => {

  before(async () => {
    const mod = await import('../../src/modules/request.js');
    createRequest = mod.createRequest;
    mergeUsageIntoBindings = mod.mergeUsageIntoBindings;
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('should require getApiUrl and getIdToken deps', () => {
    assert.throws(() => createRequest({}), /getApiUrl and getIdToken/);
  });

  it('should default to POST when a body is present (GET with a body is a guaranteed fetch TypeError)', async () => {
    const calls = fetchStub([{ headers: { 'content-type': 'application/json' }, json: {} }]);
    const request = createRequest({
      getApiUrl: () => 'https://api.example.com',
      getIdToken: () => null,
    });

    await request('/omega/marketing/contact', { auth: false, body: { email: 'a@b.co' } });
    await request('/omega/verts/serve', { auth: false });

    assert.strictEqual(calls[0].options.method, 'POST', 'body and no method infers POST');
    assert.strictEqual(calls[1].options.method, 'GET', 'no body stays GET');
  });

  it('should resolve route-relative paths through getApiUrl and attach a Bearer token', async () => {
    const calls = fetchStub([{ headers: { 'content-type': 'application/json' }, json: { token: 'abc' } }]);
    const request = createRequest({
      getApiUrl: () => 'https://api.example.com',
      getIdToken: () => 'id-token-123',
    });

    const data = await request('/omega/user/token', { method: 'POST', body: {} });

    assert.strictEqual(calls[0].url, 'https://api.example.com/omega/user/token');
    assert.strictEqual(calls[0].options.headers['Authorization'], 'Bearer id-token-123');
    assert.strictEqual(calls[0].options.headers['Content-Type'], 'application/json');
    assert.strictEqual(calls[0].options.body, '{}');
    assert.strictEqual(data.token, 'abc');
  });

  it('should pass absolute urls through untouched', async () => {
    const calls = fetchStub([{ text: 'ok' }]);
    const request = createRequest({
      getApiUrl: () => { throw new Error('must not be called'); },
      getIdToken: () => null,
    });

    await request('https://elsewhere.example.com/thing', { auth: false });
    assert.strictEqual(calls[0].url, 'https://elsewhere.example.com/thing');
  });

  it('should skip Authorization with auth: false', async () => {
    const calls = fetchStub([{ text: 'ok' }]);
    const request = createRequest({
      getApiUrl: () => 'https://api.example.com',
      getIdToken: () => { throw new Error('must not be called'); },
    });

    await request('/omega/verts/serve', { auth: false });
    assert.strictEqual(calls[0].options.headers['Authorization'], undefined);
  });

  it('should send without Authorization when signed out (getIdToken null)', async () => {
    const calls = fetchStub([{ text: 'ok' }]);
    const request = createRequest({
      getApiUrl: () => 'https://api.example.com',
      getIdToken: () => null,
    });

    await request('/omega/public');
    assert.strictEqual(calls[0].options.headers['Authorization'], undefined);
  });

  it('should throw on non-ok responses with code, message, and data attached', async () => {
    fetchStub([{
      ok: false,
      status: 401,
      headers: { 'content-type': 'application/json' },
      json: { message: 'Unauthorized caller' },
    }]);
    const request = createRequest({
      getApiUrl: () => 'https://api.example.com',
      getIdToken: () => 'tok',
    });

    const error = await request('/omega/user/token', { method: 'POST' }).catch(e => e);
    assert(error instanceof Error);
    assert.strictEqual(error.message, 'Unauthorized caller');
    assert.strictEqual(error.code, 401);
    assert.strictEqual(error.data.message, 'Unauthorized caller');
  });

  it('should parse omega-properties and call onProperties on success AND error', async () => {
    const properties = { code: 200, usage: { current: { credits: { monthly: 5 } }, limits: { credits: 100 } } };
    fetchStub([
      { headers: { 'content-type': 'application/json', 'omega-properties': JSON.stringify(properties) }, json: {} },
      { ok: false, status: 429, headers: { 'omega-properties': JSON.stringify({ code: 429 }) }, text: 'limit' },
    ]);
    const seen = [];
    const request = createRequest({
      getApiUrl: () => 'https://api.example.com',
      getIdToken: () => 'tok',
      onProperties: (p) => seen.push(p),
    });

    await request('/omega/a');
    await request('/omega/b').catch(e => e);

    assert.strictEqual(seen.length, 2);
    assert.strictEqual(seen[0].usage.current.credits.monthly, 5);
    assert.strictEqual(seen[1].code, 429);
  });

  it('should return the complete shape with output: complete', async () => {
    fetchStub([{ status: 201, headers: { 'content-type': 'application/json' }, json: { id: 'x' } }]);
    const request = createRequest({
      getApiUrl: () => 'https://api.example.com',
      getIdToken: () => 'tok',
    });

    const complete = await request('/omega/things', { method: 'POST', output: 'complete' });
    assert.strictEqual(complete.status, 201);
    assert.strictEqual(complete.ok, true);
    assert.strictEqual(complete.data.id, 'x');
  });

  it('mergeUsageIntoBindings should merge current + limits into the usage key', () => {
    const context = { usage: { credits: { monthly: 2, daily: 1, limit: 50 } } };
    const updates = [];
    const bindings = {
      getContext: () => context,
      update: (data) => updates.push(data),
    };

    mergeUsageIntoBindings(bindings, {
      usage: { current: { credits: { monthly: 6 } }, limits: { credits: 100 } },
    });

    assert.strictEqual(updates.length, 1);
    assert.deepStrictEqual(updates[0].usage.credits, { monthly: 6, daily: 1, limit: 100 });
  });

  it('mergeUsageIntoBindings should no-op without usage counters', () => {
    const updates = [];
    const bindings = { getContext: () => ({}), update: (data) => updates.push(data) };

    mergeUsageIntoBindings(bindings, null);
    mergeUsageIntoBindings(bindings, { usage: { current: {} } });

    assert.strictEqual(updates.length, 0);
  });

  it('mergeUsageIntoBindings should keep the seeded limit when the payload omits a feature limit (wave-4 F8)', () => {
    const context = { usage: { credits: { monthly: 2, limit: 50 } } };
    const updates = [];
    const bindings = {
      getContext: () => context,
      update: (data) => updates.push(data),
    };

    mergeUsageIntoBindings(bindings, {
      usage: { current: { credits: { monthly: 6 } }, limits: {} },
    });

    assert.deepStrictEqual(updates[0].usage.credits, { monthly: 6, limit: 50 });

    // An explicit server limit of 0 still wins (?? keeps 0, only null/undefined fall back)
    mergeUsageIntoBindings(bindings, {
      usage: { current: { credits: { monthly: 6 } }, limits: { credits: 0 } },
    });
    assert.strictEqual(updates[1].usage.credits.limit, 0);
  });
});
