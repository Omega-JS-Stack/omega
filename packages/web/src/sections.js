/**
 * The section/component library machinery (plans/omega-sections-spec.md):
 * `{% section "marketing/hero", key: value %}` and `{% component "frame/x" %}`
 * Liquid tags. One tag, two authoring forms:
 *
 *   inline — {% section "marketing/hero", headline: "Ship it", data: resolved.hero %}
 *   block  — {% section "marketing/testimonials" %}
 *            headline: "What builders say"
 *            items:
 *              - quote: "…"
 *            {% endsection %}
 *
 * The block body is YAML (same dialect as frontmatter); using inline named
 * args AND a body on one call is an error. The reserved `data:` arg deep-
 * spreads an object between defaults and named args — the bridge that keeps
 * today's frontmatter-key overrides working (layouts pass `data: resolved.X`).
 *
 * Slots (Ian 2026-07-18): a body may carry named markup blocks —
 * {% slot demo %}<any html>{% endslot %} — alongside the YAML (or alongside
 * inline args: the XOR rule applies to the YAML remainder only). Slot content
 * renders in the CALLER's scope (site.*, captures, uj_* tags all work) and
 * reaches the section as a finished-HTML string arg (schema type 'html'),
 * merged OUTERMOST after call-site liquification — so slot output never
 * re-renders and literal braces (code samples via {% raw %}) survive. An
 * empty slot passes '' — the absence spine: it kills a default the same way
 * explicit-empty kills everywhere else. Same-tag nesting inside a slot
 * ({% section %} in a section slot) is not supported — the dual-form scan
 * would misread it (loud parse error); nest the OTHER tag instead
 * (components inside section slots, sections inside component slots).
 *
 * Resolution walks the layer chain (consumer `_sections`/`_components` →
 * active theme → classy base — first match wins), mirroring themes/layouts.
 * Each entry is a folder owning `section.html` + optional `section.json5`
 * ({ description, args, defaults, demo }) — defaults merge under passed args,
 * top-level args validate against the schema (warn + did-you-mean, never
 * throw).
 *
 * The name is usually a quoted literal; a bare expression that resolves to
 * an id string is also legal ({% section entry.id, data: variant.args %}) —
 * the auto-generated showcase's mechanism (spec §9), and how data-driven
 * composition stays one tag. The expression runs up to the first comma.
 *
 * Context-free rule (load-bearing): the markup renders against `{ args }`
 * ONLY — no page globals. Interpolation happens at the CALL site instead:
 * string values (passed or default) containing Liquid render against the
 * caller's scope before the section sees them, so defaults like
 * "Introducing {{ site.brand.name }}" work while markup stays portable to
 * any surface any framework builds.
 *
 * {% composition %}…{% endcomposition %} (spec §8) wraps a page layout's
 * default section composition. Three page states, all byte-parity with the
 * `{{ content | uj_content_format }}` layout line the wrap replaces:
 *   - empty page → the wrapped one-liners render (absence is the spine)
 *   - body content → renders BELOW the composition (the legacy append
 *     contract, preserved verbatim)
 *   - body content + `composition: true` frontmatter → the body REPLACES
 *     the composition — what `omega customize <url>` materializes, so a
 *     customized composition supersedes the default while the sections
 *     inside keep flowing from the theme.
 */
const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');
const yaml = require('js-yaml');
const { deepMerge } = require('./merge.js');

// The two tiers share one implementation — only the folder family and
// filenames differ ({% section %} → _sections/<id>/section.*).
const KINDS = {
  section: { dirname: '_sections', basename: 'section' },
  component: { dirname: '_components', basename: 'component' },
};

// Section ids are kebab-case category paths (marketing/hero) — never
// dotted/absolute/traversal paths.
const NAME_SHAPE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;

/**
 * Levenshtein distance — small inputs only (arg-name did-you-mean).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (unused, i) => [i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
}

/**
 * The nearest known arg name within edit distance 2, for warning text.
 * @param {string} key
 * @param {string[]} known
 * @returns {string} ' — did you mean "x"?' or ''
 */
