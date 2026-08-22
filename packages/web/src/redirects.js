/**
 * Path redirects (#442) — `targets.web.redirects`, the consumer surface for a
 * redirect that CAPTURES a path segment:
 *
 *   targets.web.redirects: [
 *     { from: '/c/:id', to: '/code?id=:id' },        // 301 by default
 *     { from: '/legacy-pricing', to: '/pricing', type: 302 },
 *   ]
 *
 * The redirect PAGE lane (`modules/utilities/redirect`) bakes a fixed target
 * per page, so it can only serve URLs that can be enumerated — and the ids on
 * DashQR's printed QR codes never can be. A deploy publishes `dist/` to
 * gh-pages, where the only hook an unbuilt path gives us is the 404 page the
 * host serves for it: the map is materialized THERE, and the redirect is
 * consequently client-side, not a true 301 (docs/web/index.md says so where
 * the feature is documented). `omega dev` serves the same map as a real
 * status-code redirect.
 *
 * The pattern engine lives HERE and nowhere else: every entry compiles to a
 * regex source + a replacement string, so both runtimes — the browser module
 * and the dev middleware — only ever `path.replace(new RegExp(pattern),
 * target)`. Nothing downstream parses `:name` again.
 */

// One `from` segment is either a literal or a single `:name` capture. The
// literal set is the URL-path characters a static host actually serves.
const LITERAL_SEGMENT = /^[A-Za-z0-9._~%+-]+$/;
const CAPTURE_SEGMENT = /^:([A-Za-z][A-Za-z0-9_]*)$/;

