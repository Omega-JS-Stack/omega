/**
 * Production HTML minification — the UJM minifyHtml successor, as an
 * Eleventy transform (engine.js mounts it for production builds only; dev
 * and the test harness ship readable HTML). The Rust minifier
 * (@minify-html/node) does the heavy lifting; three content classes are
 * extracted first and restored after, exactly the legacy dance:
 *
 *   1. JSON-LD scripts — minified as JSON (parse → stringify; unparseable
 *      blocks pass through verbatim), because the HTML minifier can mangle
 *      structured data.
 *   2. Inline scripts (no src, not JSON-LD) — minified with esbuild
 *      (already a dependency; legacy used terser because minify-html's
 *      built-in JS minifier was buggy — it stays off here too). A script
 *      esbuild can't parse ships verbatim.
 *   3. IE conditional comments — keep_comments is off, which would strip
 *      them; they're restored verbatim (head.html still carries one).
 *
 * Ordinary comments go FIRST, before any of that, scanning left to right:
 * a `<script` mentioned inside a comment is comment text, and a `<!--` inside
 * a script body is script text. The extraction regexes alone could not tell
 * (#762: a head comment saying "plain <script src> fetches" was read as a
 * script running to the motion stamp's `</script>`, the comment's `-->` went
 * with it, and the minifier ate every tag up to the next comment close).
 *
 * A page that fails to minify ships unminified — never a failed build. A
 * placeholder the minifier lost counts as a failure: the page ships whole.
 */
const { minify } = require('@minify-html/node');
const esbuild = require('esbuild');

// UJM's proven option set. minify_js stays OFF: inline scripts are
// extracted and esbuild-minified instead (minify-html's JS pass is buggy).
const MINIFY_OPTIONS = {
  keep_closing_tags: false,
  keep_comments: false,
  keep_html_and_head_opening_tags: false,
  keep_spaces_between_attributes: false,
  keep_ssi_comments: false,
  minify_css: true,
  minify_js: false,
  remove_bangs: false,
  remove_processing_instructions: false,
};

const JSON_LD_REGEX = /<script[^>]*type=(?:["']?application\/ld\+json["']?)[^>]*>([\s\S]*?)<\/script>/gi;
// Inline scripts only: no src attribute, not JSON-LD (already extracted)
const INLINE_SCRIPT_REGEX = /<script(?![^>]*type=(?:["']?application\/ld\+json["']?))(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
const CONDITIONAL_COMMENT_REGEX = /<!--\[if[\s\S]*?<!\[endif\]-->/gi;
// One left-to-right scan: whichever of a comment, a script or a style starts
// first owns everything up to its own close. Conditional comments are not
// ordinary comments (the lookahead leaves them for step 3).
const COMMENT_OR_RAW_TEXT_REGEX = /<!--(?!\[if)[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi;

/**
 * Drop every ordinary HTML comment, leaving script and style bodies alone.
 * @param {string} html
 * @returns {string}
 */
function stripComments(html) {
  return html.replace(COMMENT_OR_RAW_TEXT_REGEX, (match) => (match.startsWith('<!--') ? '' : match));
}

/**
 * Replace every regex match with an indexed placeholder token.
 * @param {string} html
 * @param {RegExp} regex
 * @param {string} token - placeholder stem, e.g. 'JSON_LD'
 * @param {function} capture - (match, ...groups) → string stored for restore
 * @returns {{ content: string, extracted: string[] }}
 */
function extract(html, regex, token, capture) {
  const extracted = [];
  const content = html.replace(regex, (...args) => {
    extracted.push(capture(...args));
    return `__OMEGA_${token}_${extracted.length - 1}__`;
  });
  return { content, extracted };
}

/**
 * Swap placeholder tokens back for their stored strings.
 * @param {string} html
 * @param {string} token
 * @param {string[]} extracted
 * @returns {string}
 */
function restore(html, token, extracted) {
  return extracted.reduce((content, block, index) => {
    const placeholder = `__OMEGA_${token}_${index}__`;
    if (!content.includes(placeholder)) {
      // The minifier ate the placeholder (a comment or raw-text context we
      // failed to see swallowed it), so the page cannot be trusted: throw, and
      // minifyHtml() ships it unminified rather than truncated (#762)
      throw new Error(`minify-html lost ${placeholder}`);
    }
    return content.replace(placeholder, () => block);
  }, html);
}

/**
 * Minify one rendered HTML page. Synchronous — mounted directly as an
 * Eleventy transform.
 * @param {string} html
 * @returns {string} minified page (or the input verbatim if minification throws)
 */
function minifyHtml(html) {
  try {
    // 0. Ordinary comments out for good (keep_comments is off anyway), so no
    //    extraction below can match markup a comment merely talks about
    const stripped = stripComments(html);

    // 1. JSON-LD out (minified as JSON, not HTML)
    const jsonLd = extract(stripped, JSON_LD_REGEX, 'JSON_LD', (match, body) => {
      try {
        return `<script type=application/ld+json>${JSON.stringify(JSON.parse(body))}</script>`;
      } catch (error) {
        return match;
      }
    });

    // 2. Inline scripts out (esbuild-minified; attributes preserved)
    const scripts = extract(jsonLd.content, INLINE_SCRIPT_REGEX, 'SCRIPT', (match, attrs, body) => {
      if (!body.trim()) {
        return match;
      }
      try {
        const minified = esbuild.transformSync(body, { minify: true }).code.trimEnd();
        return `<script${attrs}>${minified}</script>`;
      } catch (error) {
        return match;
      }
    });

    // 3. IE conditional comments out (keep_comments: false would eat them)
    const conditionals = extract(scripts.content, CONDITIONAL_COMMENT_REGEX, 'IE_COMMENT', (match) => match);

    let minified = minify(Buffer.from(conditionals.content), MINIFY_OPTIONS).toString();

    minified = restore(minified, 'IE_COMMENT', conditionals.extracted);
    minified = restore(minified, 'SCRIPT', scripts.extracted);
    minified = restore(minified, 'JSON_LD', jsonLd.extracted);
    return minified;
  } catch (error) {
    return html;
  }
}

module.exports = { minifyHtml };
