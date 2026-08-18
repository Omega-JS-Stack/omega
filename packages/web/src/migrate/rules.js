/**
 * rules.js — the executable codemod rules for `omega migrate`.
 *
 * The 8 rule classes extracted from the A2 real-file ports (DECISION.md
 * "consumer conversion plan"), plus the analytics-spelling normalization
 * (rule 9, from the omega.json5 flip), the WM → @omega.js/client rename
 * surface (rules 10–15, #248) and the classy gradient utilities classy v2
 * dropped (rule 16, #296). Every rule is a pure text → text transform over
 * ONE file: `apply(text, ctx)` returns `{ text, edits, findings }` where
 * `edits` are applied rewrites and `findings` are lint-level observations the
 * rule could NOT safely fix (surfaced by both `omega migrate` and
 * `omega migrate --check`).
 *
 * TWO tables, by file surface: RULES over the src/** templates, JS_RULES over
 * the consumer JS. Rules run in ORDER within each: page.resolved must collapse
 * before the generic page.<key> rewrite, page.canonical.url before both, and
 * the theme-prefixed include after the leading slash is gone.
 */

// Tags whose quoted args template-kit resolves as variables — the rule-3
// capture hoist is scoped to these (interpolation inside OTHER tags' quoted
// strings is a Jekyll silent no-op we only report).
const { TAGS, filters: { FILTER_NAMES } } = require('@omega.js/template-kit');

// Packaged theme ids whose hardcoded layout prefixes the engine aliases
const PACKAGED_THEMES = ['classy', 'neobrutalism', 'newsflash', 'bootstrap'];

// Eleventy's real `page` properties — page.<key> references to these are
// valid and stay; everything else is Jekyll frontmatter-through-page.
const VALID_PAGE_PROPS = [
  'url', 'date', 'fileSlug', 'filePathStem', 'inputPath', 'outputPath',
  'outputFileExtension', 'templateSyntax', 'rawInput', 'lang',
];

// Jekyll page props with NO mechanical equivalent — flagged, never rewritten
const MANUAL_PAGE_PROPS = ['next', 'previous', 'collection'];

/**
 * Split text into lines preserving the trailing-newline state.
 * @param {string} text
 * @returns {{ lines: string[], trailingNewline: boolean }}
 */
