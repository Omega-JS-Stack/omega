// Audit — fail-fast schema + filesystem checks for the consumer's config/omega.json5.
//
// Runs as part of `gulp build` between sass/bundle/html and build-config. Catches the
// "I forgot to set X" / "icon path is wrong" / "main entry was renamed" footguns at build time
// rather than letting them reach electron-builder (where the error messages are useless).
//
// Failure mode: collects every problem into a single thrown Error with a numbered list.
// One error per problem so the consumer can fix them all in one shot instead of fix-rebuild-fix.
//
// Categories of check:
//   - REQUIRED config keys present (brand.id, brand.name).
//     app.appId / app.productName are optional — derived from brand.id / brand.name if unset.
//   - File existence for any path-shaped config value (brand.images.icon).
//   - Format checks for fields with constrained shapes (brand.id as URL scheme, startup.mode, signing strategy).
//   - Consumer entrypoints exist (src/main.js, src/preload.js) — these are what the `bundle` task hands to esbuild.
//   - In publish mode, the releases repo RESOLVES (@omega.js/config's releasesRepo:
//     `<brand.id>-releases` under the brand repo owner unless config names another)
//     and electron-builder.yml exists.

const path    = require('path');
const jetpack = require('fs-jetpack');
const build = require('../../build.js');
const { validateConfig, releasesRepo, hasOmegaConfig, loadConfig } = require('@omega.js/config');

const logger = build.logger('audit');

module.exports = function audit(done) {
  const cwd      = process.cwd();
  const config   = build.getConfig();
  const errors   = [];
  const warnings = [];

  function fileMustExist(rel, label) {
    if (!rel) return;
    const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
    if (!jetpack.exists(abs)) errors.push(`${label} not found at ${rel}`);
  }

  // 1. Schema-driven config validation. Single source of truth in @omega.js/config
  // (shared schema + the desktop target refinements).
  const { errors: schemaErrors } = validateConfig(config, { target: 'desktop' });
  errors.push(...schemaErrors);

  // ...and the validator's WARNINGS, which this task used to drop on the floor
  // while reporting `0 warnings` ([#911](https://github.com/Omega-JS-Stack/omega/issues/911)).
  // A key the schema does not declare is what a typo looks like, and the
  // consumer has to see it at build time. They come off the LOAD, the same
  // resolution `build.getConfig()` runs: loadConfig judges what the brand
  // AUTHORED, before the loader fills its own resolved facts (`company.name`
  // and friends) and before the build attaches `environment`.
  const { warnings: configWarnings } = hasOmegaConfig(cwd)
    ? loadConfig(cwd, 'desktop', { environment: build.getEnvironment() })
    : { warnings: [] };
  warnings.push(...configWarnings);

  // 2. File existence for paths the build references (not in schema because these are
  // tied to the build pipeline, not the config shape).
  fileMustExist('src/main.js',    'src/main.js');
  fileMustExist('src/preload.js', 'src/preload.js');
  if (build.isPublishMode() || build.isBuildMode()) {
    // Icon must exist when packaging — dev runs fine with the default Electron icon.
    fileMustExist(config.brand.images?.icon, 'config.brand.images.icon');
  }
  // Publishing needs an ADDRESS for the releases repo, and no repo name is ever
  // typed: @omega.js/config's releasesRepo derives `<brand.id>-releases` under
  // the brand's org, so only a missing org (or brand.id) leaves it unaddressable.
  if (build.isPublishMode() && config.releases?.enabled !== false && !releasesRepo(config)) {
    errors.push('the releases repo is unaddressable: set repo.org and brand.id. The repo is always "<brand.id>-releases" under that org');
  }

  // 3. Soft warnings — not fatal but worth surfacing.
  if (config.brand.id === 'myapp' || config.brand.name === 'MyApp') {
    warnings.push('config still uses the scaffold defaults ("myapp" / "MyApp") — set brand.id and brand.name before publishing.');
  }

  // MAS distribution — currently STUBBED. Surface a warning if a consumer tries to
  // turn it on so they know it's not yet wired up.
  if (config.platforms?.mac?.mas?.enabled === true) {
    warnings.push('platforms.mac.mas.enabled is true but Mac App Store distribution is not yet implemented in @omega.js/desktop (the config keys are reserved for a future release). The standard mac DMG/zip targets will still build normally — the MAS variant is silently skipped.');
  }

  // Report.
  for (const w of warnings) {
    logger.warn(w);
  }

  if (errors.length > 0) {
    const numbered = errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
    return done(new Error(`audit failed — fix the following before continuing:\n${numbered}`));
  }

  logger.log(`audit ok (${warnings.length} warning${warnings.length === 1 ? '' : 's'})`);
  done();
};
