/**
 * The framework never translates its OWN functional pages (#605). The skip
 * list is DERIVED from the packaged defaults tree — every default page's
 * layout says whether it is marketing copy or plumbing, and its permalink says
 * where it lands — so a default page that moves, arrives, or is renamed can
 * never drift out of the list. `translation.exclude` goes back to being what
 * it is for: the brand's own pages.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { defaultExcludedRoutes, legalRoutes } = require('../src/translate/default-routes.js');

// The list every brand had to hand-write before the framework owned it — the
// playground's `translation.exclude`, verbatim (#605 deletes it there).
const HAND_WRITTEN = [
  'account', 'app', 'dashboard', 'signin', 'signup', 'login', 'register',
  'forgot', 'recover', 'reset', 'reset-password', 'change-password',
  'token', 'join', 'cancel', 'refund',
];

test('#605: every route a brand used to hand-write is framework-owned now', () => {
  const routes = defaultExcludedRoutes();

  for (const route of HAND_WRITTEN) {
    assert.ok(routes.has(route), `/${route} is a framework default page — the brand should not have to list it`);
  }
});

test('#605: the derived list reaches the flows no hand-written list covered', () => {
  const routes = defaultExcludedRoutes();

  // The payment + portal pages moved under folders after the legacy list was
  // written (/checkout became /payment/checkout), so every brand kept paying
  // to translate a card form. Derivation cannot miss them.
  for (const route of ['payment/checkout', 'payment/confirmation', 'portal/email-preferences', 'dashboard/account', 'connections/callback', '404']) {
    assert.ok(routes.has(route), `/${route} is framework plumbing`);
  }
});

test('#605: the brand-facing default pages are still translated', () => {
  const routes = defaultExcludedRoutes();

  // Marketing surface — the whole point of translating a site.
  for (const route of ['', 'about', 'pricing', 'blog', 'contact', 'careers', 'download', 'alternatives', 'feedback', 'status', 'extension']) {
    assert.ok(!routes.has(route), `/${route} is marketing copy and must keep translating`);
  }
});

test('#621: the legal routes are derived from the same scan, not typed out twice', () => {
  // The generator harvests nothing for them — legally binding copy ships in ONE
  // language (docs/shared/translation.md) — and it reads them from HERE.
  assert.deepStrictEqual([...legalRoutes()].sort(), ['cookies', 'privacy', 'terms']);

  // Derived, so a legal page that arrives is covered with no edit anywhere else
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-defaults-'));
  const pages = path.join(tmp, 'pages', 'legal');
  fs.mkdirSync(pages, { recursive: true });
  fs.writeFileSync(path.join(pages, 'dpa.md'), '---\nlayout: blueprint/legal/dpa\npermalink: /dpa\n---\n');
  fs.writeFileSync(path.join(pages, 'signin.md'), '---\nlayout: blueprint/auth/signin\npermalink: /signin\n---\n');

  try {
    assert.deepStrictEqual([...legalRoutes(tmp)], ['dpa'], 'the legal page only — an auth page is excluded, not legal');
    assert.deepStrictEqual([...defaultExcludedRoutes(tmp)].sort(), ['dpa', 'signin'], 'both are still never translated');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#605: the list is derived from the defaults tree, not typed out', () => {
  // A brand-new auth page dropped into a defaults tree is skipped with no
  // edit anywhere else — which is exactly what "derived" has to mean.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-defaults-'));
  const pages = path.join(tmp, 'pages', 'auth');
  fs.mkdirSync(pages, { recursive: true });
  fs.writeFileSync(path.join(pages, 'passkey.md'), '---\nlayout: blueprint/auth/passkey\npermalink: /passkey\n---\n');
  fs.mkdirSync(path.join(tmp, 'pages', 'guides'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'pages', 'guides', 'index.md'), '---\nlayout: blueprint/guides\npermalink: /guides\n---\n');

  try {
    const routes = defaultExcludedRoutes(tmp);

    assert.deepStrictEqual([...routes], ['passkey'], 'the auth page is skipped, the content page is not');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
