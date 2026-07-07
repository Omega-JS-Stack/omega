/**
 * register-liquid.js — the LiquidJS engine adapter.
 *
 * Registers every uj_* filter, every uj tag (including the unprefixed
 * iftruthy/iffalsy/iffile/urlmatches), and the Jekyll-compat pack on a
 * LiquidJS engine — the binding layer for Eleventy's Liquid or a standalone
 * Liquid instance. Astro/direct consumers skip this file and import the
 * plain functions instead.
 *
 * Usage:
 *   const { Liquid } = require('liquidjs');
 *   const { registerLiquid } = require('@omegajs/template-kit');
 *   const engine = new Liquid({ jekyllInclude: true });
 *   registerLiquid(engine, {
 *     site: siteGlobal,                    // the site.* object (url, translation, icons.style, …)
 *     getCollection: (name) => [...],      // docs shaped { id, url, data }
 *     fileExists: (path) => boolean,       // iffile backing
 *     markdown: (content) => html,         // markdownify / uj_content_format
 *     icons: { fontAwesomeDir, flagsDir }, // uj_icon SVG roots
 *     logos: { dir },                      // uj_logo SVG root
 *   });
 */

// Libraries
const { FILTER_NAMES, createIncrementReturn } = require('./filters.js');
const { TAGS } = require('./tags/index.js');
const { COMPAT_NAMES, createRelativeUrl, createAbsoluteUrl, createMarkdownify } = require('./jekyll-compat.js');

// Per-render-context counters for uj_increment_return
const incrementRegisters = new WeakMap();

/**
 * Build the variable-lookup function for a LiquidJS render context.
 * @param {object} context - LiquidJS Context
 * @returns {function} (dotPath) => value | undefined
 */
function buildLookup(context) {
  return (dotPath) => {
    try {
      return context.getSync(String(dotPath).split('.'));
    } catch {
      return undefined;
    }
  };
}

/**
 * Collect the full scope of a LiquidJS render context (globals + locals).
 * @param {object} context - LiquidJS Context
 * @returns {object}
 */
function contextScope(context) {
  return typeof context.getAll === 'function' ? context.getAll() : context.environments;
}

/**
 * Build the engine-neutral tag ctx from a LiquidJS render context.
 */
function buildTagCtx(context, options) {
  const lookup = buildLookup(context);
  return {
    lookup,
    page: lookup('page') || null,
    site: {
      config: options.site || lookup('site') || {},
      getCollection: options.getCollection || (() => []),
      getCollectionNames: options.getCollectionNames || (() => []),
      fileExists: options.fileExists || (() => false),
    },
    options,
  };
}

/**
 * Register all template-kit filters and tags on a LiquidJS engine.
 * @param {object} engine - LiquidJS engine instance
 * @param {object} [options] - see the usage block above
 * @returns {object} the engine (chainable)
 */
function registerLiquid(engine, options = {}) {
  // --- Context-free uj_* filters ---
  for (const [name, fn] of Object.entries(FILTER_NAMES)) {
    engine.registerFilter(name, fn);
  }

  // --- Context-coupled uj_* filters ---
  engine.registerFilter('uj_increment_return', function (input) {
    if (!incrementRegisters.has(this.context)) incrementRegisters.set(this.context, {});
    return createIncrementReturn(() => incrementRegisters.get(this.context))(input);
  });

  engine.registerFilter('uj_liquify', async function (input, maxDepth = 10) {
    return liquifyWithContext(this.liquid, this.context, input, maxDepth);
  });

  engine.registerFilter('uj_content_format', async function (input) {
    if (input === null || input === undefined || input === false) return '';

    const liquified = await liquifyWithContext(this.liquid, this.context, input, 10);
    const page = buildLookup(this.context)('page');

    if (page && page.extension === '.md' && options.markdown) {
      return options.markdown(liquified);
    }
    return liquified;
  });

  // --- Jekyll-compat filters ---
  for (const [name, fn] of Object.entries(COMPAT_NAMES)) {
    engine.registerFilter(name, fn);
  }
  engine.registerFilter('relative_url', createRelativeUrl(options.site));
  engine.registerFilter('absolute_url', createAbsoluteUrl(options.site));
  engine.registerFilter('markdownify', createMarkdownify(options.markdown));

  // --- Tags ---
  for (const [name, def] of Object.entries(TAGS)) {
    registerTag(engine, name, def, options);
  }

  return engine;
}

/**
 * Recursive liquify against the caller's render context.
 */
async function liquifyWithContext(liquid, context, input, maxDepth) {
  if (input === null || input === undefined || input === false) return '';

  const scope = contextScope(context);
  let result = String(input);
  let depth = 0;

  while ((result.includes('{{') || result.includes('{%')) && depth < maxDepth) {
    const next = await liquid.parseAndRender(result, scope);
    if (next === result) break;
    result = next;
    depth++;
  }

  return result;
}

/**
 * Register one engine-neutral tag definition as a LiquidJS tag.
 */
function registerTag(engine, name, def, options) {
  engine.registerTag(name, {
    parse(tagToken, remainTokens) {
      this.markup = String(tagToken.args || '').trim();
      if (!def.block) return;

      this.tpls = [];
      let closed = false;
      while (remainTokens.length) {
        const token = remainTokens.shift();
        if (token.name === `end${name}`) {
          closed = true;
          break;
        }
        this.tpls.push(this.liquid.parser.parseToken(token, remainTokens));
      }
      if (!closed) throw new Error(`tag {% ${name} %} not closed`);
    },

    * render(context, emitter) {
      const ctx = buildTagCtx(context, options);

      let innerHtml = '';
      if (def.block) {
        innerHtml = yield this.liquid.renderer.renderTemplates(this.tpls, context);
      }

      emitter.write(def.render(ctx, this.markup, () => innerHtml));
    },
  });

  return engine;
}

module.exports = { registerLiquid, buildLookup, buildTagCtx };