function toLines(text) {
  const trailingNewline = text.endsWith('\n');
  const lines = text.split('\n');
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

/**
 * Reassemble lines into text.
 */
function fromLines(lines, trailingNewline) {
  return lines.join('\n') + (trailingNewline ? '\n' : '');
}

/**
 * Line-by-line regex replace helper: applies `pattern` → `replacement` per
 * line and records one edit per changed line.
 * @param {string} id - rule id for the edit records
 * @param {string} text
 * @param {RegExp} pattern - must carry the g flag
 * @param {string|function} replacement
 * @returns {{ text: string, edits: object[] }}
 */
function replacePerLine(id, text, pattern, replacement) {
  const { lines, trailingNewline } = toLines(text);
  const edits = [];
  const out = lines.map((line, index) => {
    const replaced = line.replace(pattern, replacement);
    if (replaced !== line) edits.push({ rule: id, line: index + 1, before: line.trim(), after: replaced.trim() });
    return replaced;
  });
  return { text: fromLines(out, trailingNewline), edits };
}

// ---------------------------------------------------------------------------
// Rule 0 — legacy `uj_`/`uj-`/`site.uj` spellings → the `omega` names
// (runs first: every later rule matches template-kit's CURRENT tag names)
// ---------------------------------------------------------------------------

// The context-coupled filters register-liquid installs directly, so they are
// absent from FILTER_NAMES but are still part of the renamed surface.
const CONTEXT_FILTERS = ['omega_liquify', 'omega_content_format', 'omega_increment_return'];

// `uj_<name>` for every name the kit registers today — a legacy template that
// spelled something else keeps its text (it was never a template-kit call).
const LEGACY_NAMES = [...Object.keys(TAGS), ...Object.keys(FILTER_NAMES), ...CONTEXT_FILTERS]
  .map((name) => name.replace(/^omega_/, ''));

const LEGACY_CLASSES = {
  'uj-password-show': 'omega-password-show',
  'uj-password-hide': 'omega-password-hide',
  'uj-language-flag': 'omega-language-flag',
  'uj-language-dropdown': 'omega-language-dropdown',
  'data-uj-no-translate': 'data-omega-no-translate',
};

const legacyPrefix = {
  id: 'legacy-prefix',
  title: '`uj_*` tags/filters → `omega_*`; `site.uj` → `site.omega`; `uj-*` classes → `omega-*`',
  apply(text) {
    const names = new RegExp(`\\buj_(${LEGACY_NAMES.join('|')})\\b`, 'g');
    const classes = new RegExp(Object.keys(LEGACY_CLASSES).join('|'), 'g');
    const { lines, trailingNewline } = toLines(text);
    const edits = [];
    const out = lines.map((line, index) => {
      const replaced = line
        .replace(names, 'omega_$1')
        .replace(/\bsite\.uj\b/g, 'site.omega')
        .replace(/\buj-schema-/g, 'omega-schema-')
        .replace(classes, (whole) => LEGACY_CLASSES[whole]);
      if (replaced !== line) edits.push({ rule: 'legacy-prefix', line: index + 1, before: line.trim(), after: replaced.trim() });
      return replaced;
    });
    return { text: fromLines(out, trailingNewline), edits, findings: [] };
  },
};

// ---------------------------------------------------------------------------
// Rule 1 — page.resolved.* → resolved.*
// ---------------------------------------------------------------------------
const pageResolved = {
  id: 'page-resolved',
  title: '`page.resolved.` → `resolved.`',
  apply(text) {
    const { text: out, edits } = replacePerLine('page-resolved', text, /\bpage\.resolved\./g, 'resolved.');
    return { text: out, edits, findings: [] };
  },
};

// ---------------------------------------------------------------------------
// Rule 2 — bracket/hardcoded theme layout values → plain layout names
// ---------------------------------------------------------------------------
const bracketLayout = {
  id: 'bracket-layout',
  title: 'bracket theme layout values → plain layout names',
  apply(text) {
    const prefix = new RegExp(
      `themes/(?:\\[\\s*site\\.theme\\.id\\s*\\]|${PACKAGED_THEMES.join('|')})/`,
      'g'
    );
    const { lines, trailingNewline } = toLines(text);
    const edits = [];
    const out = lines.map((line, index) => {
      if (!/^\s*layout:/.test(line)) return line;
      const replaced = line.replace(prefix, '');
      if (replaced !== line) edits.push({ rule: 'bracket-layout', line: index + 1, before: line.trim(), after: replaced.trim() });
      return replaced;
    });
    return { text: fromLines(out, trailingNewline), edits, findings: [] };
  },
};

// ---------------------------------------------------------------------------
// Rule 3 — {{ … }} inside quoted template-kit tag args → {% capture %} hoist
// (upstream Jekyll silently no-ops these — live somiibo ships the bug)
// ---------------------------------------------------------------------------
const TK_TAG_NAMES = Object.keys(TAGS);

const tagArgInterpolation = {
  id: 'tag-arg-interpolation',
  title: 'interpolated quoted tag args → {% capture %} hoist',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const edits = [];
    const findings = [];
    const out = [];
    let captureCount = 0;

    const tagLine = new RegExp(`\\{%-?\\s*(${TK_TAG_NAMES.join('|')})\\b[^%]*%\\}`);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(tagLine);
      // Only interpolation INSIDE the tag span matters — {{ }} elsewhere on
      // the line is ordinary output.
      if (!match || !/\{\{[^}]*\}\}/.test(match[0])) { out.push(line); continue; }

      // Rewrite quoted args containing {{ }} INSIDE the tag span only — a
      // quoted interpolation elsewhere on the line (an HTML attribute) is
      // ordinary output and must not be touched.
      const indent = (line.match(/^\s*/) || [''])[0];
      const captures = [];
      const span = match[0];
      const rewrittenSpan = span.replace(/(["'])((?:(?!\1).)*\{\{(?:(?!\1).)*)\1/g, (whole, quote, inner) => {
        // Only hoist when the quoted string actually interpolates
        if (!/\{\{.*\}\}/.test(inner)) return whole;
        captureCount += 1;
        const varName = `omega_migrate_arg_${captureCount}`;
        captures.push(`${indent}{% capture ${varName} %}${inner}{% endcapture %}`);
        return varName;
      });
      const rewritten = line.replace(span, rewrittenSpan);

      if (captures.length === 0) {
        // {{ }} on a tk-tag line but outside its quoted args — report only
        findings.push({
          check: 'tag-arg-interpolation', line: i + 1, severity: 'warning',
          message: `\`{{ }}\` near {% ${match[1]} %} but not in a quoted arg — verify manually`,
        });
        out.push(line);
        continue;
      }

      for (const capture of captures) out.push(capture);
      edits.push({ rule: 'tag-arg-interpolation', line: i + 1, before: line.trim(), after: rewritten.trim() });
      out.push(rewritten);
    }
    return { text: fromLines(out, trailingNewline), edits, findings };
  },
};

