/**
 * A page under `src/pages/` with no permalink serves at its file path (#954):
 * `pages/notes.md` is `/notes`, a nested page keeps its folders, and an
 * `index` file serves its folder. The emitted file follows the URL contract
 * exactly as an explicit permalink does (`notes.html` on disk, `page.url`
 * extensionless, no trailing slash), and an explicit permalink still wins.
 * A paginated page serves page 1 at its file path and page N under it
 * (`/chapters`, `/chapters/2`), one flat `.html` per page.
 *
 * One mini site holds the static pages and a second the paginated one, so a
 * failure in either never masks the other. Each page prints the `page.url`
 * its template sees: the cases pin both the file written and the URL served.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { setEnvironment } = require('@omega.js/config/environment');
const { configureOmega } = require('../src/index.js');
const { pageUrlFromPath } = require('../src/page-url.js');
const { BARE, PKG } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));
const NAME = 'page-url-default';
const OUT = path.join(PKG, '.omega', `${NAME}-out`);

// Each page renders the URL its own template sees.
const page = (frontmatter) => ['---', ...frontmatter, '---', '<p id="page-url">{{ page.url }}</p>', ''].join('\n');

const PAGES = {
  'pages/notes.md': page(['meta:', '  title: Notes']),
  'pages/guides/intro.md': page(['meta:', '  title: Intro']),
  'pages/index.md': page(['meta:', '  title: Home']),
  'pages/moved.md': page(['permalink: /elsewhere', 'meta:', '  title: Moved']),
};

const PAGINATED = {
  'pages/chapters.md': page(['pagination:', '  data: chapters', '  size: 1', 'meta:', '  title: Chapters']),
  '_data/chapters.json': JSON.stringify(['one', 'two']),
};

const SITES = { static: PAGES, paginated: PAGINATED };
const built = {};

/**
 * Build one named consumer once (lib/build.js shape, keeping each result's
 * output path) and index the results by their source file, one entry per output.
 * @param {string} site - a SITES key
 * @returns {Promise<Map<string, Array<{ file: string, url: string, rendered: string }>>>}
 */
function build(site) {
  const files = SITES[site];
  built[site] = built[site] || (async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-page-url-'));
    const consumerDir = path.join(tmp, 'src');
    try {
      for (const [relative, contents] of Object.entries(files)) {
        const abs = path.join(consumerDir, relative);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, contents);
      }

      setEnvironment('development');
      const Eleventy = require('@11ty/eleventy').default;
      const out = path.join(OUT, site);
      const elev = new Eleventy(consumerDir, out, {
        quietMode: true,
        configPath: false,
        config: (eleventyConfig) => {
          eleventyConfig.setUseTemplateCache(false);
          return configureOmega(eleventyConfig, {
            consumerDir,
            siteData: bareData,
            farmDir: path.join(PKG, '.omega', `${NAME}-${site}-farm`),
            assetManifest: { js: { pages: {} }, css: { main: '/assets/css/main-TEST.css', pages: {}, layouts: {} } },
          });
        },
      });

      const results = await elev.toJSON();
      const bySource = new Map();
      for (const result of results) {
        const source = path.relative(consumerDir, path.resolve(result.inputPath)).split(path.sep).join('/');
        if (!(source in files)) continue;
        if (!bySource.has(source)) bySource.set(source, []);
        bySource.get(source).push({
          file: typeof result.outputPath === 'string' ? path.relative(out, result.outputPath).split(path.sep).join('/') : result.outputPath,
          url: result.url,
          rendered: (String(result.content).match(/<p id="page-url">([^<]*)<\/p>/) || [])[1],
        });
      }
      return bySource;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })();
  return built[site];
}

/** The first output a source page built, or undefined. */
const outputOf = async (source) => ((await build('static')).get(source) || [])[0];

module.exports = defineCases({
  type: 'group',
  description: 'page-url-default',
  tests: [
    {
      name: '#954: pageUrlFromPath derives the URL from the path under pages/',
      run: (ctx) => {
        ctx.expect(pageUrlFromPath('_posts/2024-01-01-hello.md'), 'a file outside pages/ has no path URL').toBe(null);
        ctx.expect(pageUrlFromPath('pages/guides/index.md'), 'index collapses to its folder').toBe('/guides');
        ctx.expect(pageUrlFromPath('pages/index.md')).toBe('/');
        ctx.expect(pageUrlFromPath('pages/a/b/c.html')).toBe('/a/b/c');
        ctx.expect(pageUrlFromPath('pages\\a\\b\\c.html'), 'Windows separators give the same URL').toBe('/a/b/c');
      },
    },

    {
      name: '#954: a permalink-less page serves at its file path',
      run: async (ctx) => {
        const notes = await outputOf('pages/notes.md');

        ctx.expect(notes, 'pages/notes.md built').toBeTruthy();
        ctx.expect(notes.file, 'flat .html on disk, never pages/notes/index.html').toBe('notes.html');
        ctx.expect(notes.url, 'page.url is extensionless with no trailing slash').toBe('/notes');
        ctx.expect(notes.rendered, 'the template sees the same URL').toBe('/notes');
      },
    },

    {
      name: '#954: a nested permalink-less page keeps its folders',
      run: async (ctx) => {
        const intro = await outputOf('pages/guides/intro.md');

        ctx.expect(intro, 'pages/guides/intro.md built').toBeTruthy();
        ctx.expect(intro.file).toBe('guides/intro.html');
        ctx.expect(intro.url).toBe('/guides/intro');
        ctx.expect(intro.rendered).toBe('/guides/intro');
      },
    },

    {
      name: '#954: a permalink-less index page serves its folder',
      run: async (ctx) => {
        const home = await outputOf('pages/index.md');

        ctx.expect(home, 'pages/index.md built').toBeTruthy();
        ctx.expect(home.file).toBe('index.html');
        ctx.expect(home.url, 'index collapses to its folder, the site root').toBe('/');
        ctx.expect(home.rendered).toBe('/');
      },
    },

    {
      name: '#954: an explicit permalink wins over the file path',
      run: async (ctx) => {
        const moved = await outputOf('pages/moved.md');

        ctx.expect(moved, 'pages/moved.md built').toBeTruthy();
        ctx.expect(moved.file).toBe('elsewhere.html');
        ctx.expect(moved.url, 'the permalink, never /moved').toBe('/elsewhere');
        ctx.expect(moved.rendered).toBe('/elsewhere');
      },
    },

    {
      name: '#954: a paginated page with no permalink serves at its file path, one URL per page',
      run: async (ctx) => {
        const chapters = ((await build('paginated')).get('pages/chapters.md') || [])
          .slice().sort((a, b) => a.url.localeCompare(b.url));

        ctx.expect(chapters.length, 'one output per chapter').toBe(2);
        ctx.expect(chapters.map((output) => output.file), 'page 1 at the file path, page N under it').toEqual(['chapters.html', 'chapters/2.html']);
        ctx.expect(chapters.map((output) => output.url)).toEqual(['/chapters', '/chapters/2']);
        ctx.expect(chapters.map((output) => output.rendered), 'each template sees its own URL').toEqual(['/chapters', '/chapters/2']);
      },
    },
  ],
});
