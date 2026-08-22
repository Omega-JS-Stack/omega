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

const { evaluatePipeline, findRunRecord, resolveVerifyTargets, buildChildArgs, CORE_SERVICES } = require('../src/commands/pipeline.js');
const { runVerifyLegs } = require('../src/lib/verify-live.js');

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
  const record = greenRecord([{ service: 'campaigns', status: 'error', output: null, error: 'SendGrid API error (429): Too Many Requests' }]);
  const verdict = evaluatePipeline(record);
  assert.equal(verdict.pass, false);
  assert.match(verdict.failures[0], /campaigns: error — SendGrid API error \(429\)/);
});

test('pipeline: core service skipped = seed missing = fail; non-core skip is listed, not failed', () => {
  const record = greenRecord([{ service: 'advertising', status: 'skipped', output: null, error: null, reason: 'no advertising.providers.adsense.client configured' }]);
  record.services.find((s) => s.service === 'edge').status = 'skipped';
  record.services.find((s) => s.service === 'edge').reason = 'missing CLOUDFLARE_TOKEN — add to the brand .env';

  const verdict = evaluatePipeline(record);
  assert.equal(verdict.pass, false);
  assert.match(verdict.failures[0], /edge: CORE service skipped — missing CLOUDFLARE_TOKEN/);
  assert.equal(verdict.skips.length, 1);
  assert.match(verdict.skips[0], /advertising — no advertising\.providers\.adsense\.client/);
});

test('pipeline: full run missing a core service fails; --service scoping waives presence', () => {
  const record = { services: [{ service: 'repo', status: 'success', output: null, error: null }] };

  const full = evaluatePipeline(record);
  assert.equal(full.pass, false);
  assert.ok(full.failures.some((f) => /cloud: CORE service missing/.test(f)));

  const scoped = evaluatePipeline(record, { scoped: true });
  assert.equal(scoped.pass, true);
});

test('pipeline: --require promotes a service into the core set', () => {
  const record = greenRecord([{ service: 'seo', status: 'skipped', output: null, error: null, reason: 'awaiting the public-repo go' }]);

  assert.equal(evaluatePipeline(record).pass, true, 'skip tolerated by default');
  const strict = evaluatePipeline(record, { require: ['seo'] });
  assert.equal(strict.pass, false);
  assert.match(strict.failures[0], /seo: CORE service skipped/);
});

test('pipeline: the graduated seeds are core now — a campaigns/search skip fails a full run', () => {
  for (const service of ['campaigns', 'search', 'account', 'captcha']) {
    assert.ok(CORE_SERVICES.includes(service), `${service} graduated into the core spine`);
  }

  const record = greenRecord();
  record.services.find((s) => s.service === 'campaigns').status = 'skipped';
  record.services.find((s) => s.service === 'campaigns').reason = 'missing SENDGRID_API_KEY';

  const verdict = evaluatePipeline(record);
  assert.equal(verdict.pass, false);
  assert.match(verdict.failures[0], /campaigns: CORE service skipped/);
});

test('pipeline: a gated publish leg records a tolerated (non-core) skip', () => {
  const record = greenRecord([{
    service: 'deploy:desktop',
    status: 'skipped',
    output: null,
    error: null,
    reason: 'publish leg gated — pass --publish (releases/dispatches are gated)',
  }]);

  const verdict = evaluatePipeline(record);
  assert.equal(verdict.pass, true, 'gated publish skip never fails the run');
  assert.match(verdict.skips[0], /deploy:desktop — publish leg gated/);
});

test('pipeline: deploy legs ride the same rules — an error leg fails, a green leg passes as non-core', () => {
  const ok = greenRecord([{ service: 'deploy:web', status: 'success', output: null, error: null }]);
  assert.equal(evaluatePipeline(ok).pass, true);

  const bad = greenRecord([{ service: 'deploy:backend', status: 'error', output: null, error: 'exit 1' }]);
  const verdict = evaluatePipeline(bad);
  assert.equal(verdict.pass, false);
  assert.match(verdict.failures[0], /deploy:backend: error — exit 1/);
});

test('pipeline: verify targets follow the deploy legs; --verify alone sweeps every verifiable target', () => {
  assert.deepEqual(resolveVerifyTargets({ deploy: 'web,backend' }, ['web', 'backend']), ['web', 'backend'], 'deploying verifies what was deployed');
  assert.deepEqual(resolveVerifyTargets({ verify: true }, []), ['web'], '--verify alone is the post-hoc sweep');
  assert.deepEqual(resolveVerifyTargets({}, []), [], 'no deploy, no --verify → no sweep');
});

test('pipeline: the manage child names the verb — a bare CLI walks nothing now (#229)', () => {
  assert.deepEqual(buildChildArgs({}), ['manage', '--continue-on-error'],
    'the child IS the walk — without the verb it would print help and the pipeline would find no run record');
  assert.deepEqual(
    buildChildArgs({ service: 'payment', dryRun: true }),
    ['manage', '--continue-on-error', '--service=payment', '--dry-run'],
    'the verb leads; the run flags follow unchanged',
  );
});

test('pipeline: every value-less pipeline flag is declared boolean (yargs would eat the next positional)', () => {
  const { BOOLEAN_FLAGS } = require('../src/cli-run.js');
  for (const flag of ['dry-run', 'verify', 'publish']) {
    assert.ok(BOOLEAN_FLAGS.includes(flag), `--${flag} takes no value — it must be declared boolean`);
  }
});

test('pipeline: verify rows land AFTER the deploy legs and ride the same judging rules', async () => {
  const record = greenRecord();
  const brandConfig = { brand: { url: 'https://playground.omegajs.dev' }, cloud: { config: { projectId: 'omegajs-playground' } } };
  const fetchImpl = async () => ({ status: 500, headers: { get: () => 'text/html' }, text: async () => '' });
  const resolve = async () => ['203.0.113.7'];

  record.services.push({ service: 'deploy:web', status: 'success', output: null, error: null });
  record.services.push(...await runVerifyLegs(['web'], brandConfig, { fetch: fetchImpl, resolve }));

  const services = record.services.map((entry) => entry.service);
  assert.ok(services.indexOf('deploy:web') < services.indexOf('verify:site'), 'the sweep runs after the deploy leg');

  const verdict = evaluatePipeline(record);
  assert.equal(verdict.pass, false, 'a failed check fails the pipeline like a failed deploy leg');
  assert.ok(verdict.failures.some((failure) => /verify:site: error — .*500/.test(failure)));
});

test('pipeline: a demo-only brand records verify:* as tolerated gated skips', async () => {
  const record = greenRecord();
  const demoConfig = { brand: { url: 'https://sandbox-brand.example.com' }, cloud: { config: { projectId: 'demo-sandbox-brand' } } };

  record.services.push(...await runVerifyLegs(['web'], demoConfig, {}));

  const verdict = evaluatePipeline(record);
  assert.equal(verdict.pass, true, 'gated verify skips never fail the run');
  assert.equal(verdict.skips.filter((skip) => skip.startsWith('verify:')).length, 3);
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