// A `:name` reference inside `to` — only where a captured value can legitimately
// sit: at the start, or right after a path/query/fragment boundary. A colon
// mid-word ("/search?ref:info") is the destination's own text, not a reference.
const TO_REFERENCE = /(?<=^|[/?&=#]):([A-Za-z][A-Za-z0-9_]*)/g;

// The keys an entry may carry — anything else is a typo, and a typo'd `type`
// would silently ship the default.
const ENTRY_KEYS = ['from', 'to', 'type'];

// The redirect statuses a host can answer with. `type` is the DEV server's
// status code and the documented intent; static hosting can only ever perform
// the hop client-side.
const TYPES = [301, 302, 307, 308];

/**
 * Escape a literal for use inside a RegExp source.
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

/**
 * Read and validate the `redirects` config block, compiling each entry. Every
 * problem is an ERROR: a redirect that silently fails to register is a live
 * 404 on a URL that is already printed on something.
 * @param {Array} [config] - the raw targets.web.redirects value
 * @returns {Array<{ from: string, to: string, type: number, pattern: string, target: string }>}
 * @throws {Error} on a bad shape, an unusable pattern, or an unmatched reference
 */
function readRedirects(config) {
  if (config === undefined || config === null) return [];

  if (!Array.isArray(config)) {
    throw new Error(
      `targets.web.redirects must be a list of { from, to, type } entries — got ${typeof config}`,
    );
  }

  const entries = config.map((value, index) => readRedirect(value, index));

  // First match wins, so a later entry an earlier one already answers can only
  // ever be dead config.
  entries.forEach((entry, index) => {
    const shadow = entries.findIndex((other, otherIndex) => otherIndex < index && new RegExp(other.pattern).test(exampleUrl(entry)));
    if (shadow !== -1) {
      throw new Error(
        `targets.web.redirects[${index}].from "${entry.from}" already matches redirects[${shadow}] "${entries[shadow].from}" `
        + `— entries are ordered and the first match wins, so this one can never answer`,
      );
    }
  });

  return entries;
}

/**
 * A concrete URL an entry's own pattern matches — what the shadow check asks
 * earlier entries about.
 * @param {object} entry - a compiled entry
 * @returns {string}
 */
function exampleUrl(entry) {
  return entry.from.replace(TO_REFERENCE, 'x');
}

/**
 * Read and compile one entry.
 * @param {object} value - the raw entry
 * @param {number} index - its position in the list (names it in every error)
 * @returns {object} the compiled entry
 */
function readRedirect(value, index) {
  const at = `targets.web.redirects[${index}]`;

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${at} must be a { from, to, type } entry — got ${Array.isArray(value) ? 'array' : typeof value}`);
  }

  const unknown = Object.keys(value).find((key) => !ENTRY_KEYS.includes(key));
  if (unknown) {
    throw new Error(`${at} has an unknown key "${unknown}" — an entry carries from, to and type`);
  }

  if (typeof value.from !== 'string' || !value.from.startsWith('/') || value.from === '/') {
    throw new Error(`${at}.from must be a path starting with "/" — the request path this entry answers (e.g. "/c/:id")`);
  }
  if (typeof value.to !== 'string' || !(value.to.startsWith('/') || /^https?:\/\//.test(value.to))) {
    throw new Error(
      `${at}.to must be a path or an absolute URL — got ${typeof value.to === 'string' ? `"${value.to}"` : typeof value.to}`,
    );
  }

  const type = value.type === undefined ? 301 : value.type;
  if (!TYPES.includes(type)) {
    throw new Error(`${at}.type must be 301, 302, 307 or 308 — got ${typeof type === 'string' ? `"${type}"` : type}`);
  }

  const { pattern, captured } = compileFrom(value.from, at);
  const target = compileTo(value.to, value.from, captured, at);

  return { from: value.from, to: value.to, type, pattern, target };
}

/**
 * Compile `from` into an anchored RegExp source. A trailing slash matches the
 * same request — the site's own URLs are slash-free, and a visitor's copy
 * of one may not be.
 * @param {string} from
 * @param {string} at - the error prefix
 * @returns {{ pattern: string, captured: string }} the source + the captured name ('' when exact)
 */
function compileFrom(from, at) {
  const segments = from.slice(1).split('/');
  const names = [];

  const parts = segments.map((segment) => {
    const capture = segment.match(CAPTURE_SEGMENT);
    if (capture) {
      names.push(capture[1]);
      return '([^/]+)';
    }
    if (!LITERAL_SEGMENT.test(segment)) {
      throw new Error(
        `${at}.from has an unusable segment "${segment}" — a segment is a literal path segment or ONE ":name" capture`,
      );
    }
    return escapeRegExp(segment);
  });

  // Static hosting resolves nothing itself: the browser gets ONE regex and one
  // replacement, so a second capture would have nowhere honest to go.
  if (names.length > 1) {
    throw new Error(`${at}.from captures ${names.length} segments — one :name segment per entry`);
  }

  return { pattern: `^/${parts.join('/')}/?$`, captured: names[0] || '' };
}

/**
 * Compile `to` into the replacement string the runtimes apply: the captured
 * segment becomes `$1`, and every literal `$` is escaped so it stays literal.
 * @param {string} to
 * @param {string} from - named in the error when a reference has no capture
 * @param {string} captured - the name `from` captures ('' when exact)
 * @param {string} at - the error prefix
 * @returns {string}
 */
function compileTo(to, from, captured, at) {
  return to.replace(/\$/g, '$$$$').replace(TO_REFERENCE, (match, name) => {
    if (name !== captured) {
      throw new Error(`${at}.to references :${name}, which ${from} does not capture`);
    }
    return '$1';
  });
}

/**
 * The map the built 404 page carries on `#omega-redirect-map[data-redirects]`
 * — pattern + target only, the two things the browser applies. The layout
 * escapes it into the attribute (the sibling redirect module's own idiom); an
 * inline `application/json` script would not survive the production minify
 * pass, which esbuild-minifies every inline script and drops a bare JSON blob
 * as a side-effect-free expression.
 * @param {Array<object>} entries - readRedirects output
 * @returns {string} JSON, or '' when there is nothing to match
 */
function redirectMap(entries) {
  if (!entries.length) return '';

  return JSON.stringify(entries.map(({ pattern, target }) => ({ pattern, target })));
}

module.exports = { readRedirects, redirectMap };
