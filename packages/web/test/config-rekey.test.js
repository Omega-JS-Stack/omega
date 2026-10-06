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
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

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

module.exports = defineCases({
  type: 'group',
  description: 'config-rekey',
  tests: [
    // ─── D3: forms.providers.slapform.formId → the contact page ─────────────────

    {
      name: 'D3: the contact page reads the ONE slapform path — pinned string',
      run: (ctx) => {
        const page = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'contact', 'index.js'), 'utf8');

        ctx.expect(page.includes(CONTACT_READ_PATH), `contact page reads ${CONTACT_READ_PATH}`).toBeTruthy();
        ctx.expect(!page.includes('slapform-form-id'), 'the dead brand.contact key is gone').toBeTruthy();
      },
    },

    {
      name: 'D3: a configured formId survives toSiteGlobal under its exact path',
      run: (ctx) => {
        const site = toSiteGlobal({
          brand: { id: 'acme', name: 'Acme' },
          forms: { providers: { slapform: { formId: FORM_ID } } },
        });

        ctx.expect(site.forms.providers.slapform.formId).toBe(FORM_ID);
      },
    },

    {
      name: 'D3: the configured formId reaches the page as omega.config.forms.providers.slapform.formId',
      run: async (ctx) => {
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
        ctx.expect(configuration, 'the OMEGA_BUILD_JSON snapshot is written').toBeTruthy();
        ctx.expect(configuration.forms.providers.slapform.formId, 'the blob carries the form id at the path the contact page reads').toBe(FORM_ID);

        // Curated: only the leaf the runtime reads goes public (#23).
        ctx.expect(Object.keys(configuration.forms.providers.slapform), 'the provisioning-only slapform fields stay out of the public blob').toEqual(['formId']);
        ctx.expect(!html.includes(TEMPLATE_ID), 'the donor template form id never reaches the page').toBeTruthy();
      },
    },

    // ─── D4: one chatsy home, manager writeback ≡ client read ───────────────────

    {
      name: 'D4: the client reads the chat widget from inbound.chat.providers.chatsy',
      run: (ctx) => {
        const client = fs.readFileSync(
          path.join(PKG, '..', 'client', 'src', 'index.js'),
          'utf8',
        );

        ctx.expect(client.includes(CHATSY_READ_PATH), `client reads ${CHATSY_READ_PATH}`).toBeTruthy();
        ctx.expect(client.includes('this.config.inbound.chat.providers.chatsy'), 'the initializer reads agentId + settings from the same home').toBeTruthy();
        ctx.expect(!/chatsy:\s*\{\s*\n\s*enabled: false,\s*\n\s*config:/.test(client), 'the separate client-side chatsy blob is gone — one home').toBeTruthy();
      },
    },

    {
      name: 'D4: agentId + settings reach the page under the one chatsy home',
      run: async (ctx) => {
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
        ctx.expect(configuration, 'the OMEGA_BUILD_JSON snapshot is written').toBeTruthy();
        const chatsy = configuration.inbound.chat.providers.chatsy;
        ctx.expect(chatsy.enabled).toBe(true);
        ctx.expect(chatsy.agentId).toBe(AGENT_ID);
        ctx.expect(chatsy.settings).toEqual(settings);

        // Curated: only what the widget reads goes public (#23).
        ctx.expect(Object.keys(chatsy).sort(), 'the provisioning-only chatsy fields stay out of the public blob').toEqual(['agentId', 'enabled', 'settings']);
        ctx.expect(!html.includes(TEMPLATE_ID), 'the donor template agent id never reaches the page').toBeTruthy();
        ctx.expect(!html.includes('SPONSORSHIPSdonor23'), 'the sponsorships url never reaches the page').toBeTruthy();
      },
    },

    // ─── D5: the skip log tells the truth ───────────────────────────────────────

    {
      name: 'D5: an absent section logs "not configured", a disabled one logs "disabled"',
      run: (ctx) => {
        const main = fs.readFileSync(path.join(PKG, 'core', 'js', 'main.js'), 'utf8');

        const match = main.match(/const why = moduleConfig \? (.+?);\n/);
        ctx.expect(match, 'the skip reason is derived from the section, not hardcoded').toBeTruthy();

        // The source itself carries both wordings (main.js is a webpack-alias ESM
        // entry — unloadable under node --test, so the strings are the contract).
        ctx.expect(main.includes('is disabled'), 'source carries the disabled wording').toBeTruthy();
        ctx.expect(main.includes('is not configured'), 'source carries the absent wording').toBeTruthy();
        ctx.expect(!main.includes('config section enables it'), 'the old one-message-for-both wording is gone').toBeTruthy();
      },
    },

    // ─── #894: the browser subset is the gate, on the page like everywhere else ──

    {
      name: '#894: the page bakes the ONE wrapper, and no credential section reaches it',
      run: async (ctx) => {
        const pages = await buildWith({
          ...miniData,
          // The public halves the browser really reads…
          cloud: { provider: 'firebase', config: { apiKey: 'AIza-rekey', projectId: 'demo-rekey' }, billingAccount: '01ABCD-234567-89EFGH', organizationId: '123456789' },
          captcha: { providers: { recaptcha: { siteKey: 'site-key-rekey' } } },
          // …and the sections that provision the brand, which never do
          repo: { provider: 'github', owner: 'Rekey-Org' },
          certificates: { providers: { apple: { teamId: 'TEAMREKEY' } } },
          account: { enabled: true, admins: [{ email: 'root@rekey.example.com' }] },
          edge: { providers: { cloudflare: { zone: 'rekey.example.com' } } },
        });
        const html = pages.get('/blog');
        const buildJson = readBuildJson(pages);

        // One wrapper, desktop's names, on every OMEGA browser surface
        ctx.expect(Object.keys(buildJson).sort()).toEqual(['builtAt', 'config', 'license', 'mode', 'package']);

        const config = buildJson.config;
        ctx.expect(config.runtime).toBe('web');
        ctx.expect(config.cloud.config.apiKey, 'the Firebase WEB config is public by design').toBe('AIza-rekey');
        ctx.expect(config.captcha.providers.recaptcha.siteKey).toBe('site-key-rekey');

        // Absent from the bake, and absent from the PAGE: a value that never enters
        // the blob cannot leak through some other line of the chrome either.
        for (const section of ['repo', 'certificates', 'account', 'edge']) {
          ctx.expect(config[section], `${section} must never reach a browser`).toBe(undefined);
        }
        ctx.expect(config.cloud.billingAccount, 'nor the GCP account facts beside the web config').toBe(undefined);
        ctx.expect(!html.includes('01ABCD-234567-89EFGH'), 'the billing account is nowhere on the page').toBeTruthy();
        ctx.expect(!html.includes('TEAMREKEY'), 'nor the signing team id').toBeTruthy();
        ctx.expect(!html.includes('root@rekey.example.com'), 'nor the account admins').toBeTruthy();
      },
    },
  ],
});
