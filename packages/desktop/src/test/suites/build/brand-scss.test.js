// Build-layer proof for the generated brand partial
// ([#912](https://github.com/Omega-JS-Stack/omega/issues/912)): ONE hex in
// `brand.color` decides both the compile-time accent Bootstrap derives from and
// the runtime --omega-accent ramp, on a real fixture project through the real
// sass task.
//
// Offline by construction: a temp consumer dir with a config and the scaffold's
// own main.scss, compiled against this package's dist assets.

const fs = require('fs');
const os = require('os');
const path = require('path');
const jetpack = require('fs-jetpack');
const defineCases = require('@omega.js/devkit/test/define-cases');

const SRC = path.join(__dirname, '..', '..', '..');
const SCAFFOLD_MAIN = path.join(SRC, 'defaults', 'src', 'assets', 'scss', 'main.scss');

/** A consumer whose main.scss is the one the scaffold ships. */
function stageConsumer(color) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-brand-scss-'));
  const brand = color ? `{ id: "fixture", color: "${color}" }` : '{ id: "fixture" }';

  jetpack.write(path.join(tmp, 'config', 'omega.json5'), `{ brand: ${brand}, targets: { desktop: {} } }`);
  jetpack.copy(SCAFFOLD_MAIN, path.join(tmp, 'src', 'assets', 'scss', 'main.scss'));

  return tmp;
}

/**
 * Run the sass task with the fixture as the project root. Both the task and the
 * build module resolve that root at REQUIRE time, so each run gets a fresh
 * copy of both.
 */
function runSassIn(dir) {
  const oldCwd = process.cwd();
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}build.js`) || key.endsWith(`tasks${path.sep}sass.js`)) delete require.cache[key];
  }

  try {
    process.chdir(dir);
    const sassTask = require(path.join(SRC, 'gulp', 'tasks', 'sass.js'));
    return new Promise((resolve, reject) => sassTask((error) => (error ? reject(error) : resolve())));
  } finally {
    process.chdir(oldCwd);
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'brand scss (#912): brand.color drives $primary and the runtime accent ramp',
  tests: [
    {
      name: 'brand.color writes the partial and paints the compiled bundle',
      run: async (ctx) => {
        const dir = stageConsumer('#ff0066');

        try {
          await runSassIn(dir);

          const partial = fs.readFileSync(path.join(dir, 'dist', 'assets', 'scss', '_brand.scss'), 'utf8');
          ctx.expect(partial.includes('$primary: #ff0066;')).toBe(true);

          const css = fs.readFileSync(path.join(dir, 'dist', 'assets', 'css', 'main.bundle.css'), 'utf8');

          // Bootstrap's primary compiled from the same hex...
          ctx.expect(css.includes('--bs-primary: #ff0066')).toBe(true);

          // ...and the runtime ramp, AFTER the token sheet's placeholder so it
          // wins the cascade (a used module's css emits at its load position,
          // which is why the scaffold includes the mixin instead).
          ctx.expect(css.includes('--omega-accent: #ff0066')).toBe(true);
          ctx.expect(css.includes('--omega-accent-hover: #db0058')).toBe(true);
          ctx.expect(css.lastIndexOf('--omega-accent: #ff0066') > css.lastIndexOf('--omega-accent: #2563eb')).toBe(true);

          // The dark variant rides the same stamps as the token sheet.
          ctx.expect(/@media \(prefers-color-scheme: dark\)[\s\S]*?--omega-accent: #ff3385/.test(css)).toBe(true);
          ctx.expect(/\[data-bs-theme=["']?dark["']?\][\s\S]*?--omega-accent: #ff3385/.test(css)).toBe(true);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'no brand.color compiles on the framework default',
      run: async (ctx) => {
        const dir = stageConsumer(null);

        try {
          await runSassIn(dir);

          const partial = fs.readFileSync(path.join(dir, 'dist', 'assets', 'scss', '_brand.scss'), 'utf8');
          ctx.expect(partial.includes('$primary: #2563eb;')).toBe(true);

          const css = fs.readFileSync(path.join(dir, 'dist', 'assets', 'css', 'main.bundle.css'), 'utf8');
          ctx.expect(css.includes('--bs-primary: #2563eb')).toBe(true);
          ctx.expect(css.includes('--omega-accent: #2563eb')).toBe(true);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      },
    },
  ],
});
