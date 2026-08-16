// Build-layer tests for gulp/tasks/distribute.js — the static-image lane (#259).
//
// distribute used to exclude `src/**/*.{jpg,jpeg,png,gif,svg,webp}` "because
// imagemin handles them", but no imagemin task exists in this framework: a
// consumer's images never reached dist/ and every project needed a build:pre
// hook to copy them by hand. Images now copy as-is; the exclusions that DO have
// an owning task (webpack, sass, the html task) stay.
//
// The task module reads its project from cwd at REQUIRE time, so each test
// stages a temp project, chdirs into it, and requires the task fresh — the same
// model as package-task.test.js.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const SRC       = path.join(__dirname, '..', '..', '..');
const TASK_PATH = path.join(SRC, 'gulp', 'tasks', 'distribute.js');

// Stage a temp extension project. `files` is a relative-path → contents map.
function stageProject(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-distribute-task-'));

  fs.writeFileSync(path.join(tmp, 'package.json'), `{ "name": "staged-ext", "version": "3.1.4" }`);

  for (const [relative, contents] of Object.entries(files || {})) {
    const full = path.join(tmp, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }

  return tmp;
}

// Run `fn(task)` with cwd pinned to `dir` and the task module loaded fresh.
async function inProject(dir, fn) {
  const oldCwd = process.cwd();
  const flush = () => {
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(SRC + path.sep)) delete require.cache[key];
    }
  };

  flush();
  try {
    process.chdir(dir);
    return await fn(require(TASK_PATH));
  } finally {
    process.chdir(oldCwd);
    flush();
  }
}

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'distribute task — the static-image lane',
  tests: [
    {
      name: 'consumer images reach dist/ byte-for-byte (no build:pre copy hook needed)',
      run: async (ctx) => {
        // A real PNG header — proves the bytes survive the stream untouched
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
        const tmp = stageProject({
          'src/manifest.json': `{ manifest_version: 3, name: 'Staged' }`,
          'src/assets/images/mascot.png': png,
          'src/assets/images/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        });

        try {
          await inProject(tmp, async (task) => {
            await task.distribute();

            const mascot = path.join(tmp, 'dist', 'assets', 'images', 'mascot.png');
            ctx.expect(fs.existsSync(mascot)).toBe(true);
            ctx.expect(fs.readFileSync(mascot).equals(png)).toBe(true);
            ctx.expect(fs.existsSync(path.join(tmp, 'dist', 'assets', 'images', 'logo.svg'))).toBe(true);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the exclusions with an owning task stay excluded (js, scss, views html)',
      run: async (ctx) => {
        const tmp = stageProject({
          'src/manifest.json': `{ manifest_version: 3, name: 'Staged' }`,
          'src/assets/js/components/popup/index.js': `// webpack owns this\n`,
          'src/assets/css/main.scss': `// the sass task owns this\n`,
          'src/views/popup/index.html': `<!-- the html task owns this -->\n`,
        });

        try {
          await inProject(tmp, async (task) => {
            await task.distribute();

            ctx.expect(fs.existsSync(path.join(tmp, 'dist', 'assets', 'js', 'components', 'popup', 'index.js'))).toBe(false);
            ctx.expect(fs.existsSync(path.join(tmp, 'dist', 'assets', 'css', 'main.scss'))).toBe(false);
            ctx.expect(fs.existsSync(path.join(tmp, 'dist', 'views', 'popup', 'index.html'))).toBe(false);
            // …and the manifest, which no other task copies, still lands
            ctx.expect(fs.existsSync(path.join(tmp, 'dist', 'manifest.json'))).toBe(true);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
};