function suggest(key, known) {
  let best = null;
  let bestDistance = 3;
  for (const candidate of known) {
    const distance = levenshtein(key, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best ? ` — did you mean "${best}"?` : '';
}

/**
 * Parse the inline named-arg list after the section name:
 * `headline: page.title, meta: "a, b"` → [{ key, expr }]. Quote-aware — a
 * comma inside a quoted value never splits. Value expressions are handed to
 * LiquidJS's evalValue verbatim (literals, dotted paths, filters all work).
 * @param {string} rest - the markup after the quoted name (leading comma ok)
 * @returns {Array<{key: string, expr: string}>}
 */
function parseInlineArgs(rest) {
  const pairs = [];
  let text = rest.trim().replace(/^,/, '');
  while (text.trim()) {
    const match = text.match(/^\s*([\w-]+)\s*:/);
    if (!match) throw new Error(`bad inline args near "${text.trim().slice(0, 40)}" — expected key: value`);
    let i = match[0].length;
    let quote = null;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ',') {
        break;
      }
    }
    const expr = text.slice(match[0].length, i).trim();
    if (!expr) throw new Error(`inline arg "${match[1]}" has no value`);
    pairs.push({ key: match[1], expr });
    text = text.slice(i + 1);
  }
  return pairs;
}

// {% slot name %}…{% endslot %} regions inside a section/component block
// body. Not a registered tag — pure body-text grammar, so a stray slot
// outside a block call fails loudly as an unknown tag.
const SLOT_RE = /\{%-?\s*slot\s+([A-Za-z_][\w-]*)\s*-?%\}([\s\S]*?)\{%-?\s*endslot\s*-?%\}/g;
const SLOT_STRAY_RE = /\{%-?\s*(?:slot|endslot)\b/;

/**
 * Split a block body into its YAML remainder and its named slot blocks.
 * @param {string} bodyText - raw captured block body
 * @returns {{yamlText: string, slots: Array<{name: string, source: string}>}}
 */
function extractSlots(bodyText) {
  const slots = [];
  const seen = new Set();
  const yamlText = bodyText.replace(SLOT_RE, (match, slotName, source) => {
    if (seen.has(slotName)) throw new Error(`duplicate {% slot ${slotName} %} — one block per name`);
    seen.add(slotName);
    slots.push({ name: slotName, source });
    return '';
  });
  if (SLOT_STRAY_RE.test(yamlText)) {
    throw new Error('malformed slot block — every {% slot name %} needs a name and a matching {% endslot %}');
  }
  return { yamlText, slots };
}

/**
 * Render every Liquid-carrying string in an args tree against the caller's
 * scope — fresh containers, source never mutated.
 * @param {object} liquid - the LiquidJS engine
 * @param {object} scope - plain scope object (context.getAll())
 * @param {*} value
 * @returns {Promise<*>}
 */
async function liquifyDeep(liquid, scope, value) {
  if (typeof value === 'string') {
    return value.includes('{{') || value.includes('{%')
      ? liquid.parseAndRender(value, scope)
      : value;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => liquifyDeep(liquid, scope, item)));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = await liquifyDeep(liquid, scope, item);
    return out;
  }
  return value;
}

/**
 * Validate a value against a schema type name. Warn-only machinery — callers
 * turn `false` into a message.
 * @param {*} value
 * @param {string} type - 'string' | 'number' | 'boolean' | 'array' | 'object'
 * @returns {boolean}
 */
function matchesType(value, type) {
  if (value === null || value === undefined) return true; // explicit null = "remove" — always legal
  switch (type) {
    case 'array': return Array.isArray(value);
    case 'object': return typeof value === 'object' && !Array.isArray(value);
    case 'html': return typeof value === 'string'; // finished markup — slot blocks or capture-passed
    case 'string': case 'number': case 'boolean': return typeof value === type;
    default: return true; // unknown schema type — never punish the caller
  }
}

// The §7 lanes an override folder may declare `inherit` for. html can't be
// inherited (not overriding it IS inheritance) and json5 can't (the folder is
// its own manifest — theme defaults are theme identity).
const INHERITABLE_LANES = new Set(['js', 'scss']);

