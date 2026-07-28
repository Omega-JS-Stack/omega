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
 * Run:   node src/manager/libraries/email/render-content.test.js
 */
const assert = require('node:assert');
const { renderContent } = require('./prepare.js');
const { escapeHtml } = require('./constants.js');

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${label}\n    ${error.message}`);
  }
}

// ---------- Untrusted lane: payloads come out inert ----------

check('untrusted <script> payload renders as inert text', () => {
  const out = renderContent({ content: 'Hello <script>alert("xss")</script> there' });

  assert.ok(!/<script/i.test(out), `live <script> survived: ${out}`);
  assert.ok(out.includes('&lt;script&gt;'), `payload was not escaped: ${out}`);
});

check('untrusted <img onerror> payload renders as inert text', () => {
  const out = renderContent({ content: '<img src=x onerror="alert(1)">' });

  assert.ok(!/<img/i.test(out), `live <img> survived: ${out}`);
  assert.ok(out.includes('&lt;img'), `payload was not escaped: ${out}`);
});

check('untrusted is the DEFAULT — no flag means escaped', () => {
  // The security property is the default, not an opt-in.
  const out = renderContent({ content: '<iframe src="evil"></iframe>' });

  assert.ok(!/<iframe/i.test(out), `live <iframe> survived: ${out}`);
});

check('untrusted anchor payload cannot inject an onclick handler', () => {
  const out = renderContent({ content: '<a href="#" onclick="steal()">click</a>' });

  assert.ok(!/onclick/i.test(out) || out.includes('&lt;a'), `live handler survived: ${out}`);
  assert.ok(out.includes('&lt;a'), `anchor was not escaped: ${out}`);
});

check('untrusted content still renders real markdown', () => {
  // Escaping raw HTML must not cost us markdown — bold/links/lists still work.
  const out = renderContent({ content: '**bold** and [link](https://example.com)' });

  assert.ok(out.includes('<strong>bold</strong>'), `markdown bold lost: ${out}`);
  assert.ok(out.includes('<a href="https://example.com">link</a>'), `markdown link lost: ${out}`);
});

// ---------- Trusted lane: first-party markup still renders ----------

check('first-party template markup renders live with trusted: true', () => {
  const markup = '<strong>Alert Details:</strong>\n<ul>\n<li>Amount: $5</li>\n</ul>';
  const out = renderContent({ content: markup, trusted: true });

  assert.ok(out.includes('<strong>Alert Details:</strong>'), `markup was escaped: ${out}`);
  assert.ok(out.includes('<ul>') && out.includes('<li>'), `list markup lost: ${out}`);
});

check('trusted markup with escaped third-party values stays inert (the alert-email model)', () => {
  // Exactly what the dispute alert does: first-party <li> markup, escaped webhook value.
  const hostile = '<script>alert(1)</script>';
  const out = renderContent({
    content: `<ul>\n<li><strong>Customer Email:</strong> ${escapeHtml(hostile)}</li>\n</ul>`,
    trusted: true,
  });

  assert.ok(out.includes('<li>'), `first-party markup lost: ${out}`);
  assert.ok(!/<script/i.test(out), `escaped value still injected: ${out}`);
  assert.ok(out.includes('&lt;script&gt;'), `value was not escaped: ${out}`);
});

// ---------- The pre-rendered html lane ----------

check('pre-rendered html passes through untouched and skips markdown', () => {
  const out = renderContent({ content: '**ignored**', html: '<p>first-party <b>html</b></p>' });

  assert.equal(out, '<p>first-party <b>html</b></p>');
});

// ---------- UTM tagging survives the split ----------

check('UTM tagging still applies on the untrusted lane', () => {
  const out = renderContent(
    { content: '[link](https://example.com/page)' },
    { brandUrl: 'https://example.com', brandId: 'testbrand', campaign: 'welcome', type: 'transactional' },
  );

  assert.ok(out.includes('utm_source=testbrand'), `UTM not applied: ${out}`);
  assert.ok(out.includes('utm_campaign=welcome'), `UTM campaign missing: ${out}`);
});

check('UTM tagging still applies on the trusted lane', () => {
  const out = renderContent(
    { content: '<a href="https://example.com/page">link</a>', trusted: true },
    { brandUrl: 'https://example.com', brandId: 'testbrand', campaign: 'alert', type: 'transactional' },
  );

  assert.ok(out.includes('utm_source=testbrand'), `UTM not applied: ${out}`);
});

// ---------- Empty / passthrough behavior unchanged ----------

check('empty content returns empty string', () => {
  assert.equal(renderContent({}), '');
  assert.equal(renderContent({ content: '' }), '');
});

// ---------- escapeHtml itself ----------

check('escapeHtml neutralizes the injection characters', () => {
  assert.equal(escapeHtml('<b>&"'), '&lt;b&gt;&amp;&quot;');
});

check('escapeHtml renders 0 and false rather than dropping them', () => {
  // Amounts and flags land in alert emails — a falsy value must still print.
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(false), 'false');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

// ---------- Integration: the flag survives the whole transactional build ----------

// Proves the trust decision actually reaches the rendered SendGrid payload — a unit
// test on renderContent alone would still pass if build() stopped threading the flag.
async function integrationChecks() {
  process.env.UNSUBSCRIBE_HMAC_KEY = process.env.UNSUBSCRIBE_HMAC_KEY || 'test-key';

  const Transactional = require('./transactional/index.js');
  const Manager = {
    config: {
      brand: { id: 'testbrand', name: 'Test Brand', url: 'https://test.dev', contact: { email: 'hello@test.dev' }, images: {} },
    },
    project: { websiteUrl: 'https://test.dev' },
    libraries: { admin: {} },
    User: () => ({ properties: {} }),
  };
  const ctx = { Manager, log: () => {}, error: () => {} };
  const transactional = new Transactional(ctx);

  const build = (settings) => transactional.build({
    to: 'user@test.dev',
    template: 'card',
    ...settings,
  }).then((email) => email.content[0].value);

  const untrusted = await build({
    subject: 'Untrusted',
    data: { content: { title: 'Hi', message: 'Hello <script>alert(1)</script> world' } },
  });

  check('built email: untrusted payload is inert in the final HTML', () => {
    assert.ok(!/<script/i.test(untrusted), 'live <script> reached the SendGrid payload');
    assert.ok(untrusted.includes('&lt;script&gt;'), 'payload was not escaped in the final HTML');
  });

  const trusted = await build({
    subject: 'Trusted',
    trustedContent: true,
    data: { content: { title: 'Alert', message: '<strong>Details:</strong>\n<ul>\n<li>Amount: $5</li>\n</ul>' } },
  });

  check('built email: first-party alert markup still renders in the final HTML', () => {
    assert.ok(trusted.includes('<strong>Details:</strong>'), 'first-party markup was escaped');
    assert.ok(/<ul>/i.test(trusted), 'first-party list markup was lost');
  });
}

integrationChecks()
  .catch((error) => {
    failures++;
    console.error(`  ✗ integration checks threw\n    ${error.message}`);
  })
  .then(() => {
    if (failures > 0) {
      console.error(`\n${failures} failure(s)`);
      process.exit(1);
    }
    console.log('\nAll render-content checks passed');
  });
