/**
 * The cloud service's shared-project ask: when the brand's own config file
 * does not author `cloud.shared` and the merged value is false, a terminal
 * run asks once (a two-choice select, default No) and lands the answer.
 * Runs against the fully converged project, so the ask is the run's only prompt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { stripVTControlCharacters } = require('node:util');
const JSON5 = require('json5');

const { openTtyPrompt } = require('./lib/interactive.js');
const { readConfigSource } = require('./lib/config-fixture.js');
const {
  DOMAIN, PROJECT, EXPECTED_SDK, stagedRoot, brandConfig, fakeFirebase, fakeCf, runService, convergedResponses,
} = require('./lib/cloud-fixture.js');

// Tests must never see real credentials from the shell environment
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.GOOGLE_CLIENT_SECRET;
delete process.env.CLOUDFLARE_TOKEN;
process.env.VAPID_PRIVATE_KEY = 'p'.repeat(43);

const UNAUTHORED = `{
  // Fixture Brand: the shared-project answer lands here
  brand: { id: 'fixture-brand' },
}
`;

const AUTHORED_FALSE = `{
  brand: { id: 'fixture-brand' },
  cloud: { shared: false },
}
`;

/** Run fn with console.log captured; returns the joined lines, colors stripped. */
async function captureLogAsync(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return stripVTControlCharacters(lines.join('\n'));
}

/** A converged run whose merged config carries the schema's `shared: false`. */
function convergedRun(brandRoot) {
  const config = brandConfig({ cloud: { shared: false }, sdkConfig: { ...EXPECTED_SDK } });
  config.cloud.oauthRedirectsConfigured = true;
  config.cloud.messaging = { vapidKey: 'B'.repeat(87) };

  return runService(config, {
    firebase: fakeFirebase(convergedResponses()),
    cloudflare: fakeCf({
      records: [{ id: 'c1', type: 'CNAME', name: `api.${DOMAIN}`, content: `${PROJECT}.web.app`, proxied: true }],
    }),
    brandRoot,
  });
}

test('cloud: shared unauthored, in a terminal, the owner answers no: cloud.shared: false lands and a second run does not ask', async () => {
  const brandRoot = stagedRoot(UNAUTHORED);
  const tty = openTtyPrompt(); // interactive: a second ask would hang the second run

  try {
    const run = convergedRun(brandRoot);
    await tty.answer('❯', '\r'); // the two-choice select, default No
    const result = await run;

    assert.equal(JSON5.parse(readConfigSource(brandRoot)).cloud.shared, false);
    assert.equal(result.status, 'success', 'a no runs every operation, as a brand-owned project does');

    // The next run reads the file that now authors the key
    const again = await convergedRun(brandRoot);
    assert.equal(again.status, 'success');
  } finally {
    tty.close();
  }
});

test('cloud: a brand config that authors cloud.shared: false is never asked', async () => {
  const brandRoot = stagedRoot(AUTHORED_FALSE);
  const tty = openTtyPrompt(); // interactive: an ask here would hang

  try {
    const result = await convergedRun(brandRoot);

    assert.equal(result.status, 'success');
    assert.equal(readConfigSource(brandRoot), AUTHORED_FALSE);
  } finally {
    tty.close();
  }
});

test('cloud: shared unauthored, headless: no prompt, and the headless line names cloud.shared', async () => {
  const brandRoot = stagedRoot(UNAUTHORED);
  let result;

  const printed = await captureLogAsync(async () => {
    result = await convergedRun(brandRoot);
  });

  assert.equal(result.status, 'success', 'the service goes on as it does today');
  assert.equal(readConfigSource(brandRoot), UNAUTHORED);
  assert.ok(
    printed.includes('→ Set cloud.shared in config/omega.json5, or run manage in a terminal to answer'),
    `headless line missing from: ${printed}`,
  );
});
