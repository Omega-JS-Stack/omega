/**
 * Built-output link resolution ([#430](https://github.com/Omega-JS-Stack/omega/issues/430)):
 * every internal `href`/`src` a built page emits must land on something the
 * same build wrote.
 *
 * This is the question nothing on either side was asking. A brand's nav and
 * footer could keep pointing at seven social shortlink pages that had stopped
 * being generated, and every smoke check stayed green because a link is just a
 * string until someone resolves it. The consumer prototype that caught it is
 * retired here: the guard belongs to `omega test`, for every brand, so no brand
 * has to grow its own copy.
 *
 * THE URL CONTRACT is omega's flat, extensionless one: `/foo` is served by
 * `foo.html` or `foo/index.html`, an asset path is the file itself, and a
 * relative value resolves against its emitting page's directory. That contract
 * is the only thing this module knows; WHERE a page's output lives is the
 * caller's, through the `resolves`/`dirOf` seam:
 *
 *   - `omega test` walks a real `dist/` — `resolves` is a filesystem check, so
 *     assets are checked as-is (see `distResolves`).
 *   - the framework's own default-page guard (#427) scans a fixture build's
 *     in-memory pages, where the emitted URL set IS the resolution table and no
 *     asset tree exists to check against.
 *
 * EXCEPTIONS are per SOURCE PAGE, never global: a brand declares that `admin.html`
 * may link at `/admin/notifications/new`, and any OTHER page linking there still
 * fails. Each declared exception carries its own expiry — `applyExceptions`
 * reports one that has started resolving, because an exception left standing
 * over a fixed link is a mask over the next regression at that URL.
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');

// Anything with a scheme (https:, mailto:, tel:, data:, javascript:, a brand's
// own app protocol), a protocol-relative host, or a bare fragment leaves the site.
const EXTERNAL = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|#)/;
const LINK_ATTR = /\s(?:href|src)=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

// The pages half of a build: a feed, a sitemap or a robots file is data, not a
// document with links in it (`/feeds/posts.json` carries escaped JSON that reads
// as an href to any HTML-shaped scan).
const HTML_OUTPUT = /(?:^|\/)[^/.]+$|\.html$/;

// Code DISPLAY, not markup (#521): a <pre> block prints escaped source, so the
// `href=` inside it is characters on the page, not a link the page emits (the
// section gallery prints a variant's args that way). Real anchors live outside.
const CODE_DISPLAY = /<pre\b[^>]*>[\s\S]*?<\/pre>/gi;

// The brand's declared exceptions, relative to the target root. A flat map —
// source page → the links it is allowed to leave unresolved — because the list
// is data a human maintains and shrinks, not config the merge chain layers.
// json5 like every other consumer surface (#490): an exception is a last
// resort, so the reason it exists lives beside it, in a comment.
const EXCEPTIONS_FILE = path.join('config', 'link-exceptions.json5');
const LEGACY_EXCEPTIONS_FILE = path.join('config', 'link-exceptions.json');

/** `/foo/` and `/foo` are the same page; `/` is its own. */
const normalize = (url) => url.replace(/\/+$/, '') || '/';

/** Where a page's relative links resolve from, given its URL. */
const pageDir = (url) => path.posix.dirname(url === '/' ? '/index' : normalize(url));

/** Where a page's relative links resolve from, given its dist-relative file path. */
const fileDir = (file) => path.posix.resolve('/', path.posix.dirname(toPosix(file)));

/** Native separators → the posix ones every URL in here is written with. */
function toPosix(file) {
  return file.split(path.sep).join('/');
}

/**
 * Resolve one href/src value emitted by a page.
 * @param {string} value - the raw attribute value
 * @param {string} dir - the emitting page's directory (site-absolute, posix)
 * @param {function(string): boolean} resolves - does this site URL exist?
 * @returns {string|null} the unresolved URL, or null when it resolves
 */
function resolveLink(value, dir, resolves) {
  if (EXTERNAL.test(value)) return null;

  const target = value.split('#')[0].split('?')[0];
  // A bare `?query` or `#fragment` stays on the emitting page.
  if (!target) return null;

  const url = normalize(target.startsWith('/') ? target : path.posix.join(dir, target));

  return resolves(url) ? null : url;
}

/**
 * Read every href/src the given pages emit and keep the ones that resolve to
 * nothing.
 * @param {Iterable<[string, string]>} pages - page id → its rendered HTML
 * @param {object} options
 * @param {function(string): boolean} options.resolves - does this site URL exist?
 * @param {function(string): string} [options.dirOf] - a page id → its directory (default: it is a URL)
 * @returns {Map<string, Set<string>>} unresolved URL → the page ids emitting it
 */
