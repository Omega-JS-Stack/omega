// sass — compile consumer SCSS into dist/assets/css/.
//
//   src/assets/scss/main.scss          -> dist/assets/css/main.bundle.css      (one shared bundle, every page)
//   src/assets/scss/pages/<name>.scss  -> dist/assets/css/components/<name>.bundle.css   (per-view bundle)
//
// loadPaths are configured so the consumer can write `@use 'omega-desktop' as *`:
//   - <omega-package-root>/dist/assets/css      → resolves bare 'omega-desktop' to omega-desktop.scss
//   - <omega-package-root>/dist/assets/themes/<active-theme>   → resolves bare 'theme' to <theme>/_theme.scss
//   - <omega-package-root>/dist/assets/themes   → so themes can reference each other via '../<sibling>'
//   - <output-root>/assets/scss              → resolves bare 'brand' to the generated _brand.scss (#912)
//   - <consumer>/src/assets/scss             → consumer's own modules

const Manager = new (require('../../build.js'));
const logger = Manager.logger('sass');
const path = require('path');
const jetpack = require('fs-jetpack');
const sass = require('sass');
const { formatBytes } = require('@omega.js/devkit/bundle');
const { composeBrandTokens, renderBrandScss } = require('@omega.js/devkit/brand-tokens');

const projectRoot = Manager.getRootPath('project');
const packageRoot = Manager.getRootPath('main');
const outputRoot  = require('../../utils/dist-root.js')(projectRoot);

module.exports = function sassTask(done) {
  const isProd = Manager.getMode().environment === 'production';
  const config = Manager.getConfig() || {};
  const themeId = config.theme?.id || 'classy';

  // The brand partial ([#912](https://github.com/Omega-JS-Stack/omega/issues/912)):
  // `brand.color` is the ONE accent hex, and it reaches the css through a
  // GENERATED partial rather than a literal a consumer keeps in sync by hand.
  // Written before every compile (no color resolves to the framework default,
  // whose one home is the renderer), so a config edit is the only edit.
  const brandDir = path.join(outputRoot, 'assets', 'scss');
  jetpack.write(path.join(brandDir, '_brand.scss'), renderBrandScss(composeBrandTokens(config.brand?.color)));

  const loadPaths = [
    path.join(packageRoot, 'dist', 'assets', 'css'),                    // for `@use 'omega-desktop'`
    path.join(packageRoot, 'dist', 'assets', 'themes', themeId),        // for `@use 'theme'`
    path.join(packageRoot, 'dist', 'assets', 'themes'),                 // for sibling-theme references
    brandDir,                                                           // for `@use 'brand'` (generated above)
    path.join(projectRoot, 'src', 'assets', 'scss'),                    // consumer's own scss tree
  ];

  const compileOpts = {
    style:     isProd ? 'compressed' : 'expanded',
    sourceMap: !isProd,
    loadPaths,
    // Suppress noisy deprecation warnings inherited from the vendored classy + Bootstrap 5.3 source.
    // These are functional today (Dart Sass 1.x) and will be fixed when classy migrates to the
    // modern @use/@forward + sass:color module system upstream. Until then, drowning in warnings
    // every build hides real errors.
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'if-function'],
  };

  // Compile main.scss → main.bundle.css
  const mainEntry = path.join(projectRoot, 'src', 'assets', 'scss', 'main.scss');
  const mainOut = path.join(outputRoot, 'assets', 'css', 'main.bundle.css');

  try {
    if (jetpack.exists(mainEntry)) {
      const result = sass.compile(mainEntry, compileOpts);
      jetpack.write(mainOut, result.css);
      if (result.sourceMap) jetpack.write(`${mainOut}.map`, JSON.stringify(result.sourceMap));
      logger.log(`built dist/assets/css/main.bundle.css (${formatBytes(result.css.length)})`);
    } else {
      logger.warn(`No main scss entry at ${mainEntry} — skipping main bundle.`);
    }

    // Compile per-page entries: src/assets/scss/pages/<name>.scss → dist/assets/css/components/<name>.bundle.css
    const pagesDir = path.join(projectRoot, 'src', 'assets', 'scss', 'pages');
    if (jetpack.exists(pagesDir)) {
      const pageFiles = jetpack.find(pagesDir, { matching: '**/*.scss', recursive: true })
        .filter((f) => !path.basename(f).startsWith('_'));   // skip partials

      for (const src of pageFiles) {
        const rel = path.relative(pagesDir, src);
        const name = rel.replace(/\.scss$/, '').replace(/\\/g, '/');
        const out = path.join(outputRoot, 'assets', 'css', 'components', `${name}.bundle.css`);
        const result = sass.compile(src, compileOpts);
        jetpack.write(out, result.css);
        if (result.sourceMap) jetpack.write(`${out}.map`, JSON.stringify(result.sourceMap));
        logger.log(`built dist/assets/css/components/${name}.bundle.css (${formatBytes(result.css.length)})`);
      }
    }

    done();
  } catch (e) {
    logger.error('sass compile failed:', e.message || e);
    done(e);
  }
};
