/**
 * scaffold-copies tests: a scaffolded doc has one source.
 *
 * A framework's defaults tree (`src/defaults/`, web's `scaffold/`) holds the
 * one source of the `test/README.md` every target of that framework carries. The scaffold walk
 * marker-merges it on every verb: the framework owns the Default section, the
 * target owns the Custom section. A tracked copy whose Default section drifts
 * from its source was edited by hand, and fails here.
 *
 * Run: node --test scripts/scaffold-copies.test.js
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { mergeLineBasedFiles, hasSectionMarkers } = require(path.join(ROOT, 'packages', 'devkit', 'src', 'merge-line-files.js'));

const DOC = 'test/README.md';

// Where a framework's defaults tree lives: web ships its as `scaffold/`.
const TREES = [path.join('src', 'defaults'), 'scaffold'];

// The frameworks that scaffold the doc, by the source their defaults tree ships.
function sources() {
  return fs.readdirSync(path.join(ROOT, 'packages'))
    .flatMap((name) => TREES.map((tree) => ({ framework: `@omega.js/${name}`, file: path.join(ROOT, 'packages', name, tree, DOC) })))
    .filter(({ file }) => fs.existsSync(file));
}

// Every tracked brand-target copy, with the framework its target depends on.
function copies() {
  return execFileSync('git', ['ls-files', '-z', '--', `brands/*/targets/*/${DOC}`], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map((relative) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, relative.slice(0, -DOC.length), 'package.json'), 'utf8'));
      const deps = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
      return { relative, deps };
    });
}

module.exports = defineCases({
  type: 'group',
  description: 'scaffold-copies',
  tests: [
    {
      name: 'every scaffold source speaks the markdown marker grammar',
      run: (ctx) => {
        const found = sources();
        ctx.expect(found.map(({ framework }) => framework).sort()).toEqual(['@omega.js/backend', '@omega.js/desktop', '@omega.js/extension', '@omega.js/web']);
        for (const { file } of found) {
          ctx.expect(hasSectionMarkers(fs.readFileSync(file, 'utf8'), 'README.md'), `${path.relative(ROOT, file)} carries no Default/Custom markers, so the merge would wipe every copy`).toBeTruthy();
        }
      },
    },

    {
      name: 'every tracked copy is exactly what the scaffold walk writes from its source',
      run: (ctx) => {
        const bySource = new Map(sources().map(({ framework, file }) => [framework, fs.readFileSync(file, 'utf8')]));
        const found = copies();
        ctx.expect(found.length > 0, 'no tracked copy found: the glob is wrong').toBeTruthy();
        for (const { relative, deps } of found) {
          const owners = deps.filter((dep) => bySource.has(dep));
          ctx.expect(owners.length, `${relative}: its target depends on no framework (or several) that scaffolds ${DOC}`).toBe(1);
          const copy = fs.readFileSync(path.join(ROOT, relative), 'utf8');
          const walked = mergeLineBasedFiles(copy, bySource.get(owners[0]), 'README.md');
          ctx.expect(copy, `${relative} drifted from its source: edit the source in its framework's defaults tree, never the copy`).toBe(walked);
        }
      },
    },
  ],
});
