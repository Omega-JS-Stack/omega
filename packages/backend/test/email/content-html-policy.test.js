/**
 * Internal-only send-field policy test — four fields hand the renderer raw HTML (or
 * the trust to render it), and none of them may arrive over the API.
 *
 * - `data.content.html` skips markdown entirely (the transactional/campaign body).
 * - `html` is the top-level override that replaces the rendered MJML document outright
 *   — a documented MCP `send_email` parameter until Ian's #125 ruling closed it.
 * - `contentHtml` is the pre-rendered campaign HTML the newsletter generator hands to
 *   `sendCampaign()` — read AHEAD of the escaped renderer, and it persists into the
 *   stored campaign doc that cron sends later.
 * - `trustedContent: true` flips the body renderer to `html: true`.
 *
 * First-party callers depend on all three, but a caller arriving over the API —
 * including an admin-authenticated AI on the MCP `send_email` / `create_campaign` /
 * `update_campaign` tools — must be turned away with a coded-400 permanent fault, or
 * the escaped lane is one field away from being bypassed (#90).
 *
 * The external lanes assert the boundary through `prepare.internalOnlyFieldFault()`; the
 * internal lane never calls it, so its passthrough must still work end to end.
 *
 * Plain-node unit test (no emulator, no network). The route round-trips that prove the
 * boundary is WIRED live in test/routes/admin/email-content-html.test.js and
 * test/routes/marketing/campaign.test.js.
 */
const assert = require('node:assert');
const prepare = require('../../src/manager/libraries/email/prepare.js');
const { buildCampaignDoc } = require('../../src/manager/routes/marketing/campaign/utils.js');

// The internal lane's build runs for real so the passthrough is proven all the way to
// the SendGrid payload, not just at renderContent().
function transactionalBuild(settings) {
  process.env.UNSUBSCRIBE_HMAC_KEY = process.env.UNSUBSCRIBE_HMAC_KEY || 'test-key';

  const Transactional = require('../../src/manager/libraries/email/transactional/index.js');
  const Manager = {
    config: {
      brand: { id: 'testbrand', name: 'Test Brand', url: 'https://test.dev', contact: { email: 'hello@test.dev' }, images: {} },
      // The account's unsubscribe group ids (#649) — every send resolves one from config
      marketing: { campaigns: { providers: { sendgrid: { groups: { orders: 900001, hello: 900002, account: 900003, marketing: 900004, security: 900005, newsletter: 900006, internal: 900007 } } } } },
    },
    project: { websiteUrl: 'https://test.dev' },
    libraries: { admin: {} },
    User: () => ({ properties: {} }),
  };
  const ctx = { Manager, log: () => {}, error: () => {} };

  return new Transactional(ctx).build({
    to: 'user@test.dev',
    template: 'card',
    ...settings,
  }).then((email) => email.content[0].value);
}

