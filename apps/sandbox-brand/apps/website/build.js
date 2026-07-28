/**
 * Build the sandbox website: bundle src/assets/main.js (which embeds @omega.js/client)
 * with esbuild and copy static pages into dist/.
 *
 * Inside the Omega monorepo all dependencies (esbuild, @omega.js/client, firebase)
 * resolve from the workspace root via Node's directory climb — no per-app install.
 */
const path = require('path');
const esbuild = require('esbuild');
const jetpack = require('fs-jetpack');

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

async function build() {
  jetpack.remove(DIST);
  jetpack.copy(path.join(SRC, 'pages'), DIST);

  await esbuild.build({
    entryPoints: [path.join(SRC, 'assets', 'main.js')],
    bundle: true,
    format: 'iife',
    outfile: path.join(DIST, 'assets', 'main.js'),
    alias: {
      // The web framework's chart helper, reached by name instead of by a
      // six-deep relative climb. `@omega.js/web` declares an export map, so a
      // deep import of core/ is not reachable through the package name — and
      // this fixture is inside the monorepo, where the source always is.
      '@omega.js/web-charts': path.join(__dirname, '..', '..', '..', '..', 'packages', 'web', 'core', 'js', 'libs', 'charts.js'),
    },
  });

  console.log(`Built sandbox website → ${DIST}`);
}

if (require.main === module) {
  build().catch((error) => {
    console.error('Build failed:', error);
    process.exit(1);
  });
}

module.exports = build;