// ---------------------------------------------------------------------------
// Rule 4 — forloop.parentloop.* → hoisted {% assign %} after the parent for
// (LiquidJS has no parentloop — upstream these render empty)
// ---------------------------------------------------------------------------
const PARENTLOOP_PROPS = ['index', 'index0', 'first', 'last', 'length', 'rindex', 'rindex0'];

const LOOP_TOKEN = /\{%-?\s*(for\s+\w+\s+in|endfor|raw|endraw|comment|endcomment)\b/g;

/**
 * Walk one line's loop-structure tokens in order, updating the open-for stack
 * (line indexes) and the inert-span flag. Returns how many tokens touched the
 * for stack (0 = the line is structure-neutral).
 */
function trackLoopTokens(line, lineIndex, forStack, state) {
  let structural = 0;
  for (const [, token] of line.matchAll(LOOP_TOKEN)) {
    if (token === 'raw' || token === 'comment') { state.inert += 1; continue; }
    if (token === 'endraw' || token === 'endcomment') { state.inert = Math.max(0, state.inert - 1); continue; }
    if (state.inert > 0) continue;
    if (token === 'endfor') { if (forStack.length) forStack.pop(); structural += 1; continue; }
    forStack.push(lineIndex);
    structural += 1;
  }
  return structural;
}

const parentloop = {
  id: 'parentloop',
  title: '`forloop.parentloop.*` → hoisted parent-loop {% assign %}',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const edits = [];
    const findings = [];

    // Pass 1: locate for/endfor nesting (token-order aware — a line may open
    // or close several loops) and decide which parent-for lines need which
    // props hoisted. forStack holds line indexes of open {% for %}s.
    const forStack = [];
    const state = { inert: 0 };
    const hoists = new Map(); // parent for-line index → Set of props
    const lineRewrites = new Map(); // ref line index → depth of its parent for

    const flag = (line, message) => findings.push({ check: 'parentloop', line, severity: 'error', message });

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hasRef = state.inert === 0 && /forloop\.parentloop\./.test(line);

      if (hasRef && /forloop\.parentloop\.parentloop/.test(line)) {
        flag(i + 1, 'multi-level `forloop.parentloop.parentloop` — hoist manually');
      } else if (hasRef && /\{%-?\s*(?:for\s+\w+\s+in|endfor)\b/.test(line)) {
        // A ref sharing its line with for/endfor tokens is ambiguous — the
        // stack state at the ref position is not the line-start state.
        flag(i + 1, '`forloop.parentloop` on the same line as a loop open/close — hoist manually');
      } else if (hasRef) {
        if (forStack.length < 2) {
          flag(i + 1, '`forloop.parentloop` outside a nested loop — remove or hoist manually');
        } else if (forStack[forStack.length - 1] === forStack[forStack.length - 2]) {
          // Parent and inner for share a line: an assign inserted after that
          // line would land INSIDE the inner loop and read the wrong forloop.
          flag(i + 1, 'parent and inner `{% for %}` share a line — hoist manually');
        } else {
          const parentForLine = forStack[forStack.length - 2];
          const parentDepth = forStack.length - 1; // 1-based depth of the parent
          const props = hoists.get(parentForLine) || new Set();
          for (const [, prop] of line.matchAll(/forloop\.parentloop\.(\w+)/g)) {
            if (PARENTLOOP_PROPS.includes(prop)) props.add(prop);
            else flag(i + 1, `unknown parentloop property \`${prop}\` — hoist manually`);
          }
          hoists.set(parentForLine, props);
          lineRewrites.set(i, parentDepth);
        }
      }

      trackLoopTokens(line, i, forStack, state);
    }

    if (hoists.size === 0) return { text, edits, findings };

    // Pass 2: emit — insert assigns right after each parent for-line (that
    // line ends in the parent loop's scope: were an unclosed inner loop open
    // there, pass 1 flagged the ref instead), and rewrite references with
    // depth-scoped names (omega_parentloop<depth>_<prop>) so nested hoists
    // never shadow each other.
    const depthByFor = new Map();
    {
      const stack = [];
      const rescanState = { inert: 0 };
      for (let i = 0; i < lines.length; i++) {
        trackLoopTokens(lines[i], i, stack, rescanState);
        if (stack.length && stack[stack.length - 1] === i) depthByFor.set(i, stack.length);
      }
    }

    const out = [];
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (lineRewrites.has(i)) {
        const depth = lineRewrites.get(i);
        const rewritten = line.replace(/forloop\.parentloop\.(\w+)/g, (whole, prop) =>
          PARENTLOOP_PROPS.includes(prop) ? `omega_parentloop${depth}_${prop}` : whole);
        if (rewritten !== line) {
          edits.push({ rule: 'parentloop', line: i + 1, before: line.trim(), after: rewritten.trim() });
          line = rewritten;
        }
      }
      out.push(line);
      if (hoists.has(i)) {
        const indent = (lines[i].match(/^\s*/) || [''])[0];
        const depth = depthByFor.get(i);
        for (const prop of hoists.get(i)) {
          out.push(`${indent}  {% assign omega_parentloop${depth}_${prop} = forloop.${prop} %}`);
          edits.push({ rule: 'parentloop', line: i + 1, before: '(parent loop)', after: `{% assign omega_parentloop${depth}_${prop} = forloop.${prop} %}` });
        }
      }
    }
    return { text: fromLines(out, trailingNewline), edits, findings };
  },
};