function scanLinks(pages, options) {
  const resolves = options.resolves;
  const dirOf = options.dirOf || pageDir;
  const unresolved = new Map();

  for (const [id, html] of pages) {
    const dir = dirOf(id);
    const markup = String(html).replace(CODE_DISPLAY, '');

    for (const match of markup.matchAll(LINK_ATTR)) {
      const value = match[1] ?? match[2] ?? match[3];
      if (value === undefined) continue;

      const dead = resolveLink(value, dir, resolves);
      if (!dead) continue;

      if (!unresolved.has(dead)) unresolved.set(dead, new Set());
      unresolved.get(dead).add(id);
    }
  }

  return unresolved;
}

/**
 * Resolve site URLs against a real build output, under the flat file contract.
 * A directory is NOT a page: `/blog` must fall through to `blog.html` even
 * though `dist/blog/` exists, and `/` is never satisfied by `dist/` itself.
 * @param {string} distDir - the build output root
 * @returns {function(string): boolean}
 */
function distResolves(distDir) {
  const disk = jetpack.cwd(distDir);

  return (url) => {
    if (url === '/') return disk.exists('index.html') === 'file';

    const rel = url.replace(/^\/+/, '');
    return [rel, `${rel}.html`, path.posix.join(rel, 'index.html')]
      .some((candidate) => disk.exists(candidate) === 'file');
  };
}

/**
 * Split the unresolved links into the ones that fail and the exceptions that
 * have quietly started resolving.
 *
 * An exception excuses a link only on the pages that DECLARED it: the same dead
 * URL emitted by an undeclared page is still a failure, so a brand page cannot
 * ride on the framework's known gaps.
 *
 * @param {Map<string, Set<string>>} unresolved - from `scanLinks`
 * @param {Object<string, string[]>} exceptions - source page → its allowed dead links
 * @returns {{offenders: string[], stale: string[]}} both human-readable and sorted
 */
function applyExceptions(unresolved, exceptions) {
  const excused = (page, link) => (exceptions[page] || []).includes(link);

  const offenders = [...unresolved]
    .map(([link, pages]) => [link, [...pages].filter((page) => !excused(page, link)).sort()])
    .filter(([, pages]) => pages.length)
    .map(([link, [first, ...rest]]) => `${link} (linked from ${first}${rest.length ? ` +${rest.length} more` : ''})`)
    .sort();

  const stale = Object.entries(exceptions)
    .flatMap(([page, links]) => links
      .filter((link) => !unresolved.get(link)?.has(page))
      .map((link) => `${page} → ${link}`))
    .sort();

  return { offenders, stale };
}

/**
 * Read a target's declared link exceptions. Absent file = no exceptions, which
 * is the state every brand should be in; a malformed one is a hard error, never
 * a silently empty map (that would turn the guard off).
 * @param {string} targetRoot - the consumer project root
 * @returns {Object<string, string[]>} source page → its allowed dead links
 */
function loadLinkExceptions(targetRoot) {
  const source = jetpack.read(path.join(targetRoot, EXCEPTIONS_FILE));
  if (source === undefined) {
    // A file left at the retired strict-JSON name would silently stop
    // excusing anything — which reads as a wall of dead links with no cause.
    if (jetpack.exists(path.join(targetRoot, LEGACY_EXCEPTIONS_FILE)) === 'file') {
      throw new Error(`${LEGACY_EXCEPTIONS_FILE} is retired — rename it to ${EXCEPTIONS_FILE}, where each entry can carry its reason as a comment`);
    }

    return {};
  }

  const declared = JSON5.parse(source);

  const valid = declared
    && typeof declared === 'object'
    && !Array.isArray(declared)
    && Object.values(declared).every((links) => Array.isArray(links) && links.every((l) => typeof l === 'string'));

  if (!valid) {
    throw new Error(`${EXCEPTIONS_FILE} must be an object of "<page>.html": ["/dead-link", ...] — got ${JSON.stringify(declared)}`);
  }

  return declared;
}

/**
 * The `omega test` check: every internal link in a built dist resolves.
 * @param {object} options
 * @param {string} options.distDir - the build output root
 * @param {Object<string, string[]>} [options.exceptions] - source page → its allowed dead links
 * @returns {{pageCount: number, offenders: string[], stale: string[]}}
 */
function checkDistLinks(options) {
  const disk = jetpack.cwd(options.distDir);
  const files = disk.find({ matching: '**/*.html', files: true, directories: false }) || [];
  const pages = files.map((file) => [toPosix(file), disk.read(file)]);

  const unresolved = scanLinks(pages, { resolves: distResolves(options.distDir), dirOf: fileDir });

  return { pageCount: pages.length, ...applyExceptions(unresolved, options.exceptions || {}) };
}

module.exports = {
  checkDistLinks,
  loadLinkExceptions,
  scanLinks,
  applyExceptions,
  resolveLink,
  distResolves,
  normalize,
  pageDir,
  fileDir,
  EXTERNAL,
  LINK_ATTR,
  HTML_OUTPUT,
  CODE_DISPLAY,
  EXCEPTIONS_FILE,
  LEGACY_EXCEPTIONS_FILE,
};
