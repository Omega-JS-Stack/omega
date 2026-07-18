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
 * Resolution walks the layer chain (consumer `_sections`/`_components` →
 * active theme → classy base — first match wins), mirroring themes/layouts.
 * Each entry is a folder owning `section.html` + optional `section.json5`
 * ({ description, args, defaults, demo }) — defaults merge under passed args,
 * top-level args validate against the schema (warn + did-you-mean, never
 * throw).
 *
 * Context-free rule (load-bearing): the markup renders against `{ args }`
 * ONLY — no page globals. Interpolation happens at the CALL site instead:
 * string values (passed or default) containing Liquid render against the
 * caller's scope before the section sees them, so defaults like
 * "Introducing {{ site.brand.name }}" work while markup stays portable to
 * any surface any framework builds.
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
    case 'string': case 'number': case 'boolean': return typeof value === type;
    default: return true; // unknown schema type — never punish the caller
  }
}

/**
 * Collect every section/component ASSET (section.scss / section.js and the
 * component.* twins) across the layer chain — the spec §7 asset lanes. Same
 * resolution semantics as the tags: first root owning the entry's .html wins
 * the WHOLE entry (markup + assets travel together — a consumer overriding a
 * section owns its styles/behavior too). Sorted (kind, id) for deterministic
 * sheet/bundle order.
 * @param {string[]} baseDirs - resolution bases in precedence order
 *   (consumer dir first, then theme layers — registerSectionTags' order)
 * @returns {Array<{kind: string, id: string, scss: string|null, js: string|null}>}
 */
function collectSectionAssets(baseDirs) {
  const entries = new Map(); // `${kind}:${id}` → {kind, id, scss, js}

  const walk = (root, dir, kind, prefix) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const id = prefix ? `${prefix}/${item.name}` : item.name;
      if (!NAME_SHAPE.test(id)) continue;
      const entryDir = path.join(dir, item.name);
      const html = path.join(entryDir, `${KINDS[kind].basename}.html`);
      if (fs.existsSync(html)) {
        const key = `${kind}:${id}`;
        if (!entries.has(key)) {
          const scss = path.join(entryDir, `${KINDS[kind].basename}.scss`);
          const js = path.join(entryDir, `${KINDS[kind].basename}.js`);
          entries.set(key, {
            kind,
            id,
            scss: fs.existsSync(scss) ? scss : null,
            js: fs.existsSync(js) ? js : null,
          });
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

  return [...entries.values()].sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id));
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
        if (!nameMatch) throw new Error(`{% ${tagName} %} needs a quoted name: {% ${tagName} "marketing/hero" %}`);
        const name = nameMatch[1] ?? nameMatch[2];
        if (!NAME_SHAPE.test(name)) throw new Error(`{% ${tagName} "${name}" %}: ids are kebab-case category paths (marketing/hero)`);

        const entry = resolveEntry(name);
        if (!entry) {
          throw new Error(`{% ${tagName} "${name}" %}: no ${kind.dirname}/${name}/${kind.basename}.html in any layer (${roots.join(', ') || 'no roots'})`);
        }

        // ---- gather passed args (inline XOR block body)
        const inlinePairs = parseInlineArgs(this.markup.slice(nameMatch[0].length));
        if (this.bodyText !== null && this.bodyText.trim() && inlinePairs.length) {
          throw new Error(`{% ${tagName} "${name}" %}: use inline args OR a YAML body, not both`);
        }

        let passed = {};
        let dataArg;
        for (const { key, expr } of inlinePairs) {
          const value = yield this.liquid.evalValue(expr, context);
          if (key === 'data') dataArg = value;
          else passed[key] = value;
        }
        if (this.bodyText !== null && this.bodyText.trim()) {
          const parsed = yaml.load(this.bodyText);
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

        // ---- schema validation (top level, warn-only)
        const schema = entry.meta.args;
        if (schema && typeof schema === 'object') {
          const known = Object.keys(schema);
          const incoming = { ...(dataArg || {}), ...passed };
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

        // ---- defaults ← data ← named args, then call-site liquification
        let args = deepMerge(entry.meta.defaults || {}, dataArg || {});
        args = deepMerge(args, passed);
        const scope = typeof context.getAll === 'function' ? context.getAll() : context.environments;
        args = yield liquifyDeep(this.liquid, scope, args);

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

  return engine;
}

module.exports = { registerSectionTags, collectSectionAssets, parseInlineArgs, levenshtein, KINDS };
