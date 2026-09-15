/**
 * #23 — the de-branding rekey's END-TO-END wires, pinned by their exact dotted
 * paths so a future rekey breaks here loudly instead of silently emptying a
 * runtime read.
 *
 * D3: a configured slapform form id reaches the contact page's read path —
 *     config → toSiteGlobal → the OMEGA_BUILD_JSON snapshot → the exact string the
 *     page reads (`omega.config.forms?.providers?.slapform?.formId`).
 * D4: the chat widget's agent id + settings ride ONE home
 *     (`inbound.chat.providers.chatsy`) — the same dotted path the manager
 *     writes back (pinned on that side in packages/manager/test/chatsy.test.js).
 * D5: the conditional-module skip log tells the truth — "not configured" for
 *     an absent section, "disabled" for a present one that says so.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { toSiteGlobal } = require('@omega.js/config');

const { buildWith: sharedBuildWith, readBuildJson, readPageConfig, miniData, PKG } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'config-rekey-test');

// The exact strings the runtime reads. Pinned here on purpose: renaming a key
// without renaming its reader is exactly the failure #23 exists to prevent.
const CONTACT_READ_PATH = "omega.config.forms?.providers?.slapform?.formId";
const CHATSY_READ_PATH = 'this.config.inbound?.chat?.providers?.chatsy';

const FORM_ID = 'FIXTUREformId1';
const AGENT_ID = 'agent_fixture23';
// The provisioning-only sentinel: a donor id that must never ship to a page.
const TEMPLATE_ID = 'TEMPLATEdonorId23';

// ─── D3: forms.providers.slapform.formId → the contact page ─────────────────

test('D3: the contact page reads the ONE slapform path — pinned string', () => {
  const page = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'contact', 'index.js'), 'utf8');

  assert.ok(page.includes(CONTACT_READ_PATH), `contact page reads ${CONTACT_READ_PATH}`);
  assert.ok(!page.includes('slapform-form-id'), 'the dead brand.contact key is gone');
});

test('D3: a configured formId survives toSiteGlobal under its exact path', () => {
  const site = toSiteGlobal({
    brand: { id: 'acme', name: 'Acme' },
    forms: { providers: { slapform: { formId: FORM_ID } } },
  });

  assert.equal(site.forms.providers.slapform.formId, FORM_ID);
});

test('D3: the configured formId reaches the page as omega.config.forms.providers.slapform.formId', async () => {
  const pages = await buildWith({
    ...miniData,
    forms: {
      providers: {
        slapform: {
          formId: FORM_ID,
          templateFormId: TEMPLATE_ID,
          updateFormInfo: true,
          plan: { id: 'pro', name: 'Pro' },
        },
      },
    },
  });
  const html = pages.get('/blog');

  const configuration = readPageConfig(pages, html);
  assert.ok(configuration, 'the OMEGA_BUILD_JSON snapshot is written');
  assert.equal(
    configuration.forms.providers.slapform.formId,
    FORM_ID,
    'the blob carries the form id at the path the contact page reads',
  );

  // Curated: only the leaf the runtime reads goes public (#23).
  assert.deepEqual(
    Object.keys(configuration.forms.providers.slapform),
    ['formId'],
    'the provisioning-only slapform fields stay out of the public blob',
  );
  assert.ok(!html.includes(TEMPLATE_ID), 'the donor template form id never reaches the page');
});

// ─── D4: one chatsy home, manager writeback ≡ client read ───────────────────

test('D4: the client reads the chat widget from inbound.chat.providers.chatsy', () => {
  const client = fs.readFileSync(
    path.join(PKG, '..', 'client', 'src', 'index.js'),
    'utf8',
  );

  assert.ok(client.includes(CHATSY_READ_PATH), `client reads ${CHATSY_READ_PATH}`);
  assert.ok(
    client.includes('this.config.inbound.chat.providers.chatsy'),
    'the initializer reads agentId + settings from the same home',
  );
  assert.ok(
    !/chatsy:\s*\{\s*\n\s*enabled: false,\s*\n\s*config:/.test(client),
    'the separate client-side chatsy blob is gone — one home',
  );
});

test('D4: agentId + settings reach the page under the one chatsy home', async () => {
  const settings = { button: { position: 'bottom-left' } };
  const pages = await buildWith({
    ...miniData,
    inbound: {
      chat: {
        providers: {
          chatsy: {
            enabled: true,
            agentId: AGENT_ID,
            settings,
            templateAgentId: TEMPLATE_ID,
            updateAgentInfo: true,
            plan: { id: 'pro', name: 'Pro' },
            sponsorshipsUrl: 'https://example.com/SPONSORSHIPSdonor23',
          },
        },
      },
    },
  });
  const html = pages.get('/blog');

  const configuration = readPageConfig(pages, html);
  assert.ok(configuration, 'the OMEGA_BUILD_JSON snapshot is written');
  const chatsy = configuration.inbound.chat.providers.chatsy;
  assert.equal(chatsy.enabled, true);
  assert.equal(chatsy.agentId, AGENT_ID);
  assert.deepEqual(chatsy.settings, settings);

  // Curated: only what the widget reads goes public (#23).
  assert.deepEqual(
    Object.keys(chatsy).sort(),
    ['agentId', 'enabled', 'settings'],
    'the provisioning-only chatsy fields stay out of the public blob',
  );
  assert.ok(!html.includes(TEMPLATE_ID), 'the donor template agent id never reaches the page');
  assert.ok(!html.includes('SPONSORSHIPSdonor23'), 'the sponsorships url never reaches the page');
});

// ─── D5: the skip log tells the truth ───────────────────────────────────────

test('D5: an absent section logs "not configured", a disabled one logs "disabled"', () => {
  const main = fs.readFileSync(path.join(PKG, 'core', 'js', 'main.js'), 'utf8');

  const match = main.match(/const why = moduleConfig \? (.+?);\n/);
  assert.ok(match, 'the skip reason is derived from the section, not hardcoded');

  // The source itself carries both wordings (main.js is a webpack-alias ESM
  // entry — unloadable under node --test, so the strings are the contract).
  assert.ok(main.includes('is disabled'), 'source carries the disabled wording');
  assert.ok(main.includes('is not configured'), 'source carries the absent wording');
  assert.ok(
    !main.includes('config section enables it'),
    'the old one-message-for-both wording is gone',
  );
});

// ─── #894: the browser subset is the gate, on the page like everywhere else ──

test('#894: the page bakes the ONE wrapper, and no credential section reaches it', async () => {
  const pages = await buildWith({
    ...miniData,
    // The public halves the browser really reads…
    cloud: { provider: 'firebase', config: { apiKey: 'AIza-rekey', projectId: 'demo-rekey' }, billingAccount: '01ABCD-234567-89EFGH', organizationId: '123456789' },
    captcha: { providers: { recaptcha: { siteKey: 'site-key-rekey' } } },
    // …and the sections that provision the brand, which never do
    repo: { provider: 'github', org: 'Rekey-Org' },
    certificates: { providers: { apple: { teamId: 'TEAMREKEY' } } },
    account: { enabled: true, admins: [{ email: 'root@rekey.example.com' }] },
    edge: { providers: { cloudflare: { zone: 'rekey.example.com' } } },
  });
  const html = pages.get('/blog');
  const buildJson = readBuildJson(pages);

  // One wrapper, desktop's names, on every OMEGA browser surface
  assert.deepEqual(Object.keys(buildJson).sort(), ['builtAt', 'config', 'license', 'mode', 'package']);

  const config = buildJson.config;
  assert.equal(config.runtime, 'web');
  assert.equal(config.cloud.config.apiKey, 'AIza-rekey', 'the Firebase WEB config is public by design');
  assert.equal(config.captcha.providers.recaptcha.siteKey, 'site-key-rekey');

  // Absent from the bake, and absent from the PAGE: a value that never enters
  // the blob cannot leak through some other line of the chrome either.
  for (const section of ['repo', 'certificates', 'account', 'edge']) {
    assert.equal(config[section], undefined, `${section} must never reach a browser`);
  }
  assert.equal(config.cloud.billingAccount, undefined, 'nor the GCP account facts beside the web config');
  assert.ok(!html.includes('01ABCD-234567-89EFGH'), 'the billing account is nowhere on the page');
  assert.ok(!html.includes('TEAMREKEY'), 'nor the signing team id');
  assert.ok(!html.includes('root@rekey.example.com'), 'nor the account admins');
});