/**
 * Read an entry folder's declared inherit lanes from its json5. Absent file,
 * unreadable file (resolveEntry warns that at render time), or no `inherit`
 * key → []. A malformed declaration throws — a contradictory manifest is a
 * structural error, like traversal ids.
 * @param {string} entryDir
 * @param {string} basename - 'section' | 'component'
 * @returns {string[]} validated lane names
 */
function readInheritLanes(entryDir, basename) {
  const metaPath = path.join(entryDir, `${basename}.json5`);
  if (!fs.existsSync(metaPath)) return [];
  let meta;
  try {
    meta = JSON5.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return [];
  }
  if (meta.inherit === undefined) return [];
  if (!Array.isArray(meta.inherit) || meta.inherit.some((lane) => !INHERITABLE_LANES.has(lane))) {
    throw new Error(`[sections] ${metaPath}: inherit must be an array drawn from ${[...INHERITABLE_LANES].join('/')} — got ${JSON.stringify(meta.inherit)}`);
  }
  return meta.inherit;
}

/**
 * Collect every section/component ASSET (section.scss / section.js and the
 * component.* twins) across the layer chain — the spec §7 asset lanes. Same
 * resolution semantics as the tags: first root owning the entry's .html wins
 * the WHOLE entry (markup + assets travel together — a consumer overriding a
 * section owns its styles/behavior too), with ONE declared exception: the
 * winning folder's json5 may carry `inherit: ['js']` (and/or 'scss') — lanes
 * it deliberately leaves to the chain, filled from the first LOWER full entry
 * (a folder owning the .html) that has the file. That's how a theme override
 * replaces markup while keeping the base section's behavior riding the
 * bundle without a copy (the newsflash newsletter-cta pattern — the base
 * js's DOM contract becomes part of the override's markup contract).
 * Declaring a lane the folder also ships throws (contradictory manifest);
 * a declaration no lower layer can fill warns and stays null. Sorted
 * (kind, id) for deterministic sheet/bundle order.
 * @param {string[]} baseDirs - resolution bases in precedence order
 *   (consumer dir first, then theme layers — registerSectionTags' order)
 * @param {object} [options]
 * @param {function} [options.warn] - warning sink (default console.warn)
 * @returns {Array<{kind: string, id: string, scss: string|null, js: string|null}>}
 */
function collectSectionAssets(baseDirs, options = {}) {
  const warn = options.warn || console.warn;
  const entries = new Map(); // `${kind}:${id}` → {kind, id, scss, js}
  const pending = new Map(); // `${kind}:${id}` → Set of inherit lanes still unfilled

  const walk = (root, dir, kind, prefix) => {
    const basename = KINDS[kind].basename;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const id = prefix ? `${prefix}/${item.name}` : item.name;
      if (!NAME_SHAPE.test(id)) continue;
      const entryDir = path.join(dir, item.name);
      const html = path.join(entryDir, `${basename}.html`);
      if (fs.existsSync(html)) {
        const key = `${kind}:${id}`;
        if (!entries.has(key)) {
          const scss = path.join(entryDir, `${basename}.scss`);
          const js = path.join(entryDir, `${basename}.js`);
          const entry = {
            kind,
            id,
            scss: fs.existsSync(scss) ? scss : null,
            js: fs.existsSync(js) ? js : null,
          };
          const lanes = readInheritLanes(entryDir, basename);
          for (const lane of lanes) {
            if (entry[lane]) {
              throw new Error(`[sections] ${entryDir}: declares inherit "${lane}" but ships its own ${basename}.${lane} — remove one`);
            }
          }
          entries.set(key, entry);
          if (lanes.length) pending.set(key, new Set(lanes));
        } else if (pending.has(key)) {
          // A LOWER layer's full entry at the same id — fill declared lanes
          // from the first layer that has each file (the chain continues past
          // layers lacking it).
          const lanes = pending.get(key);
          for (const lane of [...lanes]) {
            const file = path.join(entryDir, `${basename}.${lane}`);
            if (fs.existsSync(file)) {
              entries.get(key)[lane] = file;
              lanes.delete(lane);
            }
          }
          if (!lanes.size) pending.delete(key);
        }
      } else {
        walk(root, entryDir, kind, id);
      }
    }
  };

  for (const root of baseDirs) {
    for (const kind of Object.keys(KINDS)) {
      const dir = path.join(root, KINDS[kind].dirname);
      if (fs.existsSync(dir)) walk(root, dir, kind, '');
    }
  }

  for (const [key, lanes] of pending) {
    warn(`[sections] ${key}: declares inherit ${[...lanes].join(', ')} but no lower layer owns the file — nothing inherited`);
  }

  return [...entries.values()].sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id));
}