// ---------------------------------------------------------------------------
// Rule 5 — strip leading slash from include paths
// ---------------------------------------------------------------------------
const includeSlash = {
  id: 'include-slash',
  title: 'strip leading `/` from include paths',
  apply(text) {
    const { text: out, edits } = replacePerLine('include-slash', text, /(\{%-?\s*include(?:_cached)?\s+)\//g, '$1');
    return { text: out, edits, findings: [] };
  },
};

// ---------------------------------------------------------------------------
// Rule 7 (before 6) — page.canonical.url → {{ site.url }}{{ page.url }}
// ---------------------------------------------------------------------------
const canonicalUrl = {
  id: 'canonical-url',
  title: '`page.canonical.url` → `{{ site.url }}{{ page.url }}`',
  apply(text) {
    const { text: replaced, edits } = replacePerLine(
      'canonical-url', text,
      /\{\{\s*page\.canonical\.url\s*\}\}/g,
      '{{ site.url }}{{ page.url }}'
    );
    const findings = [];
    const { lines } = toLines(replaced);
    lines.forEach((line, index) => {
      if (/page\.canonical/.test(line)) {
        findings.push({
          check: 'canonical-url', line: index + 1, severity: 'error',
          message: '`page.canonical` outside a plain output — rewrite to `site.url`/`page.url` manually',
        });
      }
    });
    return { text: replaced, edits, findings };
  },
};

// ---------------------------------------------------------------------------
// Rule 6 — page.<key> Jekyll frontmatter reads → top-level keys
// ---------------------------------------------------------------------------
const pageProps = {
  id: 'page-props',
  title: '`page.<frontmatterKey>` → `<key>`; `page.content` → `content`; `page.slug` → `page.fileSlug`',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const edits = [];
    const findings = [];
    // The lookbehind keeps `page.` out of larger words and paths —
    // `words-on-a-page.png`, `/landing-page.html`, `data.page.url` are NOT
    // page-object references.
    const out = lines.map((line, index) => {
      let replaced = line
        .replace(/(?<![\w./-])page\.content\b/g, 'content')
        .replace(/(?<![\w./-])page\.slug\b/g, 'page.fileSlug');
      replaced = replaced.replace(/(?<![\w./-])page\.([A-Za-z_][\w]*)\b/g, (whole, key) => {
        if (VALID_PAGE_PROPS.includes(key)) return whole;
        if (MANUAL_PAGE_PROPS.includes(key)) {
          findings.push({
            check: 'page-props', line: index + 1, severity: 'error',
            message: `\`page.${key}\` has no mechanical equivalent — port manually (collections API)`,
          });
          return whole;
        }
        return key;
      });
      if (replaced !== line) edits.push({ rule: 'page-props', line: index + 1, before: line.trim(), after: replaced.trim() });
      return replaced;
    });
    return { text: fromLines(out, trailingNewline), edits, findings };
  },
};

// ---------------------------------------------------------------------------
// Rule 9 — flat analytics spellings → providers shape
// ---------------------------------------------------------------------------
const analyticsShape = {
  id: 'analytics-shape',
  title: '`site.analytics.<provider>` → `site.analytics.providers.<provider>.id`',
  apply(text) {
    const { text: out, edits } = replacePerLine(
      'analytics-shape', text,
      /\b(site|resolved)\.analytics\.(google|meta|tiktok)\b(?!\.)/g,
      '$1.analytics.providers.$2.id'
    );
    return { text: out, edits, findings: [] };
  },
};

// Rule 8 (Jekyll defaults/collections → targets.web) lives in config-convert.js
// — it moves config, not template text.

// ---------------------------------------------------------------------------
// Rules 10–15 — the WM → @omega.js/client rename surface
// ([#248](https://github.com/Omega-JS-Stack/omega/issues/248))
//
// Every UJM consumer carries it (~40 sites in one brand). The markup pair is
// the dangerous half: nothing fails at BUILD time, the bindings and the
// sign-out button simply go dead at runtime. The markup rule therefore runs
// over templates AND consumer JS (a querySelector spells the same class); the
// import rules are JS-only (JS_RULES) and the frontmatter/include rules
// template-only.
// ---------------------------------------------------------------------------

// Rule 10 — the client-runtime markup hooks, renamed with the runtime (#16)
const CLIENT_MARKUP = {
  'data-wm-bind': 'data-omega-bind',
  'auth-signout-btn': 'omega-signout',
};

const clientMarkup = {
  id: 'client-markup',
  title: '`data-wm-bind` → `data-omega-bind`; `auth-signout-btn` → `omega-signout`',
  apply(text) {
    // Both ends are guarded against `-` and word chars: a class list and an
    // attribute name are hyphenated namespaces, so a bare alternation would
    // eat `js-auth-signout-btn` and `auth-signout-btn-large` — consumer names
    // that are DIFFERENT hooks and must survive untouched.
    const pattern = new RegExp(`(?<![\\w-])(?:${Object.keys(CLIENT_MARKUP).join('|')})(?![\\w-])`, 'g');
    const { text: out, edits } = replacePerLine('client-markup', text, pattern, (whole) => CLIENT_MARKUP[whole]);
    return { text: out, edits, findings: [] };
  },
};

// ---------------------------------------------------------------------------
// Rule 11 — frontmatter `web_manager:` → `client:` (#1: it configures
// @omega.js/client, and there is no dual-read)
// ---------------------------------------------------------------------------
const clientFrontmatter = {
  id: 'client-frontmatter',
  title: 'frontmatter `web_manager:` → `client:`',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    // Scoped to the leading `---` fence: a `web_manager:` in the body is prose
    // or data, never the client-config key.
    const fenceEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
    if (fenceEnd < 0) return { text, edits: [], findings: [] };

    const edits = [];
    const out = lines.map((line, index) => {
      if (index === 0 || index >= fenceEnd) return line;
      const replaced = line.replace(/^web_manager:/, 'client:');
      if (replaced !== line) edits.push({ rule: 'client-frontmatter', line: index + 1, before: line.trim(), after: replaced.trim() });
      return replaced;
    });
    return { text: fromLines(out, trailingNewline), edits, findings: [] };
  },
};

