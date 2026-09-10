/**
 * The built-output audit checks ([#468](https://github.com/Omega-JS-Stack/omega/issues/468)):
 * four cheap questions `omega test` asks of a real `dist/`, beside the link
 * check ([#430](https://github.com/Omega-JS-Stack/omega/issues/430)) whose
 * machinery this is a sibling of — fail during tests, never block a deploy.
 *
 *   - META      every page ships a non-empty title and description.
 *   - FRAGMENTS every in-site `#anchor` lands on an element the target page has.
 *   - ALT       every `<img>` carries an `alt` (an EMPTY one is decorative, and valid).
 *   - SITEMAP   every indexable built page is listed in the emitted sitemap.xml.
 *
 * They are static scans over the SAME dist the link check reads: no browser, no
 * network, no headless anything. The heavy audits (Lighthouse, HTML validation,
 * spelling, page speed) are deliberately not here — they cost minutes per run
 * and belong to the manual performance program.
 *
 * EXCEPTIONS are the link check's file and the link check's rule (a declaration
 * that has started passing is itself a failure), with one list per check. The
 * page a list hangs off is the page that OWNS the finding: the source page for
 * links, and for a fragment the page carrying the ANCHOR — a hash a target
 * routes in JavaScript is right on every page that links it, and 190 nav pages
 * must not each declare the same thing.
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const { readBuildPathPrefix, stripPathPrefix } = require('./path-prefix.js');
const {
  CODE_DISPLAY,
  EXTERNAL,
  LINK_ATTR,
  fileDir,
  normalize,
  toPosix,
} = require('./link-resolver.js');

// Pages the build COPIES rather than renders: Firebase's self-hosted OAuth
// helpers (src/firebase-auth-helpers.js fetches /__/auth/handler.html and
// /__/auth/iframe.html from firebaseapp.com verbatim). They land in dist as
// vendor markup no brand authored and no brand may edit, so no check reads
// them — they are not pages of the site.
const NOT_A_PAGE = /^\/__\//;

// A translated copy of a page is the SAME page (src/translate/): the language
// prefix the translation lane writes it under is not a different document, so a
// framework route declared for `contact.html` holds for `es/contact.html` too.
const LANGUAGE_PREFIX = /^[a-z]{2}(?:-[a-zA-Z]{2,4})?\//;

// The hashes @omega.js/web's OWN pages ROUTE in JavaScript instead of
// anchoring, keyed by the dist path each default page ships at. The account
// page maps `#billing` onto its `billing-section` element
// (core/js/pages/dashboard/account/index.js) and the nav links it from every
// page in the build; the contact page's `#chat` opens the chat widget
// (core/js/pages/contact/index.js). Neither is an anchor a brand could add, so
// neither costs a brand an exception — the default pages start every brand at
// zero, exactly as the link check's do (#427). Not stale-checked: a brand that
// drops or overrides the page owns its own anchors from then on.
const FRAMEWORK_HASH_ROUTES = {
  'dashboard/account.html': [
    '#profile', '#security', '#billing', '#orders', '#connections', '#notifications',
    '#referrals', '#team', '#api-keys', '#data-request', '#delete', '#refund',
  ],
  'contact.html': ['#chat'],
};

/** A page's site URL, under the same flat contract the link check resolves by. */
const pageUrl = (id) => normalize(`/${id.replace(/\.html$/, '').replace(/(^|\/)index$/, '$1')}`);

/**
 * Every HTML page a build wrote, read once for all four checks.
 *
 * Code DISPLAY is stripped exactly as the link scan strips it (#521): a `<pre>`
 * block prints escaped source, so the `<img>` inside a docs snippet is
 * characters on the page, not an image the page emits.
 *
 * @param {string} distDir - the build output root
 * @returns {Array<{id: string, url: string, html: string}>} dist-relative id, site URL, markup
 */