/**
 * The resolved library with meta, for the auto-generated showcase + schema
 * docs (spec §9). Same first-match-wins resolution as the tags — the entry a
 * page composing that id would actually render — with the winning folder's
 * json5 normalized for template consumption:
 *
 *   argsTable    — [{ name, type, description }] rows (the reference docs;
 *                  a shorthand `name: 'string'` schema yields type only)
 *   defaultsJson — pretty-printed defaults ('' when none): display copy for
 *                  the docs, showing the raw {{ site.brand.name }} tokens a
 *                  consumer would see in the file
 *
 * Display strings (description, argsTable descriptions, defaultsJson) are
 * HTML-ESCAPED here, including `{` → &#123; — templates print them verbatim
 * (no | escape). That's load-bearing, not cosmetic: the library rides the
 * page data cascade, whose frontmatter/resolved walkers liquify any string
 * containing {{ — raw tokens would either render (wrong: docs must show the
 * contract) or throw (JSON.stringify's escaped quotes inside a token are
 * invalid Liquid). Demo args stay RAW — they liquify at the tag's call site
 * like every real composition.
 *   demo         — [{ label, args?, stage_class? }] variants, rendered live
 *                  by the showcase entry page (args ride the data bridge, so
 *                  json5 defaults still apply underneath — exactly the
 *                  consumer experience); malformed variants warn + drop
 *   source       — which layer owns the entry: 'consumer' or the layer dir's
 *                  basename ('classy', 'newsflash')
 *   inherit      — declared §7 inherit lanes, for the docs chip
 *
 * `groups` clusters entries by (kind, category folder) for the index page —
 * sections first, then components, categories alphabetical (the spec §2
 * "the showcase groups by folder automatically").
 *
 * @param {object} options
 * @param {string[]} options.baseDirs - resolution bases in precedence order
 *   (registerSectionTags' order: consumer dir first, then theme layers)
 * @param {string} [options.consumerDir] - labeled 'consumer' when it wins
 * @param {function} [options.warn] - warning sink (default console.warn)
 * @returns {{ entries: Array<object>, groups: Array<{kind: string, category: string, entries: Array<object>}> }}
 */
