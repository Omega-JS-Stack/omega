/**
 * Pipeline command tests — the assertion engine (evaluatePipeline) and the
 * run-record discovery, both pure/local. The live spawn path is exercised
 * on demand against the playground (`omega-manager pipeline`), never here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { evaluatePipeline, findRunRecord, CORE_SERVICES } = require('../src/commands/pipeline.js');

/** Full-run record where every core service is green. */
function greenRecord(extra = []) {
  return {
    timestamp: 'fixture',
    brandId: 'fixture-brand',
    services: [
      ...CORE_SERVICES.map((service) => ({ service, status: 'success', output: null, error: null })),
      ...extra,
    ],
  };
}

test('pipeline: all-green full run passes', () => {
  const verdict = evaluatePipeline(greenRecord());
  assert.equal(verdict.pass, true);
  assert.deepEqual(verdict.failures, []);
});

test('pipeline: any service error fails, naming the service and error', () => {
  const record = greenRecord([{ service: 'sendgrid', status: 'error', output: null, error: 'SendGrid API error (429): Too Many Requests' }]);
  const verdict = evaluatePipeline(record);
  assert.equal(verdict.pass, false);
  assert.match(verdict.failures[0], /sendgrid: error — SendGrid API error \(429\)/);
});

test('pipeline: core service skipped = seed missing = fail; non-core skip is listed, not failed', () => {
  const record = greenRecord([{ service: 'adsense', status: 'skipped', output: null, error: null, reason: 'no adsense.accountId configured' }]);
  record.services.find((s) => s.service === 'cloudflare').status = 'skipped';
  record.services.find((s) => s.service === 'cloudflare').reason = 'missing CLOUDFLARE_TOKEN — add to the brand .env';

  const verdict = evaluatePipeline(record);
  assert.equal(verdict.pass, false);
  assert.match(verdict.failures[0], /cloudflare: CORE service skipped — missing CLOUDFLARE_TOKEN/);
  assert.equal(verdict.skips.length, 1);
  assert.match(verdict.skips[0], /adsense — no adsense\.accountId/);
});

test('pipeline: full run missing a core service fails; --service scoping waives presence', () => {
  const record = { services: [{ service: 'github', status: 'success', output: null, error: null }] };

  const full = evaluatePipeline(record);
  assert.equal(full.pass, false);
  assert.ok(full.failures.some((f) => /firebase: CORE service missing/.test(f)));

  const scoped = evaluatePipeline(record, { scoped: true });
  assert.equal(scoped.pass, true);
});

test('pipeline: --require promotes a service into the core set', () => {
  const record = greenRecord([{ service: 'sendgrid', status: 'skipped', output: null, error: null, reason: 'missing SENDGRID_API_KEY' }]);

  assert.equal(evaluatePipeline(record).pass, true, 'skip tolerated by default');
  const strict = evaluatePipeline(record, { require: ['sendgrid'] });
  assert.equal(strict.pass, false);
  assert.match(strict.failures[0], /sendgrid: CORE service skipped/);
});

test('pipeline: deploy legs ride the same rules — an error leg fails, a green leg passes as non-core', () => {
  const ok = greenRecord([{ service: 'deploy:web', status: 'success', output: null, error: null }]);
  assert.equal(evaluatePipeline(ok).pass, true);

  const bad = greenRecord([{ service: 'deploy:backend', status: 'error', output: null, error: 'exit 1' }]);
  const verdict = evaluatePipeline(bad);
  assert.equal(verdict.pass, false);
  assert.match(verdict.failures[0], /deploy:backend: error — exit 1/);
});

test('pipeline: headless Google consent fails FAST with the seeding instruction (no server, no 5-min wait)', async () => {
  const { GoogleOAuth2Client } = require('../src/lib/google-auth.js');
  const client = new GoogleOAuth2Client({
    clientId: 'x',
    clientSecret: 'y',
    scopes: ['https://www.googleapis.com/auth/webmasters'],
    tokenStorePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-auth-')), 'tokens.json'),
  });

  process.env.OMEGA_NON_INTERACTIVE = '1';
  try {
    const started = Date.now();
    await assert.rejects(client.getAccessToken(), /Google consent required \(scopes: .*webmasters\) — run the service once interactively/);
    assert.ok(Date.now() - started < 2000, 'must fail fast, not camp on the callback server');
  } finally {
    delete process.env.OMEGA_NON_INTERACTIVE;
  }
});

test('pipeline: findRunRecord returns the newest record at/after `since`, null otherwise', () => {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-pipeline-'));
  const runsDir = path.join(brandRoot, '.omega', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });

  assert.equal(findRunRecord(brandRoot, 0), null, 'empty dir → null');

  fs.writeFileSync(path.join(runsDir, 'old.json'), JSON.stringify({ services: [{ service: 'old' }] }));
  const oldTime = Date.now() - 60_000;
  fs.utimesSync(path.join(runsDir, 'old.json'), oldTime / 1000, oldTime / 1000);

  fs.writeFileSync(path.join(runsDir, 'new.json'), JSON.stringify({ services: [{ service: 'new' }] }));

  const found = findRunRecord(brandRoot, Date.now() - 5_000);
  assert.ok(found);
  assert.equal(found.record.services[0].service, 'new');
  assert.equal(findRunRecord(brandRoot, Date.now() + 60_000), null, 'nothing after future cutoff');
});
