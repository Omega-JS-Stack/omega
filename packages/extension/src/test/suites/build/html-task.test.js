// Build-layer tests for gulp/tasks/html.js: a view renders through the two-step
// page template, and a `{{ }}` token still unresolved in a rendered page fails the
// build naming the file and the token. Each test stages a temp project and runs
// the task fresh inside it (utils/package-project.js).

const path = require('path');
const fs   = require('fs');
const gulp = require('gulp');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { SRC, stageProject, inProject } = require('../../utils/package-project.js');

const TASK_PATH = path.join(SRC, 'gulp', 'tasks', 'html.js');

const CONFIG = `{ brand: { id: 'staged', name: 'Staged Brand', url: 'https://staged.example.com' }, targets: { extension: { type: 'extension' } } }`;

// The lane keys the task's build module reads at load, saved and restored around each run.
const LANE_KEYS = ['OMEGA_BUILD_MODE', 'OMEGA_ENVIRONMENT'];

/**
 * Run the html task over the views in `files`, in a staged project, in build mode so its watcher stands down.
 * @param {object} files - relative path to contents, the project's views.
 * @returns {Promise<{tmp: string, failure: *}>} the project and what the task completed with.
 */
async function runHtml(files) {
  const tmp = stageProject({ config: CONFIG, files });
  const previous = Object.fromEntries(LANE_KEYS.map((key) => [key, process.env[key]]));
  delete process.env.OMEGA_ENVIRONMENT;
  process.env.OMEGA_BUILD_MODE = 'true';
  // A failed task is also emitted on the gulp instance, where gulp's CLI listens;
  // with no listener the emit throws instead of the series completing with it
  const listener = () => {};
  gulp.on('error', listener);
  try {
    const failure = await inProject(tmp, (task) => new Promise((resolve) => task(resolve)), TASK_PATH);
    return { tmp, failure };
  } finally {
    gulp.off('error', listener);
    for (const key of LANE_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'html task: views render through the page template, and a leftover token fails the build',
  tests: [
    {
      name: 'a view with an unresolved {{ missing }} token fails the build, naming the file and the token',
      run: async (ctx) => {
        const { tmp, failure } = await runHtml({
          'src/views/orphan/index.html': '<h1>{{ brand.name }}</h1>\n<p>{{ missing }}</p>\n',
        });
        try {
          ctx.expect(failure).toBeInstanceOf(Error);
          ctx.expect(failure.message).toContain('orphan');
          ctx.expect(failure.message).toContain('missing');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a fully resolved view renders into dist/views with its tokens filled',
      run: async (ctx) => {
        const { tmp, failure } = await runHtml({
          'src/views/popup/index.html': '<h1>{{ brand.name }}</h1>\n',
        });
        try {
          ctx.expect(failure).toBeFalsy();
          const page = fs.readFileSync(path.join(tmp, 'dist', 'views', 'popup', 'index.html'), 'utf8');
          ctx.expect(page).toContain('<h1>Staged Brand</h1>');
          ctx.expect(page).not.toContain('{{');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});
