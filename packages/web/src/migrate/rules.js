/**
 * rules.js — the executable codemod rules for `omega migrate`.
 *
 * The 8 rule classes extracted from the A2 real-file ports (DECISION.md
 * "consumer conversion plan"), plus the analytics-spelling normalization
 * (rule 9, from the omega.json5 flip), the WM → @omega.js/client rename
 * surface (rules 10–15, #248), the classy gradient utilities classy v2
 * dropped (rule 16, #296) and the dead `asset_path` frontmatter key (rule 17,
 * #470). Every rule is a pure text → text transform over
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

// The config namespace (#607): a page's frontmatter overrides omega.json5
// under `config:`, and nothing that is not a config section may sit there.
const {
  CONFIG_SECTIONS, RANDOM_ID_ASSIGN_IDIOM,
  templateReads, randomIdReads, assignsRandomId,
} = require('../config-sections.js');

/** Does this bare frontmatter key belong under `config:`? */
const isMovableSection = (key) => CONFIG_SECTIONS.has(key);

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
// Rule 27 — the icon TAG → native Font Awesome markup (#619)
//
// Icons are not a tag any more, on either side of the rename: authoring is
// `<i class="fa-solid fa-rocket">`, which the build inlines and the runtime
// watcher upgrades. So a legacy `{% uj_icon %}` (and an already-half-migrated
// `{% omega_icon %}`) converts to markup, never to a tag that no longer
// exists. Runs FIRST — before the uj_→omega_ rename and before the tag-arg
// hoist, both of which would otherwise treat it as a live tag.
//
// The name arg becomes the `fa-<name>` class (a Liquid variable interpolates
// into it), the positional class arg rides along verbatim, and the weight is
// always `fa-solid`: the icon lookup falls back to `brands/` for any weight,
// so a brand name resolves without the converter knowing the icon set.
// ---------------------------------------------------------------------------
const ICON_TAG_PATTERN = /\{%-?\s*(?:uj|omega)_icon\s*([^%]*?)-?%\}/g;

const iconTagMarkup = {
  id: 'icon-tag-markup',
  title: '`uj_icon`/`omega_icon` tags → native Font Awesome markup',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const edits = [];
    const out = lines.map((line, index) => {
      const replaced = line.replace(ICON_TAG_PATTERN, (whole, markup) => {
        const args = splitTagArgs(markup.trim());
        if (!args.length) return whole;

        const name = quotedValue(args[0]);
        const nameClass = name === null ? `fa-{{ ${args[0]} }}` : `fa-${name}`;
        // Only the POSITIONAL class arg carries over; a `label=` option has no
        // native equivalent, so the icon converts and the option drops.
        const extraArg = args[1] && !args[1].includes('=') ? args[1] : null;
        const extraValue = extraArg === null ? '' : (quotedValue(extraArg) ?? `{{ ${extraArg} }}`);
        const classes = extraValue ? `fa-solid ${nameClass} ${extraValue}` : `fa-solid ${nameClass}`;

        return `<i class="${classes}"></i>`;
      });
      if (replaced !== line) edits.push({ rule: 'icon-tag-markup', line: index + 1, before: line.trim(), after: replaced.trim() });
      return replaced;
    });
    return { text: fromLines(out, trailingNewline), edits, findings: [] };
  },
};