function readDistPages(distDir) {
  const disk = jetpack.cwd(distDir);
  const files = disk.find({ matching: '**/*.html', files: true, directories: false }) || [];

  return files
    .map((file) => {
      const id = toPosix(file);
      return { id, url: pageUrl(id), html: String(disk.read(file)).replace(CODE_DISPLAY, '') };
    })
    .filter((page) => !NOT_A_PAGE.test(page.url));
}

/**
 * One tag's attributes, lowercased names to values, through the link scan's
 * quote-aware attribute reader (#601) — the quote that OPENED a value is the
 * quote that closes it.
 * @param {string} tag - the raw tag, `<` to `>`
 * @returns {Object<string, string>}
 */
function attributes(tag) {
  const out = {};
  for (const match of tag.matchAll(LINK_ATTR)) {
    out[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return out;
}

/** The `content` of the first `<meta name="…">` a page carries ('' = none). */
function metaContent(html, name) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attr = attributes(match[0]);
    if ((attr.name || '').toLowerCase() === name) return attr.content || '';
  }
  return '';
}

/** Every element id on a page — the anchors it actually offers. */
function elementIds(html) {
  const ids = new Set();
  for (const match of html.matchAll(LINK_ATTR)) {
    if (match[1].toLowerCase() !== 'id') continue;
    const value = match[2] ?? match[3] ?? match[4];
    if (value) ids.add(value);
  }
  return ids;
}

/**
 * The page meta check: a title and a description, both non-empty.
 *
 * Presence proves nothing — core/head.html emits both tags on every page, so a
 * page whose `meta.description` resolved to nothing ships `content=""` and
 * reads as described to any scan that counts tags.
 * @param {{html: string}} page
 * @returns {string[]} the missing ones ('title', 'description')
 */
function metaFindings(page) {
  const found = [];

  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(page.html);
  if (!title || !title[1].trim()) found.push('title');
  if (!metaContent(page.html, 'description').trim()) found.push('description');

  return found;
}

// `alt` as the MINIFIER leaves it: `alt=""` collapses to a valueless boolean
// attribute, which is the shape almost every decorative image ships in. The
// question is presence, so this reads the raw tag rather than a parsed value —
// and the leading space keeps `data-alt=` from answering for it.
const ALT_ATTR = /\salt(?=[\s=/>]|$)/i;

/**
 * The image alt check: every `<img>` carries the attribute. An EMPTY `alt` is
 * the decorative declaration and passes — the failure is having no answer at
 * all, which is what leaves a screen reader announcing a file name.
 * @param {{html: string}} page
 * @returns {string[]} one entry per image with no alt, by src
 */
function altFindings(page) {
  const found = new Set();

  for (const match of page.html.matchAll(/<img\b[^>]*>/gi)) {
    if (ALT_ATTR.test(match[0])) continue;
    const attr = attributes(match[0]);
    found.add(attr.src || attr['data-src'] || '(no src)');
  }

  return [...found];
}

/**
 * The sitemap orphan check: an indexable page the emitted sitemap does not list.
 *
 * The opt-out is read off the BUILD, never guessed, and there is exactly ONE:
 * #564 made noindex and sitemap membership the same decision, so a page whose
 * head says `noindex` is out of the sitemap on purpose and every other page
 * belongs in it. This check keeps no URL list of its own: the dev surface,
 * /admin/, redirect stubs and drafts all reach it as the same rendered flag.
 *
 * @param {Array<{id: string, url: string, html: string}>} pages
 * @param {Set<string>} listed - the URLs sitemap.xml carries
 * @returns {Map<string, string[]>} page id → its URL, for the orphans
 */
function sitemapFindings(pages, listed) {
  const findings = new Map();

  for (const page of pages) {
    if (listed.has(page.url)) continue;
    if (/noindex/i.test(metaContent(page.html, 'robots'))) continue;

    findings.set(page.id, [page.url]);
  }

  return findings;
}

/**
 * The URLs the emitted sitemap lists, site-relative.
 * @param {string} distDir - the build output root
 * @param {string} [prefix] - the base path a mounted build carries
 * @returns {Set<string>|null} null = no sitemap.xml, which turns the check off
 */
