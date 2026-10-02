/**
 * The edge service's email asks: the mailbox provider when none is picked,
 * then the forwarding addresses when the list is empty and the picked
 * provider routes mail. Driven through real prompts on a fake terminal;
 * every answer lands in a real config/omega.json5.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const JSON5 = require('json5');

// The machine registry is per-machine state: fixtures write into a temp home
require('@omega.js/devkit/test/temp-home');

const { setPromptStreams } = require('@omega.js/devkit/prompt');
const { makeStreams } = require('@omega.js/devkit/test/prompt-streams');
const ensureEmailRouting = require('../src/services/edge/ensure/email-routing.js');
const ensureDns = require('../src/services/edge/ensure/dns-records.js');
const { makeBrandRoot, readConfigSource } = require('./lib/config-fixture.js');
const { DOMAIN, brandConfig, fakeApi, handlerContext } = require('./lib/edge-fixture.js');
const { openTtyPrompt } = require('./lib/interactive.js');

// Tests must never see a real token from the shell environment
delete process.env.CLOUDFLARE_TOKEN;
delete process.env.SENDGRID_API_KEY;

const DOWN = '\x1B[B'; // arrow-down escape for select() answers

const EMAIL_ASK_CONFIG = `{
  // Fixture Brand: the email answers land here
  brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://${DOMAIN}' },
}
`;

// A live prompt's idle render opens on a bare `? `; its answered render on `✔`
const LIVE_PROMPT = /(?:^|\n|\x1b\[G|\x1b\[\?25h)\? /;

/**
 * A fake terminal that answers its prompts in order, whatever their wording:
 * each answer waits for the next live prompt, types, then waits for its ✔.
 */
function promptSequence() {
  const streams = makeStreams({ tty: true });
  setPromptStreams(streams);
  let cursor = 0;

  async function until(check, what) {
    const start = Date.now();
    while (!check(streams.getRendered())) {
      if (Date.now() - start > 2000) {
        throw new Error(`Timed out waiting for ${what}. Rendered: ${JSON.stringify(streams.getRendered())}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  return {
    async answerNext(keys) {
      await until((rendered) => LIVE_PROMPT.test(rendered.slice(cursor)), 'the next prompt');
      const typedAt = streams.getRendered().length;
      streams.input.write(keys);
      await until((rendered) => rendered.includes('✔', typedAt), 'the answer to land');
      cursor = streams.getRendered().indexOf('✔', typedAt) + 1;
    },
    close() {
      setPromptStreams(null);
    },
  };
}

/** The reads (and the one rule write) a fresh Email Routing setup makes. */
function routingApi() {
  return fakeApi({
    responses: {
      'GET /zones/zone-1/email/routing': { enabled: true },
      'GET /zones/zone-1/email/routing/rules': [],
      'POST /zones/zone-1/email/routing/rules': {},
      'GET /zones/zone-1/email/routing/rules/catch_all': { enabled: false },
    },
  });
}

/** A handler context whose writeback lands in `brandRoot`. */
function askContext(config, api, brandRoot) {
  return handlerContext(config, api, { brandId: 'fixture-brand', brandRoot });
}

test('email-routing: Disable at the provider ask lands domain.email.providers: false; a second run neither prompts nor fails', async () => {
  const brandRoot = makeBrandRoot(EMAIL_ASK_CONFIG);
  const config = brandConfig();
  config.domain.email.providers = {}; // nothing picked
  config.domain.email.forwarding = [];
  const tty = openTtyPrompt(); // interactive: a second-run prompt here would hang

  try {
    const run = ensureEmailRouting(askContext(config, fakeApi(), brandRoot));
    await tty.answer('Set up now?', `${DOWN}${DOWN}\r`); // Disable (stop prompting)
    await run;

    assert.equal(JSON5.parse(readConfigSource(brandRoot)).domain.email.providers, false);

    // The next run loads the landed false
    const again = brandConfig();
    again.domain.email.providers = false;
    again.domain.email.forwarding = [];
    const api = fakeApi();
    const result = await ensureEmailRouting(askContext(again, api, brandRoot));

    assert.notEqual(result?.status, 'failed');
    assert.equal(api.calls.length, 0, 'false is "none": no routing to reconcile');
  } finally {
    tty.close();
  }
});

test('email-routing: a routing provider with an empty forwarding list asks, and the two entries land one rule', async () => {
  const brandRoot = makeBrandRoot(EMAIL_ASK_CONFIG);
  const config = brandConfig();
  config.domain.email.providers = { cloudflare: {} };
  config.domain.email.forwarding = [];
  const api = routingApi();
  const terminal = promptSequence();

  try {
    const run = ensureEmailRouting(askContext(config, api, brandRoot));
    await terminal.answerNext('\r'); // Set up now? Yes
    await terminal.answerNext('support\r'); // the address to forward
    await terminal.answerNext('inbox@example.com\r'); // the inbox it goes to
    await run;

    assert.deepEqual(
      JSON5.parse(readConfigSource(brandRoot)).domain.email.forwarding,
      [{ from: 'support', to: 'inbox@example.com' }],
    );
    assert.ok(api.call('POST', '/zones/zone-1/email/routing/rules'), 'the pass went on to write the rule it just landed');
  } finally {
    terminal.close();
  }
});

test('email-routing: Disable at the forwarding ask lands domain.email.forwarding: false; a second run writes no rule and never asks', async () => {
  const brandRoot = makeBrandRoot(EMAIL_ASK_CONFIG);
  const config = brandConfig();
  config.domain.email.providers = { cloudflare: {} };
  config.domain.email.forwarding = [];
  const tty = openTtyPrompt(); // interactive: a second-run prompt here would hang

  try {
    const run = ensureEmailRouting(askContext(config, routingApi(), brandRoot));
    await tty.answer('Set up now?', `${DOWN}${DOWN}\r`); // Disable (stop prompting)
    await run;

    assert.equal(JSON5.parse(readConfigSource(brandRoot)).domain.email.forwarding, false);

    const again = brandConfig();
    again.domain.email.providers = { cloudflare: {} };
    again.domain.email.forwarding = false;
    const api = routingApi();
    const result = await ensureEmailRouting(askContext(again, api, brandRoot));

    assert.notEqual(result?.status, 'failed');
    assert.equal(api.call('POST', '/zones/zone-1/email/routing/rules'), undefined, 'false is "no forwarding rules"');
  } finally {
    tty.close();
  }
});

test('dns-records: domain.email.providers: false is "none", so no MX record is required', async () => {
  const config = brandConfig();
  config.domain.email.providers = false;

  const api = fakeApi({
    responses: {
      'GET /zones/zone-1/dns_records': [],
      'POST /zones/zone-1/dns_records': { id: 'new' },
    },
  });

  const result = await ensureDns(handlerContext(config, api));

  assert.equal(result.status, 'success');
  assert.deepEqual(api.calls.filter((c) => c.method === 'POST' && c.body.type === 'MX'), []);
});