function buildSectionLibrary(options) {
  const warn = options.warn || console.warn;
  const entries = new Map(); // `${kind}:${id}` → entry

  // Display-ready HTML text (see the JSDoc: the { escape makes the string
  // liquid-inert, which the data-cascade walkers require).
  const escapeHtml = (text) => String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/{/g, '&#123;');

  const normalizeMeta = (meta, label) => {
    const argsTable = Object.entries(meta.args || {}).map(([name, spec]) => ({
      name,
      type: typeof spec === 'string' ? spec : (spec && spec.type) || '',
      description: escapeHtml((spec && typeof spec === 'object' && spec.description) || ''),
    }));
    let demo = [];
    if (meta.demo !== undefined) {
      if (!Array.isArray(meta.demo)) {
        warn(`[sections] showcase ${label}: demo must be an array of { label, args } variants — ignoring`);
      } else {
        demo = meta.demo.filter((variant) => {
          const ok = variant && typeof variant === 'object' && typeof variant.label === 'string' && variant.label;
          if (!ok) warn(`[sections] showcase ${label}: demo variant without a label — dropped`);
          return ok;
        });
      }
    }
    return {
      description: escapeHtml(meta.description || ''),
      argsTable,
      defaultsJson: meta.defaults && Object.keys(meta.defaults).length
        ? escapeHtml(JSON.stringify(meta.defaults, null, 2))
        : '',
      demo,
      inherit: Array.isArray(meta.inherit) ? meta.inherit : [],
    };
  };

  const walk = (source, dir, kind, prefix) => {
    const basename = KINDS[kind].basename;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const id = prefix ? `${prefix}/${item.name}` : item.name;
      if (!NAME_SHAPE.test(id)) continue;
      const entryDir = path.join(dir, item.name);
      if (!fs.existsSync(path.join(entryDir, `${basename}.html`))) {
        walk(source, entryDir, kind, id);
        continue;
      }
      const key = `${kind}:${id}`;
      if (entries.has(key)) continue; // a higher layer already won
      let meta = {};
      const metaPath = path.join(entryDir, `${basename}.json5`);
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON5.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch (error) {
          warn(`[sections] showcase: unreadable ${metaPath} (${error.message}) — listing with empty meta`);
        }
      }
      entries.set(key, { kind, id, source, ...normalizeMeta(meta, key) });
    }
  };

  for (const root of options.baseDirs) {
    const source = root === options.consumerDir ? 'consumer' : path.basename(root);
    for (const kind of Object.keys(KINDS)) {
      const dir = path.join(root, KINDS[kind].dirname);
      if (fs.existsSync(dir)) walk(source, dir, kind, '');
    }
  }

  const sorted = [...entries.values()].sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id));

  const groupMap = new Map(); // `${kind}:${category}` → group
  for (const entry of sorted) {
    const category = entry.id.includes('/') ? entry.id.split('/').slice(0, -1).join('/') : '';
    const key = `${entry.kind}:${category}`;
    if (!groupMap.has(key)) groupMap.set(key, { kind: entry.kind, category, entries: [] });
    groupMap.get(key).entries.push(entry);
  }
  const groups = [...groupMap.values()].sort((a, b) => (
    a.kind === b.kind ? a.category.localeCompare(b.category) : (a.kind === 'section' ? -1 : 1)
  ));

  return { entries: sorted, groups };
}

/**
 * Register the {% section %} and {% component %} tags on a LiquidJS engine.
 * @param {object} engine - LiquidJS engine (Eleventy's, via amendLibrary)
 * @param {object} options
 * @param {string[]} options.baseDirs - resolution bases in precedence order:
 *   consumer dir first, then theme layers (each probed for _sections/_components)
 * @param {function} [options.warn] - warning sink (default console.warn)
 */