function sitemapUrls(distDir, prefix) {
  const xml = jetpack.read(path.join(distDir, 'sitemap.xml'));
  if (xml === undefined) return null;

  const urls = new Set();
  for (const match of xml.matchAll(/<loc>([^<]*)<\/loc>/gi)) {
    // `<loc>` is absolute by the sitemap spec: drop the origin, collapse the
    // doubled slash a config `url:` with a trailing slash leaves behind, and
    // take the site off its mount point — a project site's locs are built from
    // a `brand.url` that already carries the base path, while its dist paths
    // never do.
    const pathname = match[1].trim().replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/, '').replace(/\/{2,}/g, '/');
    urls.add(normalize(stripPathPrefix(pathname || '/', prefix || '')));
  }

  return urls;
}

/**
 * The anchor fragment check: `href="/page#id"` and `href="#id"` land on an
 * element the target page has.
 *
 * Findings hang off the TARGET page, with the linking pages named for the fix.
 * A fragment on a page the build never wrote is skipped on purpose: that is a
 * dead link, the link check reports it, and one break must not read as two.
 *
 * @param {Array<{id: string, url: string, html: string}>} pages
 * @param {string} [prefix] - the base path a mounted build carries
 * @returns {{findings: Map<string, string[]>, sources: Map<string, Set<string>>}}
 */
function fragmentFindings(pages, prefix) {
  const byUrl = new Map(pages.map((page) => [page.url, page]));
  const ids = new Map();
  const idsOf = (page) => {
    if (!ids.has(page.id)) ids.set(page.id, elementIds(page.html));
    return ids.get(page.id);
  };

  const findings = new Map();
  const sources = new Map();

  for (const page of pages) {
    const dir = fileDir(page.id);

    for (const match of page.html.matchAll(LINK_ATTR)) {
      if (match[1].toLowerCase() !== 'href') continue;
      const value = match[2] ?? match[3] ?? match[4];
      if (value === undefined) continue;

      const hash = value.indexOf('#');
      if (hash < 0) continue;

      const fragment = value.slice(hash + 1);
      // A bare `#` is the top of the document, a browser-defined destination.
      if (!fragment) continue;

      // Everything before the hash decides WHICH page owns the anchor. The
      // leading-`#` case is settled above, so EXTERNAL here reads schemes and
      // protocol-relative hosts only.
      const before = value.slice(0, hash);
      if (before && EXTERNAL.test(before)) continue;

      const targetPath = before.split('?')[0];
      const target = targetPath
        ? byUrl.get(normalize(targetPath.startsWith('/')
          ? stripPathPrefix(targetPath, prefix || '')
          : path.posix.join(dir, targetPath)))
        : page;
      if (!target) continue;

      const token = `#${fragment}`;
      if (idsOf(target).has(decodeFragment(fragment))) continue;
      if (frameworkRoutes(target.id).includes(token)) continue;

      if (!findings.has(target.id)) findings.set(target.id, []);
      if (!findings.get(target.id).includes(token)) findings.get(target.id).push(token);

      const key = `${target.id} ${token}`;
      if (!sources.has(key)) sources.set(key, new Set());
      sources.get(key).add(page.id);
    }
  }

  return { findings, sources };
}

/** The hashes a page routes in JS, in any language the build wrote it in. */
function frameworkRoutes(id) {
  return FRAMEWORK_HASH_ROUTES[id] || FRAMEWORK_HASH_ROUTES[id.replace(LANGUAGE_PREFIX, '')] || [];
}

/**
 * A percent-encoded fragment as the id attribute spells it. A malformed escape
 * is a value the page emitted, not a programmer error here, so it is compared
 * raw rather than crashing the run.
 */