// ---------------------------------------------------------------------------
// Rule 12 — theme-prefixed include paths → the plain layered path
// (runs AFTER include-slash, which owns the leading `/`)
// ---------------------------------------------------------------------------
const includeThemePath = {
  id: 'include-theme-path',
  title: '`{% include themes/<id>/… %}` → the layered include path',
  apply(text) {
    const pattern = new RegExp(
      `(\\{%-?\\s*include(?:_cached)?\\s+)themes/(?:\\[\\s*site\\.theme\\.id\\s*\\]|${PACKAGED_THEMES.join('|')})/`,
      'g'
    );
    const { text: out, edits } = replacePerLine('include-theme-path', text, pattern, '$1');
    return { text: out, edits, findings: [] };
  },
};

// ---------------------------------------------------------------------------
// Rule 13 — the web-manager package + its singleton identifier
// (WebManager is not an OMEGA concept: the package is @omega.js/client and the
// singleton is `omega`, subpath modules included)
// ---------------------------------------------------------------------------
const clientImport = {
  id: 'client-import',
  title: "`'web-manager'` → `'@omega.js/client'`; the `webManager` singleton → `omega`",
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const edits = [];
    const out = lines.map((line, index) => {
      const replaced = line
        .replace(/(["'])web-manager(\/[^"']*)?\1/g, (whole, quote, subpath) => `${quote}@omega.js/client${subpath || ''}${quote}`)
        .replace(/\bwebManager\b/g, 'omega');
      if (replaced !== line) edits.push({ rule: 'client-import', line: index + 1, before: line.trim(), after: replaced.trim() });
      return replaced;
    });
    return { text: fromLines(out, trailingNewline), edits, findings: [] };
  },
};

// ---------------------------------------------------------------------------
// Rule 14 — the `__main_assets__/js/libs/*` runtime libs
//
// form-manager MOVED (same class, new home). authorized-fetch did not: its
// successor is the singleton's own `omega.request()`, so the import line goes
// and the calls are renamed — but the OPTIONS are the client's, not
// wonderful-fetch's, so every rewritten call is reported for review.
// ---------------------------------------------------------------------------
const FORM_MANAGER_SPECIFIER = /(["'])__main_assets__\/js\/libs\/form-manager\.js\1/g;
const AUTHORIZED_FETCH_IMPORT = /^\s*import\s+[\w{},\s*]+\s+from\s+["']__main_assets__\/js\/libs\/authorized-fetch\.js["'];?\s*$/;
const CLIENT_DEFAULT_IMPORT = /import\s+omega\s+from\s+["']@omega\.js\/client["']/;

const clientLibs = {
  id: 'client-libs',
  title: '`__main_assets__/js/libs/form-manager.js` → the client module; `authorizedFetch()` → `omega.request()`',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const edits = [];
    const findings = [];
    const out = [];
    let rewroteCall = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (AUTHORIZED_FETCH_IMPORT.test(line)) {
        edits.push({ rule: 'client-libs', line: i + 1, before: line.trim(), after: '(removed — omega.request() replaces it)' });
        continue;
      }

      const replaced = line
        .replace(FORM_MANAGER_SPECIFIER, '$1@omega.js/client/modules/form-manager.js$1')
        .replace(/\bauthorizedFetch\(/g, 'omega.request(');
      if (replaced !== line) {
        edits.push({ rule: 'client-libs', line: i + 1, before: line.trim(), after: replaced.trim() });
        if (/\bauthorizedFetch\(/.test(line)) {
          rewroteCall = true;
          findings.push({
            check: 'client-libs', line: i + 1, severity: 'warning',
            message: '`authorizedFetch(…)` → `omega.request(…)`: same (url, options) shape and the same Bearer attach, but the options are @omega.js/client\'s — verify `response`/`output` and the route segment (`/backend-manager/` is now `/omega/`)',
          });
        }
      }
      out.push(replaced);
    }

    // `omega.request()` needs the singleton in scope. Every real consumer that
    // called authorizedFetch also imported web-manager (rule 13 renames that
    // import ahead of this one), so a miss here is a genuinely odd file — say
    // so rather than emit a module that throws on first call.
    const result = fromLines(out, trailingNewline);
    if (rewroteCall && !CLIENT_DEFAULT_IMPORT.test(result)) {
      findings.push({
        check: 'client-libs', line: 1, severity: 'error',
        message: 'rewrote `authorizedFetch()` to `omega.request()` but the file has no client singleton — add `import omega from \'@omega.js/client\';`',
      });
    }

    return { text: result, edits, findings };
  },
};

// ---------------------------------------------------------------------------
// Rule 15 — the service-worker entry's framework import
// (only the /service-worker subpath: the bare `ultimate-jekyll-manager` import
// is the asset layer's main.js, owned by consumer-assets.js)
// ---------------------------------------------------------------------------
const serviceWorkerImport = {
  id: 'service-worker-import',
  title: "`'ultimate-jekyll-manager/service-worker'` → `'@omega.js/web/service-worker'`",
  apply(text) {
    const { text: out, edits } = replacePerLine(
      'service-worker-import', text,
      /(["'])ultimate-jekyll-manager\/service-worker\1/g,
      '$1@omega.js/web/service-worker$1'
    );
    return { text: out, edits, findings: [] };
  },
};

// ---------------------------------------------------------------------------
// Rule 16 — the legacy classy gradient utilities → the v2 dotgrid hero
// ([#296](https://github.com/Omega-JS-Stack/omega/issues/296))
//
// UJM-era heroes wear `.gradient-animated` (a 5s shimmer over the gradient
// background) and `.gradient-grain` (a ::before noise overlay). Classy v2
// ships NEITHER — its binding constraint is zero gradients (classy-v2
// DIRECTION.md) — so those classes silently do nothing on a ported page.
// The conversion is once, here: v2's Marketing DNA puts a "subtle dotted grid
// (masked)" behind every hero, and that is `.omega-dotgrid`
// (themes/classy/css/base/_utilities.scss) — the same shape the grain had, a
// masked ::before backdrop with the content lifted above it. The animated
// half becomes the dotgrid's LIVE canvas, opted in per element with
// `data-omega-dotfield` exactly as every packaged hero authors the pair. Both
// classes on one element collapse to ONE `omega-dotgrid`.
//
// `.bg-gradient-*` is NOT in scope: v2 deliberately keeps those names,
// neutralized to flat token paint for straggler markup.
// ---------------------------------------------------------------------------
const LEGACY_GRADIENT_CLASSES = /(?<![\w-])gradient-(?:animated|grain)(?![\w-])/g;
const GRADIENT_ANIMATED = /(?<![\w-])gradient-animated(?![\w-])/;
const DOTGRID_CLASS = /(?<![\w-])omega-dotgrid(?![\w-])/;
// Each occurrence with the whitespace ahead of it — dropping a duplicate takes
// its separator along instead of leaving a double space in the class list.
const DOTGRID_OCCURRENCE = /\s*(?<![\w-])omega-dotgrid(?![\w-])/g;
const CLASS_ATTRIBUTE = /class\s*=\s*(["'])([^"']*)\1/g;
const LIQUID_VALUE = /\{[{%]/;

const gradientUtilities = {
  id: 'gradient-utilities',
  title: '`gradient-animated`/`gradient-grain` → `omega-dotgrid` (+ `data-omega-dotfield` for the motion)',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const edits = [];
    const out = lines.map((line, index) => {
      let replaced = line.replace(LEGACY_GRADIENT_CLASSES, 'omega-dotgrid');
      if (replaced === line) return line;

      replaced = replaced.replace(CLASS_ATTRIBUTE, (whole, quote, value) => {
        // A class list Liquid assembles may emit its dotgrid conditionally —
        // there a "duplicate" is the only class the other branch has, so the
        // literal duplicate (harmless in a class attribute) stays.
        if (LIQUID_VALUE.test(value)) return whole;
        let kept = false;
        const collapsed = value.replace(DOTGRID_OCCURRENCE, (occurrence) => {
          if (kept) return '';
          kept = true;
          return occurrence;
        });
        return `class=${quote}${collapsed}${quote}`;
      });

      // The live canvas rides the element that carries the class — and only
      // when the page asked for motion in the first place.
      if (GRADIENT_ANIMATED.test(line) && !/data-omega-dotfield/.test(replaced)) {
        replaced = replaced.replace(CLASS_ATTRIBUTE, (whole, quote, value) =>
          (DOTGRID_CLASS.test(value) ? `${whole} data-omega-dotfield` : whole));
      }

      edits.push({ rule: 'gradient-utilities', line: index + 1, before: line.trim(), after: replaced.trim() });
      return replaced;
    });
    return { text: fromLines(out, trailingNewline), edits, findings: [] };
  },
};

const RULES = [
  legacyPrefix,        // 0 — must precede every rule that matches tag names
  pageResolved,        // 1
  bracketLayout,       // 2
  tagArgInterpolation, // 3
  parentloop,          // 4
  includeSlash,        // 5
  canonicalUrl,        // 7 — must precede page-props
  pageProps,           // 6
  analyticsShape,      // 9
  clientMarkup,        // 10
  clientFrontmatter,   // 11
  includeThemePath,    // 12 — must follow include-slash
  gradientUtilities,   // 16
];

// The consumer-JS table (src/**/*.js — the tree the template walk skips).
// Template rules never run over JS: `page.title` in a script is an object
// property, not a Jekyll frontmatter read.
const JS_RULES = [
  clientMarkup,        // 10 — the same class/attribute names, spelled in JS
  clientImport,        // 13 — must precede client-libs (it puts `omega` in scope)
  clientLibs,          // 14
  serviceWorkerImport, // 15
];

// The section-descriptor table (src/**/*.json — bindings and classes declared
// as DATA, not markup). Only the markup rename belongs here: the page-props,
// include and frontmatter rules answer to template text, and a `page.`-looking
// string in a descriptor is a JSON value, not a Jekyll read.
const JSON_RULES = [
  clientMarkup,        // 10 — the same class/attribute names, spelled in a descriptor
];

module.exports = { RULES, JS_RULES, JSON_RULES, VALID_PAGE_PROPS, MANUAL_PAGE_PROPS, PACKAGED_THEMES };
