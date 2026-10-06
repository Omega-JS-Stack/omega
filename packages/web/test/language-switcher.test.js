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
const defineCases = require('@omega.js/devkit/test/define-cases');

const {
  languageEntries,
  languageLabel,
  switcherHtml,
  wireFlagFallback,
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

/** The minimum <img> the flag fallback touches: a listener and a removal. */
function makeFlag() {
  const flag = {
    removed: false,
    handlers: {},
    addEventListener: (event, handler) => { flag.handlers[event] = handler; },
    remove: () => { flag.removed = true; },
  };

  return flag;
}

/** The minimum list the module fills: an innerHTML sink over some flags. */
function makeList(flags = []) {
  return { innerHTML: '', querySelectorAll: () => flags };
}

/** The minimum document the module reads: a lang, some alternates, a mount. */
function makeDocument({ lang = 'en', alternates = [], mount = true, flags = [] } = {}) {
  const list = makeList(flags);
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

module.exports = defineCases({
  type: 'group',
  description: 'language-switcher',
  tests: [
    // ─── The DOM read ────────────────────────────────────────────────────────────

    {
      name: 'entries: x-default is dropped, repeated codes collapse, the page language is marked current',
      run: (ctx) => {
        const entries = languageEntries(makeLinks([
          ...EN_ES_FR,
          { hreflang: 'ES', href: 'https://example.com/es/about' },
          { hreflang: 'de', href: '' },
        ]), 'es');

        ctx.expect(entries.map((entry) => entry.code), 'x-default, the duplicate and the href-less tag are all out').toEqual(['en', 'es', 'fr']);
        ctx.expect(entries.map((entry) => entry.current), 'documentElement.lang picks the current row').toEqual([false, true, false]);
        ctx.expect(entries[1].href, 'each row carries its alternate href verbatim').toBe('https://example.com/es/about');
      },
    },

    {
      name: 'labels: every language names itself; an unknown code falls back to its upper-cased code',
      run: (ctx) => {
        ctx.expect(languageLabel('en')).toBe('English');
        ctx.expect(languageLabel('es'), 'a native name, not the English exonym').toBe('Español');
        ctx.expect(languageLabel('qq'), 'no display name exists → the code labels the row').toBe('QQ');
        ctx.expect(languageLabel('not a code'), 'a malformed code never throws out of the render').toBe('NOT A CODE');
      },
    },

    {
      name: 'html: hrefs and labels are escaped — a query-string permalink stays valid markup',
      run: (ctx) => {
        const html = switcherHtml(languageEntries(makeLinks([
          { hreflang: 'en', href: 'https://example.com/search?a=1&b=2' },
          { hreflang: 'es', href: 'https://example.com/es/search?a=1&b=2' },
        ]), 'en'));

        ctx.expect(html.includes('href="https://example.com/search?a=1&amp;b=2"'), 'the ampersand is escaped, not raw').toBeTruthy();
        ctx.expect(!html.includes('&b=2"'), 'no unescaped entity survives').toBeTruthy();
        ctx.expect(html, 'the current language is marked for sight and for screen readers').toMatch(/class="dropdown-item active"[^>]*aria-current="true"/);
        ctx.expect(html.match(/<li>/g).length, 'one row per language').toBe(2);
      },
    },

    // ─── The flags (#129) ────────────────────────────────────────────────────────

    {
      name: 'html: every row carries its flag BEFORE the name, fetched by its own code',
      run: (ctx) => {
        const html = switcherHtml(languageEntries(makeLinks(EN_ES_FR), 'en'));

        ctx.expect(html.match(/<img class="omega-language-flag"/g).length, 'one flag per language row').toBe(3);
        ctx.expect(html, 'the flag precedes the label, from the emitted core set, at the row\'s own hreflang code').toMatch(/<img class="omega-language-flag" data-omega-language-flag src="\/assets\/icons\/flags\/lang\/es\.svg" alt="" loading="lazy">Español/);
        ctx.expect(!html.includes('alt="Español"'), 'the flag is decorative — the label beside it already names the language').toBeTruthy();
      },
    },

    {
      name: 'flags: a language the emitted set has no file for removes its own image',
      run: (ctx) => {
        const [present, missing] = [makeFlag(), makeFlag()];

        ctx.expect(wireFlagFallback(makeList([present, missing])), 'every rendered flag is wired').toBe(2);

        missing.handlers.error();

        ctx.expect(missing.removed, 'a 404 leaves no broken-image glyph in the row').toBe(true);
        ctx.expect(present.removed, 'a flag that loads is untouched').toBe(false);
      },
    },

    // ─── The mount ───────────────────────────────────────────────────────────────

    {
      name: 'mount: a translated page renders one row per produced language and unhides the menu',
      run: (ctx) => {
        const flag = makeFlag();
        const doc = makeDocument({ lang: 'es', alternates: EN_ES_FR, flags: [flag] });

        ctx.expect(mountLanguageSwitcher(doc), 'en + es + fr — x-default is not a language').toBe(3);
        ctx.expect(doc.list.innerHTML.includes('src="/assets/icons/flags/lang/en.svg"'), 'each row ships its flag').toBeTruthy();
        ctx.expect(typeof flag.handlers.error === 'function', 'the mount wires the missing-flag fallback').toBeTruthy();
        ctx.expect(doc.mount.hidden, 'a real choice shows the control').toBe(false);
        ctx.expect(doc.list.innerHTML.includes('href="https://example.com/fr/about"'), 'each produced copy is reachable').toBeTruthy();
        ctx.expect(doc.list.innerHTML.includes('lang="es" dir="auto" hreflang="es" class="dropdown-item active"'), 'the current language row is the active one, bidi-isolated').toBeTruthy();
      },
    },

    {
      name: 'mount: a page with only its own language renders nothing and stays hidden',
      run: (ctx) => {
        const doc = makeDocument({
          lang: 'en',
          alternates: [
            { hreflang: 'x-default', href: 'https://example.com/legal' },
            { hreflang: 'en', href: 'https://example.com/legal' },
          ],
        });

        ctx.expect(mountLanguageSwitcher(doc), 'one language is not a choice').toBe(0);
        ctx.expect(doc.mount.hidden, 'the control stays out of the footer').toBe(true);
        ctx.expect(doc.list.innerHTML, 'nothing rendered').toBe('');
      },
    },

    {
      name: 'mount: a surface with no switcher markup is a no-op',
      run: (ctx) => {
        const doc = makeDocument({ lang: 'en', alternates: EN_ES_FR, mount: false });

        ctx.expect(mountLanguageSwitcher(doc), 'no mount, no work — admin/app shells carry no footer').toBe(0);
        ctx.expect(doc.list.innerHTML, 'nothing rendered').toBe('');
      },
    },

    // ─── The markup the module fills ─────────────────────────────────────────────

    {
      name: 'built classy footer ships the empty mount, hidden, with no build-time language rows',
      run: async (ctx) => {
        const pages = await buildWith(miniData);
        const html = pages.get('/blog');

        ctx.expect(html, 'the footer carries the mount').toMatch(/data-omega-language-switcher/);
        ctx.expect(html, 'hidden until the DOM proves a second language exists').toMatch(/<div class="dropup omega-language-dropdown" data-omega-language-switcher hidden>/);
        ctx.expect(html, 'the list ships EMPTY — the client fills it from hreflang').toMatch(/<ul class="dropdown-menu" data-omega-language-list><\/ul>/);
        ctx.expect(!html.includes('omega-language-dropdown-item'), 'the old build-time row (which named configured, not produced, languages) is gone').toBeTruthy();
      },
    },

    {
      name: 'every theme gets the mount — the footer include is classy\'s, the base layer of every chain',
      run: async (ctx) => {
        const pages = await buildWith({ ...miniData, theme: { id: 'newsflash' } });
        const html = pages.get('/blog');

        ctx.expect(html, 'newsflash inherits the one shared footer, mount and all').toMatch(/<ul class="dropdown-menu" data-omega-language-list><\/ul>/);
      },
    },
  ],
});
