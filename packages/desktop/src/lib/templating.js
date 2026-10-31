// Templating — the page-vars assembly for HTML views at build time.
//
// Tokens render through devkit's ONE `{{ path }}` renderer (@omega.js/devkit/tokens);
// this module adds the standard variable scope built from omega.config + page metadata.
// Public API, the `@omega.js/desktop/lib/templating` export (gulp/html requires it directly):
//   render(input, vars)               // arbitrary string + arbitrary vars
//   buildPageVars(pageName, extras)   // produces { brand, app, page, theme, cacheBust }
//   renderPage(pageTemplate, vars)    // render the outer page shell

const LoggerLite = require('./logger-lite.js');
const { renderTokens } = require('@omega.js/devkit/tokens');

const logger = new LoggerLite('templating');

const templating = {
  _initialized: false,
  _omega:       null,

  initialize(omega) {
    templating._omega = omega;
    templating._initialized = true;
    logger.log('initialize');
  },

  // Render an arbitrary template string's {{ }} tokens with the given vars; a token
  // nothing resolves stays as written (unresolvedTokens names it).
  render(input, vars) {
    return renderTokens(String(input || ''), vars || {});
  },

  // Build the standard variable scope for a page render. Combines omega.config with
  // page-specific metadata + cache-buster for asset URLs.
  // `omega` is optional: buildPageVars works at build time (where the build module from
  // build.js stands in) without needing the runtime omega instance.
  buildPageVars(pageName, extras, omega) {
    omega = omega || templating._omega;
    const cfg = (omega && omega.config) || (omega && typeof omega.getConfig === 'function' ? omega.getConfig() : {}) || {};
    // Pull version from the consumer's package.json at build time. This baked-in
    // string is used by templates that want to display the running version in the
    // UI (e.g. "v1.0.5" in a footer). At runtime it always matches the version
    // that was packaged + signed + uploaded, since both come from the same
    // package.json read.
    const pkg = (omega && typeof omega.getPackage === 'function' ? omega.getPackage('project') : null) || {};
    const appBlock = { ...(cfg.app || {}) };
    if (pkg.version && !appBlock.version) appBlock.version = pkg.version;
    const vars = {
      brand: cfg.brand   || {},
      app:   appBlock,
      // 'system' is inert as a data-bs-theme value (Bootstrap knows light/dark only) —
      // the preload's theme applier replaces it with the RESOLVED appearance at runtime.
      theme: { appearance: cfg.theme?.appearance || 'system' },
      page: {
        name:  pageName,
        title: (extras && extras.title) || cfg.app?.productName || cfg.brand?.name || 'App',
      },
      cacheBust: String((extras && extras.cacheBust) || Date.now()),
      // Slot for the body content. gulp/html sets this after rendering the inner view.
      content: (extras && extras.content) || '',
    };
    if (extras && typeof extras === 'object') {
      // Merge any extra keys (e.g. content), but don't clobber the structured groups above
      // unless explicitly provided.
      for (const [k, v] of Object.entries(extras)) {
        if (v !== undefined) vars[k] = v;
      }
    }
    return vars;
  },

  // Convenience: render a page template (outer shell) with the given vars.
  renderPage(pageTemplate, vars) {
    return templating.render(pageTemplate, vars);
  },
};

module.exports = templating;