function decodeFragment(fragment) {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/**
 * Split one check's findings into the ones that fail and the declarations that
 * have quietly started passing — the link check's rule ([#430](https://github.com/Omega-JS-Stack/omega/issues/430)),
 * applied per page: an exception standing over a fixed page masks the next
 * regression there, so the declared list has to shrink.
 *
 * @param {Map<string, string[]>} findings - page id → the tokens it failed on
 * @param {Object<string, object>} exceptions - page id → its declared lists, by check
 * @param {string} check - which list to read ('meta', 'fragments', 'alt', 'sitemap')
 * @returns {{offenders: Array<[string, string]>, stale: string[]}} pairs to format, and stale entries
 */
function applyPageExceptions(findings, exceptions, check) {
  const offenders = [];
  for (const [page, tokens] of findings) {
    const declared = (exceptions[page] || {})[check];
    if (declared === true) continue;

    for (const token of tokens) {
      if (Array.isArray(declared) && declared.includes(token)) continue;
      offenders.push([page, token]);
    }
  }

  const stale = [];
  for (const [page, entry] of Object.entries(exceptions)) {
    const declared = entry[check];
    if (declared === undefined) continue;
    const tokens = findings.get(page) || [];

    // `true` excuses the whole check on the page, so it is stale the moment the
    // page has nothing left to excuse.
    if (declared === true) {
      if (!tokens.length) stale.push(page);
      continue;
    }
    stale.push(...declared.filter((token) => !tokens.includes(token)).map((token) => `${page} → ${token}`));
  }

  return { offenders, stale: stale.sort() };
}

/** `page → token` lines, the shape every check reports. */
const asLines = (result) => ({
  offenders: result.offenders.map(([page, token]) => `${page} → ${token}`).sort(),
  stale: result.stale,
});

/** Per-page findings for a check that reads one page at a time. */
function perPage(pages, findingsOf) {
  const findings = new Map();
  for (const page of pages) {
    const found = findingsOf(page);
    if (found.length) findings.set(page.id, found);
  }
  return findings;
}

/**
 * The `omega test` audit: all four checks over one walk of a built dist.
 * @param {object} options
 * @param {string} options.distDir - the build output root
 * @param {Object<string, object>} [options.exceptions] - page id → its declared lists, by check
 * @returns {{pageCount: number, meta: object, fragments: object, alt: object, sitemap: object}}
 */
function auditDist(options) {
  const pages = readDistPages(options.distDir);
  const exceptions = options.exceptions || {};
  const prefix = readBuildPathPrefix(pages.map((page) => page.html));
  const listed = sitemapUrls(options.distDir, prefix);

  const fragments = fragmentFindings(pages, prefix);
  const fragmentResult = applyPageExceptions(fragments.findings, exceptions, 'fragments');

  return {
    pageCount: pages.length,
    meta: asLines(applyPageExceptions(perPage(pages, metaFindings), exceptions, 'meta')),
    fragments: {
      offenders: fragmentResult.offenders
        .map(([page, token]) => `${page} → ${token} (${linkedFrom(fragments.sources.get(`${page} ${token}`))})`)
        .sort(),
      stale: fragmentResult.stale,
    },
    alt: asLines(applyPageExceptions(perPage(pages, altFindings), exceptions, 'alt')),
    // No sitemap.xml at all (a brand may suppress the default page) is nothing
    // to compare against, not a wall of orphans — and nothing to call stale.
    sitemap: listed
      ? asLines(applyPageExceptions(sitemapFindings(pages, listed), exceptions, 'sitemap'))
      : { offenders: [], stale: [] },
  };
}

/** The pages linking one broken fragment, named the way the link check names them. */
function linkedFrom(pages) {
  const [first, ...rest] = [...(pages || [])].sort();
  return `linked from ${first}${rest.length ? ` +${rest.length} more` : ''}`;
}

module.exports = {
  auditDist,
  readDistPages,
  applyPageExceptions,
  attributes,
  elementIds,
  metaFindings,
  altFindings,
  sitemapFindings,
  sitemapUrls,
  fragmentFindings,
  pageUrl,
  frameworkRoutes,
  FRAMEWORK_HASH_ROUTES,
  NOT_A_PAGE,
};
