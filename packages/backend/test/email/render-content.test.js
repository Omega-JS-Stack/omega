/**
 * renderContent trust-split test — outbound email HTML must never carry live markup
 * that came from someone else.
 *
 * The email body has two render lanes (prepare.js):
 *   - UNTRUSTED (default): AI-authored campaign bodies, user-submitted fields, anything
 *     off a route. markdown-it runs with html:false, so smuggled tags render as text.
 *   - TRUSTED (`trusted: true`): first-party callers that hand-build markup (the internal
 *     dispute + newsletter-report alerts). They must escapeHtml() every third-party value.
 *
 * Plain-node unit test (no emulator, no network).
 */
const assert = require('node:assert');
const { renderContent } = require('../../dist/manager/libraries/email/prepare.js');
const { escapeHtml } = require('../../dist/manager/libraries/email/constants.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// The integration checks below prove the trust decision actually reaches the rendered
// SendGrid payload — a unit test on renderContent alone would still pass if build()
// stopped threading the flag. Each build runs once and is shared by its assertions.
function transactionalBuild(settings) {
  process.env.UNSUBSCRIBE_HMAC_KEY = process.env.UNSUBSCRIBE_HMAC_KEY || 'test-key';

  const Transactional = require('../../dist/manager/libraries/email/transactional/index.js');
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

let untrustedBuild;
const buildUntrusted = () => (untrustedBuild = untrustedBuild || transactionalBuild({
  subject: 'Untrusted',
  data: { content: { title: 'Hi', message: 'Hello <script>alert(1)</script> world' } },
}));

let trustedBuild;
const buildTrusted = () => (trustedBuild = trustedBuild || transactionalBuild({
  subject: 'Trusted',
  trustedContent: true,
  data: { content: { title: 'Alert', message: '<strong>Details:</strong>\n<ul>\n<li>Amount: $5</li>\n</ul>' } },
}));

module.exports = defineCases({
  description: 'Email renderContent trust split (untrusted escapes, trusted renders)',
  type: 'group',
  tests: [
    // ---------- Untrusted lane: payloads come out inert ----------

    {
      name: 'untrusted <script> payload renders as inert text',

      run() {
        const out = renderContent({ content: 'Hello <script>alert("xss")</script> there' });

        assert.ok(!/<script/i.test(out), `live <script> survived: ${out}`);
        assert.ok(out.includes('&lt;script&gt;'), `payload was not escaped: ${out}`);
      },
    },

    {
      name: 'untrusted <img onerror> payload renders as inert text',

      run() {
        const out = renderContent({ content: '<img src=x onerror="alert(1)">' });

        assert.ok(!/<img/i.test(out), `live <img> survived: ${out}`);
        assert.ok(out.includes('&lt;img'), `payload was not escaped: ${out}`);
      },
    },

    {
      name: 'untrusted is the DEFAULT — no flag means escaped',

      run() {
        // The security property is the default, not an opt-in.
        const out = renderContent({ content: '<iframe src="evil"></iframe>' });

        assert.ok(!/<iframe/i.test(out), `live <iframe> survived: ${out}`);
      },
    },

    {
      name: 'untrusted anchor payload cannot inject an onclick handler',

      run() {
        const out = renderContent({ content: '<a href="#" onclick="steal()">click</a>' });

        assert.ok(!/onclick/i.test(out) || out.includes('&lt;a'), `live handler survived: ${out}`);
        assert.ok(out.includes('&lt;a'), `anchor was not escaped: ${out}`);
      },
    },

    {
      name: 'untrusted content still renders real markdown',

      run() {
        // Escaping raw HTML must not cost us markdown — bold/links/lists still work.
        const out = renderContent({ content: '**bold** and [link](https://example.com)' });

        assert.ok(out.includes('<strong>bold</strong>'), `markdown bold lost: ${out}`);
        assert.ok(out.includes('<a href="https://example.com">link</a>'), `markdown link lost: ${out}`);
      },
    },

    // ---------- Trusted lane: first-party markup still renders ----------

    {
      name: 'first-party template markup renders live with trusted: true',

      run() {
        const markup = '<strong>Alert Details:</strong>\n<ul>\n<li>Amount: $5</li>\n</ul>';
        const out = renderContent({ content: markup, trusted: true });

        assert.ok(out.includes('<strong>Alert Details:</strong>'), `markup was escaped: ${out}`);
        assert.ok(out.includes('<ul>') && out.includes('<li>'), `list markup lost: ${out}`);
      },
    },

    {
      name: 'trusted markup with escaped third-party values stays inert (the alert-email model)',

      run() {
        // Exactly what the dispute alert does: first-party <li> markup, escaped webhook value.
        const hostile = '<script>alert(1)</script>';
        const out = renderContent({
          content: `<ul>\n<li><strong>Customer Email:</strong> ${escapeHtml(hostile)}</li>\n</ul>`,
          trusted: true,
        });

        assert.ok(out.includes('<li>'), `first-party markup lost: ${out}`);
        assert.ok(!/<script/i.test(out), `escaped value still injected: ${out}`);
        assert.ok(out.includes('&lt;script&gt;'), `value was not escaped: ${out}`);
      },
    },

    // ---------- The pre-rendered html lane ----------

    {
      name: 'pre-rendered html passes through untouched and skips markdown',

      run() {
        const out = renderContent({ content: '**ignored**', html: '<p>first-party <b>html</b></p>' });

        assert.equal(out, '<p>first-party <b>html</b></p>');
      },
    },

    // ---------- UTM tagging survives the split ----------

    {
      name: 'UTM tagging still applies on the untrusted lane',

      run() {
        const out = renderContent(
          { content: '[link](https://example.com/page)' },
          { brandUrl: 'https://example.com', brandId: 'testbrand', campaign: 'welcome', type: 'transactional' },
        );

        assert.ok(out.includes('utm_source=testbrand'), `UTM not applied: ${out}`);
        assert.ok(out.includes('utm_campaign=welcome'), `UTM campaign missing: ${out}`);
      },
    },

    {
      name: 'UTM tagging still applies on the trusted lane',

      run() {
        const out = renderContent(
          { content: '<a href="https://example.com/page">link</a>', trusted: true },
          { brandUrl: 'https://example.com', brandId: 'testbrand', campaign: 'alert', type: 'transactional' },
        );

        assert.ok(out.includes('utm_source=testbrand'), `UTM not applied: ${out}`);
      },
    },

    // ---------- Empty / passthrough behavior unchanged ----------

    {
      name: 'empty content returns empty string',

      run() {
        assert.equal(renderContent({}), '');
        assert.equal(renderContent({ content: '' }), '');
      },
    },

    // ---------- escapeHtml itself ----------

    {
      name: 'escapeHtml neutralizes the injection characters',

      run() {
        assert.equal(escapeHtml('<b>&"'), '&lt;b&gt;&amp;&quot;');
      },
    },

    {
      name: 'escapeHtml renders 0 and false rather than dropping them',

      run() {
        // Amounts and flags land in alert emails — a falsy value must still print.
        assert.equal(escapeHtml(0), '0');
        assert.equal(escapeHtml(false), 'false');
        assert.equal(escapeHtml(null), '');
        assert.equal(escapeHtml(undefined), '');
      },
    },

    // ---------- Integration: the flag survives the whole transactional build ----------

    {
      name: 'built email: untrusted payload is inert in the final HTML',

      async run() {
        const untrusted = await buildUntrusted();

        assert.ok(!/<script/i.test(untrusted), 'live <script> reached the SendGrid payload');
        assert.ok(untrusted.includes('&lt;script&gt;'), 'payload was not escaped in the final HTML');
      },
    },

    {
      name: 'built email: first-party alert markup still renders in the final HTML',

      async run() {
        const trusted = await buildTrusted();

        assert.ok(trusted.includes('<strong>Details:</strong>'), 'first-party markup was escaped');
        assert.ok(/<ul>/i.test(trusted), 'first-party list markup was lost');
      },
    },
  ],
});
