/**
 * rules.js — the executable codemod rules for `omega migrate`.
 *
 * The 8 rule classes extracted from the A2 real-file ports (DECISION.md
 * "consumer conversion plan"), plus the analytics-spelling normalization
 * (rule 9, from the omega.json5 flip). Every rule is a pure text → text
 * transform over ONE file: `apply(text, ctx)` returns `{ text, edits,
 * findings }` where `edits` are applied rewrites and `findings` are
 * lint-level observations the rule could NOT safely fix (surfaced by both
 * `omega migrate` and `omega migrate --check`).
 *
 * Rules run in ORDER (the RULES export): page.resolved must collapse before
 * the generic page.<key> rewrite, and page.canonical.url before both.
 */

// Tags whose quoted args template-kit resolves as variables — the rule-3
// capture hoist is scoped to these (interpolation inside OTHER tags' quoted
// strings is a Jekyll silent no-op we only report).
const { TAGS } = require('@omegajs/template-kit');

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
        const varName = `uj_migrate_arg_${captureCount}`;
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
    // depth-scoped names (uj_parentloop<depth>_<prop>) so nested hoists
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
          PARENTLOOP_PROPS.includes(prop) ? `uj_parentloop${depth}_${prop}` : whole);
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
          out.push(`${indent}  {% assign uj_parentloop${depth}_${prop} = forloop.${prop} %}`);
          edits.push({ rule: 'parentloop', line: i + 1, before: '(parent loop)', after: `{% assign uj_parentloop${depth}_${prop} = forloop.${prop} %}` });
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

const RULES = [
  pageResolved,        // 1
  bracketLayout,       // 2
  tagArgInterpolation, // 3
  parentloop,          // 4
  includeSlash,        // 5
  canonicalUrl,        // 7 — must precede page-props
  pageProps,           // 6
  analyticsShape,      // 9
];

module.exports = { RULES, VALID_PAGE_PROPS, MANUAL_PAGE_PROPS, PACKAGED_THEMES };