module.exports = {
  description: 'Email internal-only send fields (content.html, html, contentHtml, trustedContent)',
  type: 'group',
  tests: [
    // ---------- The external lanes reject it ----------

    {
      name: 'external lane rejects data.content.html with a coded 400',

      run() {
        const fault = prepare.internalOnlyFieldFault({
          to: 'user@test.dev',
          subject: 'Probe',
          data: { content: { html: '<img src=x onerror="alert(1)">' } },
        });

        assert.ok(fault instanceof Error, 'no fault returned for data.content.html');
        assert.equal(fault.code, 400, `fault must be a permanent 400, got ${fault.code}`);
        assert.ok(fault.message.includes('data.content.html'), `message must name the field: ${fault.message}`);
        assert.ok(/internal-caller only/.test(fault.message), `message must state the rule: ${fault.message}`);
      },
    },

    {
      name: 'external lane rejects the field even when it is empty',

      run() {
        // An external caller has no legitimate reason to send the key at all — the
        // presence of it is the fault, not its contents.
        assert.ok(prepare.internalOnlyFieldFault({ data: { content: { html: '' } } }) instanceof Error, 'empty html passed');
        assert.ok(prepare.internalOnlyFieldFault({ data: { content: { html: null } } }) instanceof Error, 'null html passed');
      },
    },

    {
      name: 'external lane passes ordinary markdown settings through clean',

      run() {
        assert.equal(prepare.internalOnlyFieldFault({ data: { content: { message: '**hi**' } } }), null);
        assert.equal(prepare.internalOnlyFieldFault({ data: {} }), null);
        assert.equal(prepare.internalOnlyFieldFault({}), null);
        assert.equal(prepare.internalOnlyFieldFault(undefined), null);
      },
    },

    {
      name: 'external lane rejects the top-level html override with a coded 400',

      run() {
        // `settings.html` replaces the rendered MJML body outright (transactional
        // build()) — the same bypass as data.content.html, one level up. Ian's #125
        // ruling put it on the internal-only list: the admin/MCP lane now matches the
        // API lane exactly, and the MCP send_email tool no longer advertises it.
        const fault = prepare.internalOnlyFieldFault({
          to: 'user@test.dev',
          subject: 'Probe',
          html: '<img src=x onerror="alert(1)">',
        });

        assert.ok(fault instanceof Error, 'no fault returned for top-level html');
        assert.equal(fault.code, 400, `fault must be a permanent 400, got ${fault.code}`);
        assert.ok(fault.message.includes('html'), `message must name the field: ${fault.message}`);
        assert.ok(/internal-caller only/.test(fault.message), `message must state the rule: ${fault.message}`);

        // Presence is the fault, same as every other field on the list.
        assert.ok(prepare.internalOnlyFieldFault({ html: '' }) instanceof Error, 'empty html passed');
      },
    },

    {
      name: 'the MCP send_email tool no longer advertises an html parameter',

      run() {
        // The tool schema is what an admin-authenticated AI reads. #125 removed the
        // 'Raw HTML body (alternative to template)' parameter; if it ever comes back,
        // the lane is advertising the bypass again.
        const sendEmail = require('../../src/mcp/tools.js').find((tool) => tool.name === 'send_email');

        assert.ok(sendEmail, 'send_email tool not found — update this test');
        assert.equal(sendEmail.inputSchema.properties.html, undefined, 'send_email re-advertises the html parameter');
      },
    },

    {
      name: 'external lane rejects top-level contentHtml with a coded 400',

      run() {
        // The campaign lane reads settings.contentHtml AHEAD of the escaped renderer
        // (marketing/index.js) — a caller-supplied one is the same bypass.
        const fault = prepare.internalOnlyFieldFault({
          name: 'Probe campaign',
          subject: 'Probe',
          contentHtml: '<img src=x onerror="alert(1)">',
        });

        assert.ok(fault instanceof Error, 'no fault returned for contentHtml');
        assert.equal(fault.code, 400, `fault must be a permanent 400, got ${fault.code}`);
        assert.ok(fault.message.includes('contentHtml'), `message must name the field: ${fault.message}`);
      },
    },

    {
      name: 'external lane rejects caller-supplied trustedContent with a coded 400',

      run() {
        // trustedContent: true flips the body renderer to html: true — raw markup and
        // javascript: hrefs would both survive.
        const fault = prepare.internalOnlyFieldFault({
          subject: 'Probe',
          trustedContent: true,
          data: { content: { message: '<a href="javascript:alert(1)">x</a>' } },
        });

        assert.ok(fault instanceof Error, 'no fault returned for trustedContent');
        assert.equal(fault.code, 400, `fault must be a permanent 400, got ${fault.code}`);
        assert.ok(fault.message.includes('trustedContent'), `message must name the field: ${fault.message}`);
      },
    },

    {
      name: 'external lane rejects trustedContent: false too — presence is the fault',

      run() {
        assert.ok(prepare.internalOnlyFieldFault({ trustedContent: false }) instanceof Error, 'trustedContent: false passed');
      },
    },

    // ---------- The stored campaign doc can no longer carry it ----------

    {
      name: 'a rejected campaign never reaches buildCampaignDoc, so the doc cannot carry contentHtml',

      run() {
        // buildCampaignDoc() blacklists doc-level fields rather than allowlisting, so
        // anything the caller sends persists into doc.settings — which is why the route
        // rejects BEFORE calling it. This asserts both halves: the persistence is real,
        // and the guard fires on that exact payload.
        const hostile = { name: 'Probe', subject: 'Probe', contentHtml: '<img src=x onerror=alert(1)>' };

        const { campaignSettings } = buildCampaignDoc(hostile);

        assert.ok('contentHtml' in campaignSettings, 'buildCampaignDoc no longer persists contentHtml — update this test');
        assert.ok(prepare.internalOnlyFieldFault(hostile) instanceof Error, 'the payload that persists was not rejected');
      },
    },

    // ---------- Belt: the route schemas do not admit the two top-level fields ----------

    {
      name: 'the admin/email + campaign schemas strip html, contentHtml and trustedContent',

      run() {
        // These three never reach the handler over HTTP today, because a zod object
        // strips unknown keys and none of them is declared (#125 removed the last one,
        // `html`, from the admin/email schema). That strip is the BELT;
        // internalOnlyFieldFault() in the handler is the BRACES — the moment either
        // field is declared on a schema (or a consumer route forwards raw settings),
        // the guard is what stops it. If this test ever fails, the guard is live.
        const emailSchema = require('../../src/manager/schemas/admin/email/post.js')();
        const email = emailSchema.parse({
          to: 'a@b.co',
          subject: 's',
          html: '<img src=x onerror=alert(1)>',
          contentHtml: '<img src=x>',
          trustedContent: true,
          data: { content: { html: '<img src=x onerror=alert(1)>' } },
        });

        assert.equal(email.html, undefined, 'admin/email schema admitted the top-level html override');
        assert.equal(email.contentHtml, undefined, 'admin/email schema admitted contentHtml');
        assert.equal(email.trustedContent, undefined, 'admin/email schema admitted trustedContent');

        // ...but data is a passthrough, which is exactly why data.content.html needs
        // the handler guard rather than a schema strip.
        assert.equal(email.data.content.html, '<img src=x onerror=alert(1)>', 'data.content.html no longer passes the schema — update this test');

        const campaignSchema = require('../../src/manager/schemas/marketing/campaign/post.js')();
        const campaign = campaignSchema.parse({ name: 'n', subject: 's', contentHtml: '<img src=x>', trustedContent: true });

        assert.equal(campaign.contentHtml, undefined, 'campaign schema admitted contentHtml');
        assert.equal(campaign.trustedContent, undefined, 'campaign schema admitted trustedContent');
      },
    },

    // ---------- The internal lane keeps working ----------

    {
      name: 'internal caller still gets its pre-rendered html into the payload',

      async run() {
        const html = await transactionalBuild({
          subject: 'Internal',
          data: { content: { html: '<p id="prerendered">first-party <b>html</b></p>' } },
        });

        assert.ok(html.includes('id="prerendered"'), `pre-rendered html did not reach the payload: ${html}`);
        assert.ok(/<b>html<\/b>/.test(html), 'pre-rendered markup was escaped for an internal caller');
      },
    },

    {
      name: 'internal caller still gets the top-level html override into the payload',

      async run() {
        // #125 closed the override to the API lane only — build() still honors it for
        // a first-party caller that hands over a complete document.
        const html = await transactionalBuild({
          subject: 'Internal',
          html: '<html><body id="whole-document">first-party</body></html>',
        });

        assert.equal(html, '<html><body id="whole-document">first-party</body></html>', `the override did not replace the body: ${html}`);
      },
    },
  ],
};