function registerSectionTags(engine, options) {
  const warn = options.warn || console.warn;

  for (const [tagName, kind] of Object.entries(KINDS)) {
    const roots = options.baseDirs
      .map((dir) => path.join(dir, kind.dirname))
      .filter((dir) => fs.existsSync(dir));

    // Per-registration caches — roots are fixed for a build, so entries and
    // parsed templates never go stale within one; a new build re-registers.
    const entryCache = new Map(); // name → { templatePath, meta } | null
    const templateCache = new Map(); // abs path → parsed templates

    const resolveEntry = (name) => {
      if (entryCache.has(name)) return entryCache.get(name);
      let entry = null;
      for (const root of roots) {
        const dir = path.join(root, name);
        const templatePath = path.join(dir, `${kind.basename}.html`);
        if (!fs.existsSync(templatePath)) continue;
        let meta = {};
        const metaPath = path.join(dir, `${kind.basename}.json5`);
        if (fs.existsSync(metaPath)) {
          try {
            meta = JSON5.parse(fs.readFileSync(metaPath, 'utf8'));
          } catch (error) {
            warn(`[sections] ${tagName} "${name}": unreadable ${kind.basename}.json5 (${error.message}) — treating as empty`);
          }
        }
        entry = { templatePath, meta };
        break;
      }
      entryCache.set(name, entry);
      return entry;
    };

    engine.registerTag(tagName, {
      parse(tagToken, remainTokens) {
        this.markup = String(tagToken.args || '').trim();
        this.bodyText = null;

        // Dual-form discrimination: block iff the matching end tag appears
        // before the next same-tag open in the remaining stream. Sound for
        // all legal inputs — YAML bodies never contain {% section %} tags.
        let isBlock = false;
        for (const token of remainTokens) {
          if (token.name === tagName) break;
          if (token.name === `end${tagName}`) { isBlock = true; break; }
        }
        if (!isBlock) return;

        const parts = [];
        while (remainTokens.length) {
          const token = remainTokens.shift();
          if (token.name === `end${tagName}`) {
            this.bodyText = parts.join('');
            return;
          }
          // Raw source capture — output tokens ({{ site.brand.name }}) ride
          // into the YAML verbatim and liquify at render, like every string arg.
          parts.push(typeof token.getText === 'function'
            ? token.getText()
            : token.input.slice(token.begin, token.end));
        }
        throw new Error(`{% ${tagName} %} block not closed with {% end${tagName} %}`);
      },

      * render(context, emitter) {
        const nameMatch = this.markup.match(/^"([^"]+)"|^'([^']+)'/);
        let name;
        let rest;
        if (nameMatch) {
          name = nameMatch[1] ?? nameMatch[2];
          rest = this.markup.slice(nameMatch[0].length);
        } else {
          // Expression name (the showcase's lane): everything up to the
          // first comma evaluates against the caller's scope and must yield
          // an id string. Bare paths only — a filter taking comma-separated
          // params needs a {% capture %} first.
          const comma = this.markup.indexOf(',');
          const expr = (comma === -1 ? this.markup : this.markup.slice(0, comma)).trim();
          if (!expr) throw new Error(`{% ${tagName} %} needs a name: {% ${tagName} "marketing/hero" %} (or an expression resolving to an id)`);
          name = yield this.liquid.evalValue(expr, context);
          if (typeof name !== 'string' || !name) {
            throw new Error(`{% ${tagName} ${expr} %}: the name expression must resolve to an entry id string — got ${JSON.stringify(name)}`);
          }
          rest = comma === -1 ? '' : this.markup.slice(comma);
        }
        if (!NAME_SHAPE.test(name)) throw new Error(`{% ${tagName} "${name}" %}: ids are kebab-case category paths (marketing/hero)`);

        const entry = resolveEntry(name);
        if (!entry) {
          throw new Error(`{% ${tagName} "${name}" %}: no ${kind.dirname}/${name}/${kind.basename}.html in any layer (${roots.join(', ') || 'no roots'})`);
        }

        // ---- gather passed args (inline XOR YAML remainder; slots ride either)
        const inlinePairs = parseInlineArgs(rest);
        const { yamlText, slots } = this.bodyText !== null
          ? (this.slotSplit ||= extractSlots(this.bodyText))
          : { yamlText: null, slots: [] };
        if (yamlText !== null && yamlText.trim() && inlinePairs.length) {
          throw new Error(`{% ${tagName} "${name}" %}: use inline args OR a YAML body, not both (slot blocks compose with either)`);
        }

        let passed = {};
        let dataArg;
        for (const { key, expr } of inlinePairs) {
          const value = yield this.liquid.evalValue(expr, context);
          if (key === 'data') dataArg = value;
          else passed[key] = value;
        }
        if (yamlText !== null && yamlText.trim()) {
          const parsed = yaml.load(yamlText);
          if (parsed === null || parsed === undefined) {
            // whitespace-only body — nothing passed
          } else if (typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`{% ${tagName} "${name}" %}: the YAML body must be a mapping of args`);
          } else {
            ({ data: dataArg, ...passed } = parsed);
          }
        }
        if (dataArg !== undefined && dataArg !== null && (typeof dataArg !== 'object' || Array.isArray(dataArg))) {
          warn(`[sections] ${tagName} "${name}": data must be an object — ignoring ${typeof dataArg}`);
          dataArg = undefined;
        }

        // ---- slots render NOW, in the caller's scope (site.*, captures,
        // uj_* tags) — finished HTML that merges outermost below, after
        // call-site liquification, so it never re-renders.
        const scope = typeof context.getAll === 'function' ? context.getAll() : context.environments;
        const slotValues = {};
        for (const slot of slots) {
          // Untrimmed — surrounding whitespace is cosmetic in HTML but load-
          // bearing for byte-exact conversions; whitespace-ONLY collapses to
          // '' so an empty slot reads as explicit-empty (kills a default).
          const rendered = yield this.liquid.parseAndRender(slot.source, scope);
          slotValues[slot.name] = rendered.trim() === '' ? '' : rendered;
        }

        // ---- schema validation (top level, warn-only)
        const schema = entry.meta.args;
        if (schema && typeof schema === 'object') {
          const known = Object.keys(schema);
          const incoming = { ...(dataArg || {}), ...passed, ...slotValues };
          for (const [key, value] of Object.entries(incoming)) {
            if (!known.includes(key)) {
              warn(`[sections] ${tagName} "${name}": unknown arg "${key}"${suggest(key, known)}`);
            } else {
              const type = typeof schema[key] === 'string' ? schema[key] : schema[key]?.type;
              if (type && !matchesType(value, type)) {
                warn(`[sections] ${tagName} "${name}": arg "${key}" should be ${type}`);
              }
            }
          }
        }

        // ---- defaults ← data ← named args, then call-site liquification,
        // then slots (outermost — already rendered)
        let args = deepMerge(entry.meta.defaults || {}, dataArg || {});
        args = deepMerge(args, passed);
        args = yield liquifyDeep(this.liquid, scope, args);
        Object.assign(args, slotValues);

        // ---- context-free render: { args } is the whole scope
        let templates = templateCache.get(entry.templatePath);
        if (!templates) {
          templates = this.liquid.parse(fs.readFileSync(entry.templatePath, 'utf8'), entry.templatePath);
          templateCache.set(entry.templatePath, templates);
        }
        emitter.write(yield this.liquid.render(templates, { args }));
      },
    });
  }

  // ---- {% composition %}…{% endcomposition %} (spec §8): the page-body
  // replacement guard. Wraps a layout's default composition; page content
  // (blank for every default page) picks the branch. Parity templates parse
  // lazily per engine so the non-blank branch renders the exact line the
  // wrap replaced.
  let contentParity = null;
  engine.registerTag('composition', {
    parse(tagToken, remainTokens) {
      this.tpls = [];
      let closed = false;
      while (remainTokens.length) {
        const token = remainTokens.shift();
        if (token.name === 'endcomposition') {
          closed = true;
          break;
        }
        this.tpls.push(this.liquid.parser.parseToken(token, remainTokens));
      }
      if (!closed) throw new Error('{% composition %} not closed with {% endcomposition %}');
    },

    * render(context, emitter) {
      const read = (key) => {
        try {
          return context.getSync([key]);
        } catch {
          return undefined;
        }
      };
      const content = read('content');
      const blank = typeof content !== 'string' || content.trim() === '';

      // Ian's ruling (2026-07-19): a page that writes a body MEANS it — the
      // body REPLACES the layout's default composition, no flag needed (the
      // old `composition: true` key is retired). The rare page that wants
      // the legacy add-below contract — body rendered BELOW the default
      // composition, exactly like the `{{ content | uj_content_format }}`
      // line this wrap replaced — declares `append: true`.
      if (!blank && !read('append')) {
        if (!contentParity) contentParity = this.liquid.parse('{{ content | uj_content_format }}');
        emitter.write(yield this.liquid.renderer.renderTemplates(contentParity, context));
        return;
      }

      emitter.write(yield this.liquid.renderer.renderTemplates(this.tpls, context));
      if (blank) {
        // Blank content still flows through (it is only whitespace) — byte-
        // parity with the replaced layout line, which emitted the chain's
        // newlines.
        if (typeof content === 'string') emitter.write(content);
      } else {
        if (!contentParity) contentParity = this.liquid.parse('{{ content | uj_content_format }}');
        emitter.write(yield this.liquid.renderer.renderTemplates(contentParity, context));
      }
    },
  });

  return engine;
}

module.exports = { registerSectionTags, collectSectionAssets, buildSectionLibrary, parseInlineArgs, levenshtein, KINDS };
