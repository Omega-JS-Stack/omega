/**
 * The footer language switcher (#80 audit fix 4) — it renders CLIENT-SIDE from
 * the page's own `link[rel=alternate][hreflang]` tags, which the translate pass
 * stitches AFTER a page's copies are written, so the menu can only ever offer a
 * language that was actually produced ("hreflang never lies").
 *
 * The DOM here is the hand-rolled minimum the module touches (the same
 * convention @omega.js/client's suite uses: node has no DOM and web pulls in no
 * jsdom), plus one real mini-site build proving the classy footer ships the
 * empty mount for the module to fill.
 */
const assert = require('node:assert');
const { test } = require('node:test');

const {
  languageEntries,
  languageLabel,
  switcherHtml,
  mountLanguageSwitcher,
} = require('../core/js/core/language-switcher.js');
const { buildWith: sharedBuildWith, miniData } = require('./lib/build.js');

const buildWith = (siteData, overrides) => sharedBuildWith(siteData, overrides, 'language-switcher-test');

/** The minimum link element the module reads. */
function makeLinks(alternates) {
  return alternates.map(({ hreflang, href }) => ({
    getAttribute: (name) => (name === 'hreflang' ? hreflang : href),
  }));
}

/** The minimum document the module reads: a lang, some alternates, a mount. */
function makeDocument({ lang = 'en', alternates = [], mount = true } = {}) {
  const list = { innerHTML: '' };
  const mountEl = {
    hidden: true,
    querySelector: (selector) => (selector === '[data-omega-language-list]' ? list : null),
  };

  return {
    list,
    mount: mountEl,
    documentElement: { lang },
    querySelector: (selector) => (selector === '[data-omega-language-switcher]' && mount ? mountEl : null),
    querySelectorAll: () => makeLinks(alternates),
  };
}

const EN_ES_FR = [
  { hreflang: 'x-default', href: 'https://example.com/about' },
  { hreflang: 'en', href: 'https://example.com/about' },
  { hreflang: 'es', href: 'https://example.com/es/about' },
  { hreflang: 'fr', href: 'https://example.com/fr/about' },
];

// ─── The DOM read ────────────────────────────────────────────────────────────

test('entries: x-default is dropped, repeated codes collapse, the page language is marked current', () => {
  const entries = languageEntries(makeLinks([
    ...EN_ES_FR,
    { hreflang: 'ES', href: 'https://example.com/es/about' },
    { hreflang: 'de', href: '' },
  ]), 'es');

  assert.deepEqual(entries.map((entry) => entry.code), ['en', 'es', 'fr'], 'x-default, the duplicate and the href-less tag are all out');
  assert.deepEqual(entries.map((entry) => entry.current), [false, true, false], 'documentElement.lang picks the current row');
  assert.equal(entries[1].href, 'https://example.com/es/about', 'each row carries its alternate href verbatim');
});

test('labels: every language names itself; an unknown code falls back to its upper-cased code', () => {
  assert.equal(languageLabel('en'), 'English');
  assert.equal(languageLabel('es'), 'Español', 'a native name, not the English exonym');
  assert.equal(languageLabel('qq'), 'QQ', 'no display name exists → the code labels the row');
  assert.equal(languageLabel('not a code'), 'NOT A CODE', 'a malformed code never throws out of the render');
});

test('html: hrefs and labels are escaped — a query-string permalink stays valid markup', () => {
  const html = switcherHtml(languageEntries(makeLinks([
    { hreflang: 'en', href: 'https://example.com/search?a=1&b=2' },
    { hreflang: 'es', href: 'https://example.com/es/search?a=1&b=2' },
  ]), 'en'));

  assert.ok(html.includes('href="https://example.com/search?a=1&amp;b=2"'), 'the ampersand is escaped, not raw');
  assert.ok(!html.includes('&b=2"'), 'no unescaped entity survives');
  assert.match(html, /class="dropdown-item active"[^>]*aria-current="true"/, 'the current language is marked for sight and for screen readers');
  assert.equal(html.match(/<li>/g).length, 2, 'one row per language');
});

// ─── The mount ───────────────────────────────────────────────────────────────

test('mount: a translated page renders one row per produced language and unhides the menu', () => {
  const doc = makeDocument({ lang: 'es', alternates: EN_ES_FR });

  assert.equal(mountLanguageSwitcher(doc), 3, 'en + es + fr — x-default is not a language');
  assert.equal(doc.mount.hidden, false, 'a real choice shows the control');
  assert.ok(doc.list.innerHTML.includes('href="https://example.com/fr/about"'), 'each produced copy is reachable');
  assert.ok(doc.list.innerHTML.includes('lang="es" dir="auto" hreflang="es" class="dropdown-item active"'), 'the current language row is the active one, bidi-isolated');
});

test('mount: a page with only its own language renders nothing and stays hidden', () => {
  const doc = makeDocument({
    lang: 'en',
    alternates: [
      { hreflang: 'x-default', href: 'https://example.com/legal' },
      { hreflang: 'en', href: 'https://example.com/legal' },
    ],
  });

  assert.equal(mountLanguageSwitcher(doc), 0, 'one language is not a choice');
  assert.equal(doc.mount.hidden, true, 'the control stays out of the footer');
  assert.equal(doc.list.innerHTML, '', 'nothing rendered');
});

test('mount: a surface with no switcher markup is a no-op', () => {
  const doc = makeDocument({ lang: 'en', alternates: EN_ES_FR, mount: false });

  assert.equal(mountLanguageSwitcher(doc), 0, 'no mount, no work — admin/app shells carry no footer');
  assert.equal(doc.list.innerHTML, '', 'nothing rendered');
});

// ─── The markup the module fills ─────────────────────────────────────────────

test('built classy footer ships the empty mount, hidden, with no build-time language rows', async () => {
  const pages = await buildWith(miniData);
  const html = pages.get('/blog');

  assert.match(html, /data-omega-language-switcher/, 'the footer carries the mount');
  assert.match(html, /<div class="dropup uj-language-dropdown" data-omega-language-switcher hidden>/, 'hidden until the DOM proves a second language exists');
  assert.match(html, /<ul class="dropdown-menu" data-omega-language-list><\/ul>/, 'the list ships EMPTY — the client fills it from hreflang');
  assert.ok(!html.includes('uj-language-dropdown-item'), 'the old build-time row (which named configured, not produced, languages) is gone');
});

test('every theme gets the mount — the footer include is classy\'s, the base layer of every chain', async () => {
  const pages = await buildWith({ ...miniData, theme: { id: 'newsflash' } });
  const html = pages.get('/blog');

  assert.match(html, /<ul class="dropdown-menu" data-omega-language-list><\/ul>/, 'newsflash inherits the one shared footer, mount and all');
});