/** Split a tag's markup on top-level commas, respecting quotes. */
function splitTagArgs(markup) {
  const args = [];
  let current = '';
  let quote = null;
  for (const char of markup) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ',') {
      args.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/** The inside of a quoted arg, or null when the arg is an expression. */
function quotedValue(arg) {
  return /^(['"]).*\1$/.test(arg) ? arg.slice(1, -1).trim() : null;
}

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
//
// The rewrite is SCOPE-AWARE ([#541](https://github.com/Omega-JS-Stack/omega/issues/541)):
// inside a `{% for %}`/`{% tablerow %}` binding the same name, `<key>` is the
// LOOP ITEM, so the rename would silently repoint the read — `{% if tag !=
// page.tag.name %}` inside `{% for tag in … %}` becomes a comparison of the
// item with itself, an always-true exclude guard on a page that still builds.
// Those occurrences are skipped and reported; occurrences outside the loop
// still rewrite.
//
// Its own tracker, not rule 4's: that one answers "how deep, on which line"
// for the parentloop hoist and must NOT count `{% tablerow %}` (a tablerow
// exposes `tablerowloop`, never `forloop`); this one answers "which NAMES are
// bound here", where a tablerow shadows exactly like a for.
// ---------------------------------------------------------------------------
const SCOPE_TOKEN = /\{%-?\s*(?:for|tablerow)\s+(\w+)\s+in\b|\{%-?\s*(endfor|endtablerow|raw|endraw|comment|endcomment)\b/g;

/**
 * Walk one line's scope tokens in order, updating the bound-name stack and the
 * inert-span flag.
 * @returns {string[]} the names bound by loops OPENED on this line (in scope
 * for the rest of it)
 */
function trackLoopScope(line, stack, state) {
  const opened = [];
  for (const [, name, keyword] of line.matchAll(SCOPE_TOKEN)) {
    if (keyword === 'raw' || keyword === 'comment') { state.inert += 1; continue; }
    if (keyword === 'endraw' || keyword === 'endcomment') { state.inert = Math.max(0, state.inert - 1); continue; }
    if (state.inert > 0) continue;
    if (keyword) { if (stack.length) stack.pop(); continue; }
    stack.push(name);
    opened.push(name);
  }
  return opened;
}

const pageProps = {
  id: 'page-props',
  title: '`page.<frontmatterKey>` → `<key>`; `page.content` → `content`; `page.slug` → `page.fileSlug`',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const edits = [];
    const findings = [];
    const stack = [];
    const state = { inert: 0 };
    // The lookbehind keeps `page.` out of larger words and paths —
    // `words-on-a-page.png`, `/landing-page.html`, `data.page.url` are NOT
    // page-object references.
    const out = lines.map((line, index) => {
      const bound = new Set(stack);
      for (const name of trackLoopScope(line, stack, state)) bound.add(name);
      let replaced = line
        .replace(/(?<![\w./-])page\.content\b/g, (whole) => (bound.has('content') ? whole : 'content'))
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
        if (bound.has(key)) {
          findings.push({
            check: 'page-props', line: index + 1, severity: 'error',
            message: `\`page.${key}\` left alone: an enclosing \`{% for ${key} in … %}\`/\`{% tablerow %}\` binds \`${key}\`, `
              + `so the rename would read the LOOP ITEM instead of the page's \`${key}\` — hoist the page value before the loop `
              + `(\`{% assign page_${key} = ${key} %}\` above it) or rename the loop variable, by hand`,
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

// ---------------------------------------------------------------------------
// Rule 24 — config READS → `resolved.config.<section>`
// ([#611](https://github.com/Omega-JS-Stack/omega/issues/611)). #607 moved the
// brand config off `site.*` onto `resolved.config.*`, and the old spellings do
// not fail: `{{ site.brand.name }}` renders an EMPTY STRING, on every page that
// carries one. Rule 23 moves the frontmatter KEYS a page restates; this one
// moves the reads, in bodies and frontmatter values alike.
//
// TWO dead spellings, because the port produces both: the `site.<section>` a
// UJM page wrote by hand, and the flat `resolved.<section>` rule 1 manufactures
// out of `page.resolved.<section>`. `site.meta` is the meta WALK rather than a
// config section, so it lands on `resolved.meta`, where the walk lives.
//
// Runs AFTER rule 9: `site.analytics.<provider>` is that rule's input, and
// renaming the root first would strand the flat spelling it answers to.
// ---------------------------------------------------------------------------

/**
 * What one read becomes, or null when it is not this rule's business.
 * @param {{ root: string, key: string }} read
 * @returns {string|null} the replacement ROOT+KEY (the dotted tail rides along)
 */
function movedRead(read) {
  // `meta` is not config at all — it is the page's own walk — so `site.meta`
  // lands on `resolved.meta`, never under `config`.
  if (read.key === 'meta') return read.root === 'site' ? 'resolved.meta' : null;
  return CONFIG_SECTIONS.has(read.key) ? `resolved.config.${read.key}` : null;
}

// ---------------------------------------------------------------------------
// The SELF-REFERENCE (#671, part 2)
//
// A UJM page wrote `meta: { title: "{{ site.meta.title }}" }` to mean "use the
// site default". Rewritten it becomes `{{ resolved.meta.title }}` — and THIS
// block is what the meta walk resolves that from, so the page's <title> shipped
// the literal string `{{ resolved.meta.title }}`. There is nothing to rewrite
// it to: absence already falls through to the config default, so the read is
// DROPPED, key and all, with a finding naming the file. Both spellings go —
// a brand migrated before 0.46.0 is carrying the rewritten shape, and re-running
// migrate has to repair it rather than call the page done.
// ---------------------------------------------------------------------------

/**
 * Split a YAML flow mapping's body on its TOP-LEVEL commas (quotes and nested
 * brackets hold their commas).
 * @param {string} body - the text between `{` and `}`
 * @returns {string[]}
 */
function splitFlowPairs(body) {
  const pairs = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      pairs.push(body.slice(start, i));
      start = i + 1;
    }
  }
  pairs.push(body.slice(start));
  return pairs.filter((pair) => pair.trim() !== '');
}

/**
 * The `}` closing the flow mapping opened on `lines[start]`, quote-aware — a
 * brace inside a quoted scalar is text, not structure.
 * @param {string[]} lines
 * @param {number} start - index of the line carrying the opening brace
 * @param {number} limit - one past the last line the mapping may reach
 * @returns {{ line: number, column: number }|null} null when it never closes
 */
function flowMappingEnd(lines, start, limit) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < limit; i++) {
    const line = lines[i];
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) return { line: i, column: c };
      }
    }
    quote = null; // a quoted YAML scalar does not span lines
  }
  return null;
}

/**
 * The lines nested under the key on `lines[opener]` — everything more indented,
 * blanks skipped, up to the first line that dedents.
 * @param {string[]} lines
 * @param {number} opener
 * @param {number} limit - one past the last line to consider (the fence)
 * @returns {number[]} line indexes
 */
function nestedLines(lines, opener, limit) {
  const indent = lines[opener].match(/^[ \t]*/)[0].length;
  const children = [];
  for (let i = opener + 1; i < limit; i++) {
    if (lines[i].trim() === '') continue;
    if (lines[i].match(/^[ \t]*/)[0].length <= indent) break;
    children.push(i);
  }
  return children;
}

/**
 * Drop the reads of the meta walk that sit inside the page's OWN `meta:` block.
 * @param {string} text
 * @returns {{ text: string, edits: object[], findings: object[] }}
 */
function dropSelfMetaReads(text) {
  const { lines, trailingNewline } = toLines(text);
  const sourceLines = [...lines];
  const fenceEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  if (fenceEnd < 0) return { text, edits: [], findings: [] };

  const readLines = new Set(
    templateReads(text).filter((read) => read.key === 'meta' && read.line <= fenceEnd).map((read) => read.line),
  );
  if (!readLines.size) return { text, edits: [], findings: [] };

  const drop = new Set();
  const rewritten = new Set();
  const findings = [];
  const say = (line, key, source) => findings.push({
    check: 'config-reads', line, severity: 'warning',
    message: `dropped \`${key}\` from this page's own \`meta:\` block (#671) — it read \`${source}\`, which IS the walk this block feeds, `
      + 'so the page rendered the literal expression. Absence falls through to the config default',
  });

  let block = null; // the `meta:` block we are inside: { opener, indent, children }
  const blocks = [];
  for (let i = 1; i < fenceEnd; i++) {
    const line = lines[i];
    const blank = line.trim() === '';
    const indent = blank ? Infinity : line.match(/^[ \t]*/)[0].length;
    if (block && !blank && indent <= block.indent) block = null;

    if (block) {
      if (!blank) block.children.push(i);
      continue;
    }

    const opener = line.match(/^([ \t]*)meta:\s*$/);
    if (opener) {
      block = { opener: i, indent: opener[1].length, children: [] };
      blocks.push(block);
      continue;
    }

    // The flow spelling, on ONE line (`meta: { title: "{{ site.meta.title }}" }`)
    // or spread over several with the closing brace below — both are legal
    // YAML, and a self-reference hides in either. Judged pair by pair, per
    // line, exactly like the block form.
    const flow = line.match(/^([ \t]*)meta:\s*\{/);
    if (!flow) continue;
    const close = flowMappingEnd(lines, i, fenceEnd);
    if (!close) continue;

    const open = line.indexOf('{', flow[1].length);
    const segments = [];
    for (let j = i; j <= close.line; j++) {
      const body = lines[j].slice(j === i ? open + 1 : 0, j === close.line ? close.column : lines[j].length);
      const pairs = splitFlowPairs(body);
      segments.push({
        index: j,
        kept: !readLines.has(j + 1) ? pairs : pairs.filter((pair) => {
          if (!/\{\{[^}]*\b(site|resolved)\.meta\b/.test(pair)) return true;
          say(j + 1, (pair.match(/^\s*([\w-]+)\s*:/) || [null, 'meta'])[1], pair.trim());
          return false;
        }),
      });
    }

    if (segments.every((segment) => segment.kept.length === 0)) {
      for (let j = i; j <= close.line; j++) drop.add(j);
    } else {
      const last = segments.filter((segment) => segment.kept.length > 0).pop();
      for (const segment of segments) {
        const j = segment.index;
        const head = j === i ? lines[j].slice(0, open + 1) : '';
        const tail = j === close.line ? lines[j].slice(close.column) : '';
        if (segment.kept.length === 0) {
          // A line that carried nothing else goes; the opener and the closer
          // stay to carry their braces.
          if (!head && !tail) drop.add(j);
          else lines[j] = `${head}${tail ? lines[j].match(/^[ \t]*/)[0] : ''}${tail}`;
        } else {
          const body = segment.kept.join(',') + (segment === last ? '' : ',');
          lines[j] = `${head}${body}${tail}`;
        }
        if (lines[j] !== sourceLines[j] && !drop.has(j)) rewritten.add(j);
      }
      // The one-line form reads as one pair list — collapse the space the
      // dropped pairs left before the closing brace.
      if (i === close.line) lines[i] = lines[i].replace(/\s+\}(\s*)$/, ' }$1');
    }
    i = close.line;
  }

  for (const entry of blocks) {
    for (const child of entry.children.filter((line) => readLines.has(line + 1))) {
      drop.add(child);
      say(child + 1, (lines[child].match(/^\s*([\w-]+)\s*:/) || [null, 'meta'])[1], lines[child].trim());
    }
  }

  // An emptied key is a NULL key, not an absent one — and this engine's
  // deepMerge lets a null REPLACE the config defaults it was supposed to fall
  // through to. So every key the drop emptied goes with it, from the deepest
  // nested one (an `og:` whose only child was a self-read) up to the `meta:`
  // opener itself — a fixed point, because dropping one empties its parent.
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 1; i < fenceEnd; i++) {
      if (drop.has(i) || !/^[ \t]*[\w-]+:\s*$/.test(lines[i])) continue;
      const children = nestedLines(lines, i, fenceEnd);
      if (children.length === 0 || !children.every((child) => drop.has(child))) continue;
      drop.add(i);
      changed = true;
    }
  }

  if (!drop.size && !rewritten.size) return { text, edits: [], findings: [] };

  // One edit per changed line: a drop the report never counted was a repair
  // the codemod never wrote (the write and the file listing both gate on edits).
  const edits = [...new Set([...drop, ...rewritten])].sort((a, b) => a - b).map((index) => ({
    rule: 'config-reads',
    line: index + 1,
    before: sourceLines[index].trim(),
    after: drop.has(index) ? '(removed — a page may not read the walk its own `meta:` block feeds)' : lines[index].trim(),
  }));

  return { text: fromLines(lines.filter((line, index) => !drop.has(index)), trailingNewline), edits, findings };
}

const configReads = {
  id: 'config-reads',
  title: '`site.<section>` / `resolved.<section>` reads → `resolved.config.<section>`',
  apply(text) {
    // A page's own `meta:` block first (#671): those reads are dropped, not
    // moved, and dropping before the rewrite catches BOTH spellings on one path.
    const self = dropSelfMetaReads(text);

    // The census is config-sections.js's, shared with the engine's build guard
    // (#611): only LIQUID context counts, and fenced code blocks and `{% raw %}`
    // bodies are display, not markup (#521). Without that this rule turned
    // `https://site.company.com/x` into `resolved.config.company.com` and
    // rewrote the legacy spelling inside a page's own documentation of it —
    // both found by the blind-verifier walk (2026-08-25).
    //
    // Splice from the END so every earlier offset stays valid.
    const reads = templateReads(self.text).filter((read) => movedRead(read) !== null);
    if (!reads.length) {
      // Already migrated — idempotent (the self-reference drop may still have
      // repaired a page rewritten by an older migrate, and THAT is an edit:
      // the codemod writes and lists what the rules report as changed).
      return { text: self.text, edits: self.edits, findings: self.findings };
    }

    let out = self.text;
    const lines = new Map(); // line → { before, after } — one edit per changed line
    for (const read of [...reads].reverse()) {
      const tail = read.expression.slice(`${read.root}.${read.key}`.length);
      out = out.slice(0, read.index) + movedRead(read) + tail + out.slice(read.index + read.expression.length);
    }
    const beforeLines = toLines(self.text).lines;
    const afterLines = toLines(out).lines;
    for (const read of reads) {
      if (lines.has(read.line)) continue;
      lines.set(read.line, { before: beforeLines[read.line - 1], after: afterLines[read.line - 1] });
    }

    const moved = [...lines].map(([line, { before, after }]) => ({
      rule: 'config-reads', line, before: before.trim(), after: after.trim(),
    }));

    return {
      text: out,
      edits: [...self.edits, ...moved],
      findings: [...self.findings, {
        check: 'config-reads', line: moved[0].line, severity: 'warning',
        message: 'rewrote config reads to `resolved.config.<section>` (#607) — the brand config left the `site` global, '
          + 'where they rendered an empty string with no error. Check the page still reads what it meant',
      }],
    };
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
// Rule 11 — the client block's frontmatter key names: `web_manager:` →
// `client:` (#1: it configures @omega.js/client, and there is no dual-read) and
// its `cookieConsent:` sub-key → `consent:` (#383: the banner became a real
// consent gate, and a page that disabled the old name would silently stop
// disabling anything)
// ---------------------------------------------------------------------------
const clientFrontmatter = {
  id: 'client-frontmatter',
  title: 'frontmatter `web_manager:` → `client:`, `cookieConsent:` → `consent:`',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    // Scoped to the leading `---` fence: a `web_manager:` in the body is prose
    // or data, never the client-config key.
    const fenceEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
    if (fenceEnd < 0) return { text, edits: [], findings: [] };

    const edits = [];
    const out = lines.map((line, index) => {
      if (index === 0 || index >= fenceEnd) return line;
      // `cookieConsent` is always INDENTED here — it only ever existed as a
      // sub-key of the client block, never at the frontmatter's top level.
      const replaced = line
        .replace(/^web_manager:/, 'client:')
        .replace(/^(\s+)cookieConsent:/, '$1consent:');
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
//
// The rename alone shipped two dead shapes with no error at all
// ([#594](https://github.com/Omega-JS-Stack/omega/issues/594)), so the rewrite
// carries them too:
//   - `response: 'json'` — @omega.js/client parses by content type and RETURNS
//     the body, so the option means nothing. Dropped from the rewritten call.
//   - `err.status` — the HTTP status lives on `error.code`
//     (packages/client/src/modules/request.js), so `if (err.status === 429)`
//     compared `undefined` and the whole rate-limit branch went dark. Every
//     `.status` read on a CAUGHT error in a rewritten file becomes `.code`.
// What is not mechanically rewritable is named at its line instead: a
// non-json `response`, options behind an identifier, a `.status` read on
// something that is not a catch binding.
// ---------------------------------------------------------------------------
const FORM_MANAGER_SPECIFIER = /(["'])__main_assets__\/js\/libs\/form-manager\.js\1/g;
const AUTHORIZED_FETCH_IMPORT = /^\s*import\s+[\w{},\s*]+\s+from\s+["']__main_assets__\/js\/libs\/authorized-fetch\.js["'];?\s*$/;
const CLIENT_DEFAULT_IMPORT = /import\s+omega\s+from\s+["']@omega\.js\/client["']/;

// `catch (err)`, `.catch((err) =>` and `.catch(err =>` — the three ways a
// consumer binds the error whose `.status` the rewrite has to move. The arrow
// with no parens is the commonest of them, and its terminator is the `=>`.
const CATCH_PARAM = /\bcatch\s*\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*(?:[),]|=>)/g;
// One `response: <string>` option, with whichever comma separates it. The
// replacer keeps ONE of the two commas so the neighbours stay separated.
const RESPONSE_OPTION = /(,\s*)?\bresponse\s*:\s*(['"])([^'"]*)\2(\s*,)?/;
const STATUS_READ = /\b([A-Za-z_$][\w$]*)\.status\b/g;

// A `/` that opens a REGEX rather than dividing: what may precede one is an
// operator, an opening bracket, or a keyword — never a value.
const REGEX_PRECEDER = /(?:^|[(,=:[!&|?{};+\-*%~^<>]|\b(?:return|typeof|case|in|of|do|else|yield|await|new|delete|void))\s*$/;

/**
 * The end of the string/template/regex literal opening at `start`.
 * @param {string} text
 * @param {number} start - index of the opening delimiter
 * @param {string} close - the delimiter that ends it
 * @param {boolean} multiline - whether it may cross a newline
 * @returns {number} index of the closing delimiter, -1 unterminated
 */
function literalEnd(text, start, close, multiline) {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === close) return i;
    else if (!multiline && text[i] === '\n') return -1;
  }
  return -1;
}

/**
 * Walk JS source from `start`, handing `visit(char, index)` every character
 * that is real CODE — string, template, comment and regex bodies are SKIPPED.
 * A paren inside a url (`'/search('`) is text, and counting it desynced every
 * span this rule measures, which handed the option strip unrelated code.
 * @param {string} text
 * @param {number} start
 * @param {function(string, number): (number|undefined)} visit - a returned index stops the walk
 * @returns {number|null} what `visit` returned, or null when nothing stopped it
 */
function walkCode(text, start, visit) {
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '/' && next === '/') {
      const line = text.indexOf('\n', i);
      if (line < 0) return null;
      i = line;
      continue;
    }
    if (char === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close < 0) return null;
      i = close + 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const close = literalEnd(text, i, char, char === '`');
      if (close < 0) return null;
      i = close;
      continue;
    }
    if (char === '/' && REGEX_PRECEDER.test(text.slice(Math.max(0, i - 12), i))) {
      const close = literalEnd(text, i, '/', false);
      if (close < 0) return null;
      i = close;
      continue;
    }

    const stop = visit(char, i);
    if (stop !== undefined) return stop;
  }
  return null;
}

/**
 * The index of the character closing the group opened at `open`.
 * @param {string} text
 * @param {number} open - index of the `(` or `{`
 * @returns {number|null} null when it never closes
 */
function groupEnd(text, open) {
  const closer = text[open] === '(' ? ')' : '}';
  let depth = 0;
  return walkCode(text, open, (char, index) => {
    if (char === text[open]) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return index;
    }
    return undefined;
  });
}

/**
 * The end of the argument list opened at (entry, column) — parens balanced
 * across lines, string and comment bodies skipped. A call's options object is
 * the span this walk covers.
 * @param {Array<{ text: string }>} entries - the file's surviving lines
 * @param {number} start - index of the entry carrying the opening paren
 * @param {number} column - offset of the opening paren in that entry
 * @returns {number} index of the entry carrying the closing paren
 */
function argumentSpanEnd(entries, start, column) {
  const text = entries.slice(start).map((entry) => entry.text).join('\n');
  const close = groupEnd(text, column);
  // Never balanced: the span is the call's own line and nothing is stripped
  // below it. A run of the file's remaining lines is how a shape this walk
  // cannot read turns into edits to code that has nothing to do with the call.
  if (close === null) return start;
  return start + (text.slice(0, close).match(/\n/g) || []).length;
}

/**
 * Every catch binding in a file, with the LINE SPAN of the block it is bound
 * over: a `{ … }` body, or an arrow's bare expression (which ends where the
 * `.catch(` call does).
 * @param {string} text - the whole source
 * @returns {Array<{ name: string, start: number, end: number }>} 1-based lines
 */
function catchScopes(text) {
  const lineAt = (index) => (text.slice(0, index).match(/\n/g) || []).length + 1;
  const scopes = [];

  CATCH_PARAM.lastIndex = 0;
  let match;
  while ((match = CATCH_PARAM.exec(text)) !== null) {
    // Past whatever is left of the header (`) => `, a second parameter) to the
    // first character of the body itself.
    const body = walkCode(text, match.index + match[0].length, (char, index) => (/[\s),=>]/.test(char) ? undefined : index));
    if (body === null) continue;
    const end = text[body] === '{' ? groupEnd(text, body) : groupEnd(text, text.indexOf('(', match.index));
    if (end === null) continue;
    scopes.push({ name: match[1], start: lineAt(match.index), end: lineAt(end) });
  }
  return scopes;
}

const clientLibs = {
  id: 'client-libs',
  title: '`__main_assets__/js/libs/form-manager.js` → the client module; `authorizedFetch()` → `omega.request()`',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const findings = [];
    // Every surviving line with the ORIGINAL line number it reports as: the
    // import line and an option-only line are removed, so the two numbering
    // schemes part ways immediately and every finding owes the source's.
    const entries = [];
    const removed = new Map(); // original line → what the edit records as `after`
    const callEntries = [];
    let rewroteCall = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (AUTHORIZED_FETCH_IMPORT.test(line)) {
        removed.set(i + 1, '(removed — omega.request() replaces it)');
        continue;
      }

      const replaced = line
        .replace(FORM_MANAGER_SPECIFIER, '$1@omega.js/client/modules/form-manager.js$1')
        .replace(/\bauthorizedFetch\(/g, 'omega.request(');
      if (/\bauthorizedFetch\(/.test(line)) {
        rewroteCall = true;
        callEntries.push(entries.length);
        findings.push({
          check: 'client-libs', line: i + 1, severity: 'warning',
          message: '`authorizedFetch(…)` → `omega.request(…)`: same (url, options) shape and the same Bearer attach, and the two dead shapes went with it '
            + '(`response: \'json\'` dropped — the parsed body IS the return value; `err.status` → `err.code`, where @omega.js/client puts the HTTP status). '
            + 'What is left is yours to verify: `output`, and the route segment (`/backend-manager/` is now `/omega/`)',
        });
      }
      entries.push({ line: i + 1, text: replaced });
    }

    if (rewroteCall) {
      // ---- the options of each rewritten call
      for (const start of callEntries) {
        const column = entries[start].text.indexOf('omega.request(') + 'omega.request'.length;
        const end = argumentSpanEnd(entries, start, column);
        let sawOptions = false;

        for (let i = start; i <= end; i++) {
          const match = entries[i].text.match(RESPONSE_OPTION);
          if (!match) continue;
          sawOptions = true;
          if (match[3] !== 'json') {
            findings.push({
              check: 'client-libs', line: entries[i].line, severity: 'warning',
              message: `\`response: '${match[3]}'\` has no @omega.js/client equivalent — \`omega.request\` parses by content type and returns the body. Port this call's output handling by hand`,
            });
            continue;
          }
          const stripped = entries[i].text
            .replace(RESPONSE_OPTION, (whole, lead, quote, value, trail) => (lead && trail ? trail : ''))
            .replace(/\{\s+\}/, '{}');
          if (stripped.trim() === '') removed.set(entries[i].line, '(removed — omega.request returns the parsed body)');
          else entries[i].text = stripped;
        }

        // Options behind an identifier (`omega.request(url, OPTIONS)`): a text
        // codemod cannot see inside them, and they are exactly where the dead
        // wonderful-fetch keys hide.
        const spanText = entries.slice(start, end + 1).map((entry) => entry.text).join('\n');
        if (!sawOptions && /,\s*[A-Za-z_$][\w$]*\s*\)/.test(spanText)) {
          findings.push({
            check: 'client-libs', line: entries[start].line, severity: 'warning',
            message: 'the options come from a variable — check it by hand for the wonderful-fetch keys (`response`, `output`) @omega.js/client does not have',
          });
        }
      }

      // ---- the error shape: authorizedFetch WAS this file's fetch, so an
      // error caught here is one of its errors — but only INSIDE the block that
      // binds it. Rewriting every `<name>.status` in the file by name renamed a
      // same-named parameter of an unrelated function.
      const scopes = catchScopes(lines.join('\n'));

      for (const entry of entries) {
        entry.text = entry.text.replace(STATUS_READ, (read, identifier) => {
          const bound = scopes.some((scope) => scope.name === identifier && entry.line >= scope.start && entry.line <= scope.end);
          if (bound) return `${identifier}.code`;
          findings.push({
            check: 'client-libs', line: entry.line, severity: 'warning',
            message: `left \`${read}\` alone — @omega.js/client puts the HTTP status on \`error.code\` (request.js), and only the author knows whose \`.status\` this is`,
          });
          return read;
        });
      }
    }

    // The edits, in source order: a removed line, then any line whose text moved.
    const edits = [];
    for (const entry of entries) {
      const before = lines[entry.line - 1];
      if (removed.has(entry.line)) continue;
      if (entry.text !== before) edits.push({ rule: 'client-libs', line: entry.line, before: before.trim(), after: entry.text.trim() });
    }
    for (const [line, after] of removed) edits.push({ rule: 'client-libs', line, before: lines[line - 1].trim(), after });
    edits.sort((a, b) => a.line - b.line);

    // `omega.request()` needs the singleton in scope. Every real consumer that
    // called authorizedFetch also imported web-manager (rule 13 renames that
    // import ahead of this one), so a miss here is a genuinely odd file — say
    // so rather than emit a module that throws on first call.
    const result = fromLines(entries.filter((entry) => !removed.has(entry.line)).map((entry) => entry.text), trailingNewline);
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
// Rule 21 — Kramdown inline attribute lists
// ([#565](https://github.com/Omega-JS-Stack/omega/issues/565))
//
// UJM page bodies wear IALs (`[Get your API key](/account){: .btn .btn-lg }`)
// because Jekyll renders markdown with Kramdown. `@omega.js/web` renders it
// with bare markdown-it, so the link ships UNSTYLED and the `{: … }` PRINTS on
// the page. The framework stays plugin-free (Ian's ruling 2026-08-21: no
// standing compat machinery in framework runs), so the conversion is here,
// once: a class-only IAL on a link IS an anchor with that class list.
//
// MARKDOWN FILES ONLY. An `.html` page was never markdown-rendered — under
// Jekyll too its `[text](url){: … }` was literal text — so rewriting it there
// would invent a link the legacy page never had.
//
// Anything else wearing an IAL (a block-level one under a heading, a link IAL
// carrying an id or an attribute) is reported: markdown-it prints all of them,
// and their targets are not one mechanical shape.
// ---------------------------------------------------------------------------
const MARKDOWN_FILE = /\.(?:md|markdown)$/i;
const CLASS_ONLY_LINK_IAL = /\[([^\]\n]*)\]\((\S+)\)\{:\s*((?:\.[\w-]+\s*)+)\}/g;
const SURVIVING_IAL = /\{:(?:\s|[.#])/;

const markdownIal = {
  id: 'markdown-ial',
  title: '`[text](url){: .a .b }` → `<a href="url" class="a b">text</a>`',
  apply(text, ctx = {}) {
    if (!MARKDOWN_FILE.test(ctx.filePath || '')) return { text, edits: [], findings: [] };

    const { text: out, edits } = replacePerLine(
      'markdown-ial', text, CLASS_ONLY_LINK_IAL,
      (whole, label, href, classes) => `<a href="${href}" class="${classes.trim().split(/\s+/).map((name) => name.slice(1)).join(' ')}">${label}</a>`
    );

    const findings = [];
    const { lines } = toLines(out);
    lines.forEach((line, index) => {
      if (!SURVIVING_IAL.test(line)) return;
      findings.push({
        check: 'markdown-ial', line: index + 1, severity: 'error',
        message: 'Kramdown inline attribute list survives — markdown-it does not read them, so this `{: … }` PRINTS on the page '
          + 'and whatever it decorated renders unstyled. A class-only IAL on a link converts automatically; this one carries an id, '
          + 'an attribute, or a block-level target — write the element as HTML by hand',
      });
    });
    return { text: out, edits, findings };
  },
};

// ---------------------------------------------------------------------------
// Rule 20 — the retired `modules/adunits/*` includes
// ([#559](https://github.com/Omega-JS-Stack/omega/issues/559))
//
// The ads rebuild (docs/web/ads-system.md) retired the UJM adunit includes for
// ONE section, `verts/unit`, whose fallback ladder covers what adsense.html
// and promo-server.html did separately. An include the engine cannot resolve
// renders nothing and fails nothing, so a ported page loses its ad unit
// silently.
//
// Only adsense.html maps mechanically: `type` carries, and UJM's `vert-size`
// (named around Liquid's built-in `size` filter) IS the section's `size`.
// Values pass through verbatim — a section tag's inline args are Liquid
// expressions, and its strings liquify at the call site.
//
// Runs AFTER include-slash, which owns the leading `/`.
// ---------------------------------------------------------------------------
const ADUNIT_INCLUDE = /\{%(-?)\s*include(?:_cached)?\s+modules\/adunits\/([\w-]+)\.html([^%]*?)(-?)%\}/g;
const INCLUDE_ARG = /([\w-]+)\s*=\s*("[^"]*"|'[^']*'|\S+)/g;
const ADUNIT_ARGS = { type: 'type', 'vert-size': 'size' };
const VERT_UNIT_POINTER = 'the successor is `{% section "verts/unit", type: …, size: … %}` (docs/web/ads-system.md)';

const adunitSection = {
  id: 'adunit-section',
  title: '`{% include modules/adunits/adsense.html %}` → `{% section "verts/unit" %}`',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const edits = [];
    const findings = [];
    const out = lines.map((line, index) => {
      const replaced = line.replace(ADUNIT_INCLUDE, (whole, open, unit, argText, close) => {
        if (unit !== 'adsense') {
          findings.push({
            check: 'adunit-section', line: index + 1, severity: 'error',
            message: `\`modules/adunits/${unit}.html\` is RETIRED — the include resolves to nothing and the unit silently vanishes. `
              + `${VERT_UNIT_POINTER}; port this one by hand (in-house inventory is \`type: "house"\` with \`vert_id\`)`,
          });
          return whole;
        }

        const pairs = [];
        const dropped = [];
        for (const [, key, value] of argText.matchAll(INCLUDE_ARG)) {
          if (ADUNIT_ARGS[key]) pairs.push(`${ADUNIT_ARGS[key]}: ${value}`);
          else dropped.push(key);
        }
        if (dropped.length > 0) {
          findings.push({
            check: 'adunit-section', line: index + 1, severity: 'warning',
            message: `\`${dropped.join('`, `')}\` did not carry onto \`verts/unit\` — the section has no such arg. `
              + 'The AdSense slot comes from `advertising.providers.adsense` config, and the unit owns its own markup',
          });
        }
        return `{%${open} section "verts/unit"${pairs.map((pair) => `, ${pair}`).join('')} ${close}%}`;
      });
      if (replaced !== line) edits.push({ rule: 'adunit-section', line: index + 1, before: line.trim(), after: replaced.trim() });
      return replaced;
    });
    return { text: fromLines(out, trailingNewline), edits, findings };
  },
};

// ---------------------------------------------------------------------------
// Rule 19 — the UJM library accessor
// ([#560](https://github.com/Omega-JS-Stack/omega/issues/560))
//
// Rule 13 renames the singleton and stops there, so `webManager.uj()` ships as
// `omega.uj()` — build-clean and DEAD (`@omega.js/client` has no `uj`; the
// first call is a TypeError). The successor is `omega.library()`, the accessor
// the web runtime installs on the singleton (core/js/main.js).
//
// The rewrite claims the two receivers that ARE the singleton and the no-arg
// call `uj()` always was. Anything else wearing `.uj(` is reported: an unknown
// receiver is not mechanically this accessor, and a silent rewrite there would
// trade one runtime TypeError for another.
// ---------------------------------------------------------------------------
const UJ_ACCESSOR = /\b(?:webManager|omega)\.uj\(\s*\)/g;
const UJ_SURVIVOR = /\.uj\(/;

const ujLibrary = {
  id: 'uj-library',
  title: '`webManager.uj()`/`omega.uj()` → `omega.library()`',
  apply(text) {
    const { text: out, edits } = replacePerLine('uj-library', text, UJ_ACCESSOR, 'omega.library()');
    const findings = [];
    const { lines } = toLines(out);
    lines.forEach((line, index) => {
      if (!UJ_SURVIVOR.test(line)) return;
      findings.push({
        check: 'uj-library', line: index + 1, severity: 'error',
        message: '`.uj(` survives — `@omega.js/client` has no `uj()`, so this call is a runtime TypeError. '
          + 'The UJM library accessor is `omega.library()` on the client singleton; rewrite this receiver by hand',
      });
    });
    return { text: out, edits, findings };
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

// ---------------------------------------------------------------------------
// Rule 17 — the dead `asset_path` frontmatter key
// ([#470](https://github.com/Omega-JS-Stack/omega/issues/470))
//
// UJM pages used it to borrow another page's module (agents/new.md carrying
// `asset_path: dashboard/agents/edit`). Page assets now resolve by URL ALONE
// (spec §7), so the key is inert: the page renders and ships with no js/css.
// Nothing is rewritten — the successor is a FILE the porter adds, so this is a
// finding that names the key and the idiom, never a generic ignored-key note.
//
// The successor named FIRST is the `[name]` wildcard family file, because the
// key's real job was a FAMILY of URLs sharing one module — the re-exporting
// index.js is the one-off escape hatch, second (#470 amendment).
// ---------------------------------------------------------------------------
const ASSET_PATH_KEY = /^asset_path\s*:/;

const assetPath = {
  id: 'asset-path',
  title: '`asset_path:` frontmatter → a `[name]` wildcard page module (reported, never rewritten)',
  apply(text) {
    const { lines } = toLines(text);
    // Scoped to the leading `---` fence: `asset_path:` in the body is prose.
    const fenceEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
    if (fenceEnd < 0) return { text, edits: [], findings: [] };

    const findings = [];
    lines.forEach((line, index) => {
      if (index === 0 || index >= fenceEnd || !ASSET_PATH_KEY.test(line)) return;
      findings.push({
        check: 'asset-path', line: index + 1, severity: 'error',
        message: '`asset_path` is DEAD — page assets resolve by URL alone (spec §7), so this page ships with NO js/css. '
          + 'A FAMILY of pages sharing one module is a `[name]` wildcard file: `js/pages/blog/[slug].js` + `css/pages/blog/[slug].scss` '
          + 'serve every /blog/<slug> page, no frontmatter involved. '
          + 'For a ONE-OFF page borrowing another page\'s module: a re-exporting `js/pages/<this page>/index.js` '
          + '(`export { default } from \'../<other page>/index.js\';`) and a `css/pages/<this page>/index.scss` that `@use`s the other sheet',
      });
    });
    return { text, edits: [], findings };
  },
};

// ---------------------------------------------------------------------------
// Rule 18 — the UJM → OMEGA section-arg renames
// ([#545](https://github.com/Omega-JS-Stack/omega/issues/545))
//
// Three section args were spelled differently in UJM, and section-arg
// validation is warn-only: a migrated page keeps the old key, the section
// never reads it, and the eyebrow / CTA sub line / CTA button simply vanish.
// Deterministic one-liners, so they belong in the table exactly like the
// client-runtime renames (#248).
//
// Scoped to the leading `---` fence's TOP-LEVEL section blocks and to their
// DIRECT children: a UJM pricing plan's `tagline:` is a plan's tagline, and
// `hero.demo.options.button` is the demo lane's own button.
// ---------------------------------------------------------------------------
const SECTION_ARGS = {
  hero: { tagline: 'badge.text' },
  cta: { description: 'subheadline', button: 'primary_button' },
};

const YAML_KEY = /^(\s*)([\w-]+)\s*:/;

/**
 * Read a frontmatter block: the indent of its direct children and the keys
 * they declare (needed before rewriting — `hero.badge` may already be taken by
 * the legacy badge object).
 * @param {string[]} lines
 * @param {number} start - the block's opener line index
 * @param {number} end - the frontmatter fence's closing line index
 * @param {number} [openerLead] - the opener's own indent (0 for a top-level
 *   block); the first line back at or above it ends the block
 * @returns {{ indent: number|null, keys: Set<string> }}
 */
function readSectionBlock(lines, start, end, openerLead = 0) {
  let indent = null;
  const keys = new Set();
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const lead = (line.match(/^\s*/) || [''])[0].length;
    if (lead <= openerLead) break; // a sibling (or the next top-level key) ends the block
    if (indent === null) indent = lead;
    const match = line.match(YAML_KEY);
    if (match && lead === indent) keys.add(match[2]);
  }
  return { indent, keys };
}

const sectionArgs = {
  id: 'section-args',
  title: '`hero.tagline` → `hero.badge.text`; `cta.description` → `cta.subheadline`; `cta.button` → `cta.primary_button`',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const fenceEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
    if (fenceEnd < 0) return { text, edits: [], findings: [] };

    const edits = [];
    const findings = [];
    const out = [];
    let block = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i === 0 || i >= fenceEnd) { out.push(line); block = null; continue; }
      // A top-level key (or any unindented content) ends the block above it
      if (line.trim() && !/^\s/.test(line)) block = null;

      const opener = line.match(/^([\w-]+):\s*$/);
      if (opener && SECTION_ARGS[opener[1]]) {
        const { indent, keys } = readSectionBlock(lines, i, fenceEnd);
        block = indent === null ? null : { renames: SECTION_ARGS[opener[1]], indent, keys };
        out.push(line);
        continue;
      }

      const child = block && line.match(new RegExp(`^(\\s{${block.indent}})([\\w-]+)(\\s*:)(.*)$`));
      const target = child && block.renames[child[2]];
      if (!target) { out.push(line); continue; }

      const [, lead, key, colon, value] = child;
      if (!target.includes('.')) {
        const replaced = `${lead}${target}${colon}${value}`;
        edits.push({ rule: 'section-args', line: i + 1, before: line.trim(), after: replaced.trim() });
        out.push(replaced);
        continue;
      }

      // The nested target (`badge.text`) becomes a real two-line mapping — but
      // only when the block has no `badge:` of its own: the UJM badge is a
      // DIFFERENT object ({ title, subtitle, icon }), and a second key of the
      // same name would drop one of the two.
      const [parent, leaf] = target.split('.');
      if (block.keys.has(parent)) {
        findings.push({
          check: 'section-args', line: i + 1, severity: 'error',
          message: `\`${key}\` here is now \`${parent}.${leaf}\`, but this block already declares \`${parent}:\` `
            + '(the UJM badge object) — merge the two by hand; a second key of the same name would drop one',
        });
        out.push(line);
        continue;
      }
      if (!value.trim()) {
        findings.push({
          check: 'section-args', line: i + 1, severity: 'error',
          message: `\`${key}\` here is now \`${parent}.${leaf}\`, but this one carries a block, not a string — re-nest it by hand`,
        });
        out.push(line);
        continue;
      }

      const nested = `${lead.repeat(2)}${leaf}${colon}${value}`;
      out.push(`${lead}${parent}:`, nested);
      edits.push({ rule: 'section-args', line: i + 1, before: line.trim(), after: `${parent}: { ${leaf}:${value} }`.trim() });
    }

    return { text: fromLines(out, trailingNewline), edits, findings };
  },
};

// ---------------------------------------------------------------------------
// Rule 22 — the hero's silently-dropped secondary button
// ([#579](https://github.com/Omega-JS-Stack/omega/issues/579))
//
// `marketing/hero` defaults `secondary_button.enabled: false` (the button is
// opt-in per its section.json5, and that default STAYS — a theme's own heroes
// depend on it). A UJM page never authored an `enabled` key: writing the block
// WAS the opt-in. So a migrated page keeps every button arg, builds clean,
// looks right — and has no second CTA. Migrate answers the question the legacy
// page answered by existing, and the report says it did.
//
// Scoped like rule 18: a top-level `hero:` block's DIRECT child. `cta`'s
// secondary button has no such default (it renders whenever it is set), so it
// is deliberately not here.
// ---------------------------------------------------------------------------
const heroSecondaryButton = {
  id: 'hero-secondary-button',
  title: '`hero.secondary_button` without `enabled` → `enabled: true`',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const fenceEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
    if (fenceEnd < 0) return { text, edits: [], findings: [] };

    const edits = [];
    const findings = [];
    const out = [];
    let block = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      out.push(line);
      if (i === 0 || i >= fenceEnd) { block = null; continue; }
      if (line.trim() && !/^\s/.test(line)) block = /^hero:\s*$/.test(line) ? readSectionBlock(lines, i, fenceEnd) : null;
      if (!block || block.indent === null) continue;

      // The opener alone — an inline mapping carries its own value and is not
      // the shape a UJM page ever wrote.
      if (line !== `${' '.repeat(block.indent)}secondary_button:`) continue;

      const { indent, keys } = readSectionBlock(lines, i, fenceEnd, block.indent);
      if (indent === null || keys.has('enabled')) continue;

      const enabled = `${' '.repeat(indent)}enabled: true`;
      out.push(enabled);
      edits.push({ rule: 'hero-secondary-button', line: i + 1, before: line.trim(), after: enabled.trim() });
      findings.push({
        check: 'hero-secondary-button', line: i + 1, severity: 'warning',
        message: 'this hero authored a secondary button but no `enabled` key, and `marketing/hero` defaults it OFF — '
          + 'migrate wrote `enabled: true` so the CTA survives the port. Delete the line if the button was meant to be hidden',
      });
    }

    return { text: fromLines(out, trailingNewline), edits, findings };
  },
};

// ---------------------------------------------------------------------------
// Rule 23 — bare config sections in frontmatter → under a `config:` parent
// (#607). A UJM-era page restated omega.json5 keys bare (`theme:`, `client:`,
// `inbound:`), which merged into the same flat tree the config seeded and let
// the two namespaces drift. The page lane is `config:` now and the build
// ERRORS on a bare config section — so this rule is what carries a legacy page
// across. Page machinery (`meta:`, `schema:`) is not config and stays put.
//
// Runs LAST with the other inserting rules: it re-indents whole blocks, so
// every line-numbered finding above it reports the pre-rewrite line.
// ---------------------------------------------------------------------------
const configParent = {
  id: 'config-parent',
  title: 'bare config sections in frontmatter → under `config:`',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const fenceEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
    if (fenceEnd < 0) return { text, edits: [], findings: [] };

    // Split the frontmatter into top-level blocks: an unindented `key:` opens
    // one and everything under it (indented lines, blanks) rides along until
    // the next unindented line. A comment ABOVE a key belongs to that key —
    // it is the note explaining the block, and moving the block without it
    // would strand the note over a `config:` line it never described.
    const blocks = [];
    let current = null;
    let lead = [];
    for (let i = 1; i < fenceEnd; i++) {
      const line = lines[i];
      const opener = line.match(/^([\w-]+):/);
      if (opener) {
        current = { key: opener[1], line: i + 1 - lead.length, body: [...lead, line] };
        lead = [];
        blocks.push(current);
        continue;
      }
      if (/^#/.test(line)) {
        lead.push(line); // a note waiting for the key it describes
        continue;
      }
      if (lead.length) { blocks.push({ key: null, body: lead }); lead = []; } // …that never came
      if (current && (line.trim() === '' || /^\s/.test(line))) {
        current.body.push(line);
        continue;
      }
      blocks.push({ key: null, body: [line] }); // a fence-level line of some other shape
      current = null;
    }
    if (lead.length) blocks.push({ key: null, body: lead });

    const moved = blocks.filter((block) => block.key && isMovableSection(block.key));
    if (!moved.length) return { text, edits: [], findings: [] }; // already migrated — idempotent

    const kept = blocks.filter((block) => !moved.includes(block));
    const existing = kept.find((block) => block.key === 'config');

    // Trailing blank lines belong BETWEEN blocks, not inside the moved one.
    const indented = moved.flatMap((block) => {
      while (block.body.length > 1 && block.body[block.body.length - 1].trim() === '') block.body.pop();
      return block.body.map((line) => (line.trim() === '' ? line : `  ${line}`));
    });

    if (existing) {
      existing.body.push(...indented);
    } else {
      kept.push({ key: 'config', body: ['config:', ...indented] });
    }

    const edits = moved.map((block) => ({
      rule: 'config-parent', line: block.line,
      before: `${block.key}:`, after: `config: ${block.key}:`,
    }));

    return {
      text: fromLines([lines[0], ...kept.flatMap((block) => block.body), ...lines.slice(fenceEnd)], trailingNewline),
      edits,
      findings: [{
        check: 'config-parent', line: moved[0].line, severity: 'warning',
        message: `moved ${moved.map((block) => `\`${block.key}\``).join(', ')} under \`config:\` — a page overrides omega.json5 there now (#607), `
          + 'and no config section keeps a bare spelling. Check the merged result renders what the page meant',
      }],
    };
  },
};

// ---------------------------------------------------------------------------
// Rule 26 — the retired `append:` frontmatter flag
// ([#607](https://github.com/Omega-JS-Stack/omega/issues/607), Ian 2026-08-26)
//
// `append: true` was the legacy UJM add-below contract kept behind a flag: the
// page body rendered BELOW the layout's default `{% composition %}` instead of
// replacing it. The flag is deleted — a page that wants the default bands
// writes them (`omega customize <url>` materializes exactly that) — so a page
// still carrying it renders the same as one without, and the key survives only
// as an unknown frontmatter key the build strips with a warning. Dropped here,
// with the finding that says what changed.
//
// Frontmatter-scoped and TOP-LEVEL only: `append` is a `| append:` Liquid
// filter everywhere else, and an indented `append:` belongs to some other
// block's data.
// ---------------------------------------------------------------------------
const appendFlag = {
  id: 'append-flag',
  title: 'the retired `append:` frontmatter flag → dropped',
  apply(text) {
    const { lines, trailingNewline } = toLines(text);
    const fenceEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
    if (fenceEnd < 0) return { text, edits: [], findings: [] };

    const at = lines.findIndex((line, index) => index > 0 && index < fenceEnd && /^append:/.test(line));
    if (at < 0) return { text, edits: [], findings: [] }; // already migrated — idempotent

    const out = [...lines];
    out.splice(at, 1);

    return {
      text: fromLines(out, trailingNewline),
      edits: [{ rule: 'append-flag', line: at + 1, before: lines[at].trim(), after: '' }],
      findings: [{
        check: 'append-flag', line: at + 1, severity: 'warning',
        message: '`append: true` is gone (#607) — a page body REPLACES the layout\'s default composition, and there is no '
          + 'flag to keep both. Run `omega customize <url>` to materialize the default bands into this page, then edit them '
          + 'with your own content below',
      }],
    };
  },
};

// ---------------------------------------------------------------------------
// Rule 25 — the UJM `random_id` global → an `omega_random` assign
// ([#595](https://github.com/Omega-JS-Stack/omega/issues/595))
//
// UJM handed every render a fresh `random_id`, and consumer includes scoped
// repeated markup with it (`id="tool-faq-{{ random_id }}"`). OMEGA has no such
// global, so the read renders EMPTY and every accordion on the page shares one
// container id — silently. `omega_random` is the successor, and the idiom is
// one assign at the top of the file, which the reads then keep spelling
// exactly as they did.
//
// Runs LAST: it inserts a line at the top, so every line-numbered edit and
// finding above it reports the pre-insert line.
// ---------------------------------------------------------------------------
const randomIdGlobal = {
  id: 'random-id',
  title: '`{{ random_id }}` (the UJM per-render global) → `{% assign random_id = 100 | omega_random %}`',
  apply(text) {
    const reads = randomIdReads(text);
    if (!reads.length || assignsRandomId(text)) return { text, edits: [], findings: [] }; // already migrated — idempotent

    const { lines, trailingNewline } = toLines(text);
    // Under the frontmatter fence if there is one: an assign inside it is YAML,
    // not Liquid. A file with no fence (an include, the shape that carried this
    // idiom) takes line 1.
    const fenceEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
    const at = fenceEnd < 0 ? 0 : fenceEnd + 1;

    const out = [...lines];
    out.splice(at, 0, RANDOM_ID_ASSIGN_IDIOM);

    return {
      text: fromLines(out, trailingNewline),
      edits: [{ rule: 'random-id', line: at + 1, before: '', after: RANDOM_ID_ASSIGN_IDIOM }],
      findings: [{
        check: 'random-id', line: reads[0].line, severity: 'warning',
        message: `\`random_id\` was a UJM per-render GLOBAL and OMEGA has none — unported it renders empty and every id it scopes collides. `
          + `Migrate wrote \`${RANDOM_ID_ASSIGN_IDIOM}\` at the top of the file; check the value's range suits the ids it builds`,
      }],
    };
  },
};

const RULES = [
  iconTagMarkup,       // 27 — FIRST: the icon tag stops being a tag (#619), so
                       //      neither the uj_→omega_ rename nor the tag-arg
                       //      hoist may see one
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
  adunitSection,       // 20 — must follow include-slash
  markdownIal,         // 21 — must precede gradient-utilities: the class list
                       //      it writes is a class list like any other
  gradientUtilities,   // 16
  assetPath,           // 17
  configReads,         // 24 — LAST of the text rewrites: it renames the roots
                       //      rules 9 and 12 answer to (`site.analytics.…`,
                       //      `themes/[ site.theme.id ]/…`), so it goes after
                       //      every rule that reads one
  appendFlag,          // 26 — before the re-indenting rules: it deletes a
                       //      frontmatter line, so its own finding is the
                       //      pre-move line like every rule above
  sectionArgs,         // 18 — the INSERTING rules go last, so every
  heroSecondaryButton, // 22   line-numbered finding above them reports the
  configParent,        // 23   pre-rewrite line
  randomIdGlobal,      // 25 — LAST: it inserts at the TOP, which moves every
                       //      other line in the file
];

// The consumer-JS table (src/**/*.js — the tree the template walk skips).
// Template rules never run over JS: `page.title` in a script is an object
// property, not a Jekyll frontmatter read.
const JS_RULES = [
  clientMarkup,        // 10 — the same class/attribute names, spelled in JS
  clientImport,        // 13 — must precede client-libs (it puts `omega` in scope)
  clientLibs,          // 14
  ujLibrary,           // 19
  serviceWorkerImport, // 15
];

// The section-descriptor table (src/**/*.json — bindings and classes declared
// as DATA, not markup). Only the rules whose subject is a LITERAL TOKEN belong
// here: the page-props, include and frontmatter rules answer to template text,
// and a `page.`-looking string in a descriptor is a JSON value, not a Jekyll
// read. A `{{ … }}` binding is the exception — the descriptor emits it into the
// page, so it is a read like any other (nav.json's logo text is the case).
const JSON_RULES = [
  clientMarkup,        // 10 — the same class/attribute names, spelled in a descriptor
  configReads,         // 24 — a binding that emits config renders empty too (#611)
];

module.exports = {
  RULES, JS_RULES, JSON_RULES,
  // Rule 24 alone, for the ONE file that is not a template and still carries
  // reads: the brand's own omega.json5 (#671, migrate/index.js step 2b).
  configReads,
  VALID_PAGE_PROPS, MANUAL_PAGE_PROPS, PACKAGED_THEMES,
};
