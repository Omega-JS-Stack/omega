/**
 * consumer-assets.js — the consumer asset-layer migration step (JS + CSS).
 *
 * JS: UJM consumers ship `src/assets/js/main.js` importing
 * 'ultimate-jekyll-manager' (webpack bundled the runtime through it). In
 * @omegajs/web the core asset layer OWNS main.js and the boot runtime does
 * the initialize dance — a consumer main.js SHADOWS the core one entirely.
 * - Seed-identical main.js (the untouched UJM scaffold) → deleted; the core
 *   main takes over. Detected by comment/whitespace-insensitive comparison.
 * - Customized main.js → error finding with the port recipe (compose the
 *   core main: `import coreMain from '__main_assets__/js/main.js'` inside an
 *   `export default async ({ manager, options })` module). Custom logic is
 *   not mechanically separable from the seed boilerplate.
 * - Any OTHER src/assets/js file importing 'ultimate-jekyll-manager' →
 *   error finding (no equivalent module exists to alias).
 *
 * CSS: consumers customize theme variables via
 * `@use 'ultimate-jekyll-manager' as * with ($primary: …)` in
 * `src/assets/css/main.scss`. The migrated spelling is `omega:main` — the
 * layered sass importer resolves it to the main bundle from the layers BELOW
 * the consumer (theme → core), and core main.scss forwards `omega:theme`, so
 * `with (…)` configuration reaches the theme variables. Mechanical rewrite,
 * applied to every scss file referencing the old package name.
 *
 * Page css (`css/pages/<key>.scss`): the UJM seed pulls the theme's page
 * styles with a same-name `@use 'pages/<key>'` (webpack-era single bundle).
 * The new pipeline ships theme page css as its OWN bundle
 * (pageAssets.themeCss — head.html loads both), so the self-@use would
 * double every theme rule AND self-loop through the loadPaths. The line is
 * dropped.
 *
 * Page modules (`js/pages/**`) already match the new `{ manager, options }`
 * export-default convention and import '@omegajs/client' (aliased by the asset
 * pipeline) — they port verbatim, nothing to do.
 */
const fs = require('node:fs');
const path = require('node:path');

// The UJM consumer seed, as scaffolded into every consumer
const SEED_MAIN = `
import Manager from 'ultimate-jekyll-manager';
const manager = new Manager();
manager.initialize()
.then(() => {
  console.log('Ultimate Jekyll Manager initialized successfully');
});
`;

const UJM_IMPORT = /from\s+['"]ultimate-jekyll-manager['"]|require\(\s*['"]ultimate-jekyll-manager['"]\s*\)/;
const UJM_SCSS_USE = /(@(?:use|forward|import)\s+["'])ultimate-jekyll-manager(["'])/g;

/**
 * Comment- and whitespace-insensitive normalization for seed comparison.
 */
function normalizeJs(text) {
  return text
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SEED_NORMALIZED = normalizeJs(SEED_MAIN);

/**
 * Migrate the consumer asset layer (JS deletion/flagging + scss rewrites).
 * @param {string} root - consumer project root
 * @param {object} [options]
 * @param {boolean} [options.write]
 * @returns {{ removed: string[], edits: object[], findings: object[] }}
 */
function migrateConsumerAssets(root, options = {}) {
  const assetsDir = path.join(root, 'src', 'assets');
  const removed = [];
  const edits = [];
  const findings = [];
  if (!fs.existsSync(assetsDir)) return { removed, edits, findings };

  for (const entry of fs.readdirSync(assetsDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const rel = path.relative(root, full);

    // ---- scss: rewrite the package reference to the layered importer, and
    // drop the page-css self-@use (theme page styles now load separately)
    if (entry.name.endsWith('.scss')) {
      const text = fs.readFileSync(full, 'utf8');
      let rewritten = text;

      if (UJM_SCSS_USE.test(rewritten)) {
        UJM_SCSS_USE.lastIndex = 0;
        rewritten = rewritten.replace(UJM_SCSS_USE, '$1omega:main$2');
        edits.push({ rule: 'scss-package-use', file: rel, before: "@use 'ultimate-jekyll-manager'", after: "@use 'omega:main'" });
      }

      const relCss = path.relative(path.join(assetsDir, 'css'), full);
      if (relCss.startsWith(`pages${path.sep}`)) {
        const selfKey = relCss.replace(/\.scss$/, '').split(path.sep).join('/');
        const selfUse = new RegExp(`^\\s*@use\\s+["']${selfKey}["'][^\\n]*\\n?`, 'm');
        if (selfUse.test(rewritten)) {
          rewritten = rewritten.replace(selfUse, '');
          edits.push({ rule: 'scss-page-self-use', file: rel, before: `@use '${selfKey}'`, after: '(removed — theme page css loads via pageAssets.themeCss)' });
        }
      }

      if (rewritten !== text && options.write) fs.writeFileSync(full, rewritten);
      continue;
    }

    if (!entry.name.endsWith('.js')) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (!UJM_IMPORT.test(text)) continue;

    if (rel === path.join('src', 'assets', 'js', 'main.js') && normalizeJs(text) === SEED_NORMALIZED) {
      if (options.write) fs.rmSync(full);
      removed.push(rel);
      continue;
    }

    findings.push({
      file: rel, line: 1, check: 'ujm-import', severity: 'error',
      message: rel.endsWith(`${path.sep}main.js`)
        ? 'customized main.js imports ultimate-jekyll-manager — port manually: `import coreMain from \'__main_assets__/js/main.js\'` inside `export default async (context) => { await coreMain(context); /* custom code */ }`'
        : 'imports ultimate-jekyll-manager — no such module in @omegajs/web; port to @omegajs/client or a core module',
    });
  }

  return { removed, edits, findings };
}

module.exports = { migrateConsumerAssets };
