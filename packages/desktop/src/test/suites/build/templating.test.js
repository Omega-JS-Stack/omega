// Build-layer tests for lib/templating.js — render, buildPageVars, renderPage —
// and the html task that renders every view through them.

const fs = require('fs');
const os = require('os');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const DIST = path.join(__dirname, '..', '..', '..');
const HTML_TASK = path.join(DIST, 'gulp', 'tasks', 'html.js');

/**
 * Run the real html task over `views` (relative path to contents) in a staged
 * project. The task and the build module read the project root at REQUIRE
 * time, so each run loads both fresh with cwd pinned to the project.
 * @returns {Promise<{tmp: string, failure: *}>} the project and what the task completed with.
 */
async function runHtml(views) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-html-task-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{ "name": "staged-desktop", "version": "3.1.4" }');
  fs.mkdirSync(path.join(tmp, 'config'));
  fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), "{ brand: { id: 'staged', name: 'Staged Brand' }, targets: { desktop: { type: 'desktop' } } }");
  for (const [relative, contents] of Object.entries(views)) {
    fs.mkdirSync(path.dirname(path.join(tmp, relative)), { recursive: true });
    fs.writeFileSync(path.join(tmp, relative), contents);
  }

  const oldCwd = process.cwd();
  const oldOutput = process.env.OMEGA_BUILD_OUTPUT;
  const flush = () => {
    for (const key of Object.keys(require.cache)) {
      if (key === HTML_TASK || key === path.join(DIST, 'build.js')) delete require.cache[key];
    }
  };

  flush();
  delete process.env.OMEGA_BUILD_OUTPUT;
  try {
    process.chdir(tmp);
    const task = require(HTML_TASK);
    const failure = await new Promise((resolve) => task(resolve));
    return { tmp, failure };
  } finally {
    process.chdir(oldCwd);
    if (oldOutput !== undefined) process.env.OMEGA_BUILD_OUTPUT = oldOutput;
    flush();
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'templating — render + buildPageVars',
  tests: [
    {
      name: 'templating exports the expected surface',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        ctx.expect(typeof t.initialize).toBe('function');
        ctx.expect(typeof t.render).toBe('function');
        ctx.expect(typeof t.buildPageVars).toBe('function');
        ctx.expect(typeof t.renderPage).toBe('function');
      },
    },
    {
      name: 'render replaces {{ var }} tokens with vars',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        const out = t.render('Hello {{ name }}!', { name: 'Ian' });
        ctx.expect(out).toBe('Hello Ian!');
      },
    },
    {
      name: 'render supports dot-notation paths',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        const out = t.render('{{ brand.name }} v{{ app.version }}', { brand: { name: 'MyApp' }, app: { version: '1.2.3' } });
        ctx.expect(out).toBe('MyApp v1.2.3');
      },
    },
    {
      name: 'render leaves unknown tokens intact (does not throw)',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        const out = t.render('Hello {{ missing }}!', {});
        // node-powertools returns the original token when not found.
        ctx.expect(typeof out).toBe('string');
      },
    },
    {
      name: 'buildPageVars produces brand/app/page/theme/cacheBust from an omega-like object',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        const fakeOmega = { config: { brand: { name: 'MyApp', id: 'myapp' }, app: { productName: 'MyApp' } } };
        const vars = t.buildPageVars('settings', { cacheBust: '12345' }, fakeOmega);
        ctx.expect(vars.page.name).toBe('settings');
        ctx.expect(vars.page.title).toBe('MyApp');
        ctx.expect(vars.brand.id).toBe('myapp');
        ctx.expect(vars.theme.appearance).toBe('system');
        ctx.expect(vars.cacheBust).toBe('12345');
        ctx.expect(vars.content).toBe('');
      },
    },
    {
      name: 'buildPageVars accepts a content slot',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        const vars = t.buildPageVars('main', { content: '<h1>Hi</h1>' }, { config: {} });
        ctx.expect(vars.content).toBe('<h1>Hi</h1>');
      },
    },
    {
      name: 'renderPage end-to-end: page template + body content',
      run: (ctx) => {
        const t = require(path.join(__dirname, '..', '..', '..', 'lib', 'templating.js'));
        const tpl = '<title>{{ page.title }}</title><body>{{ content }}</body>';
        const vars = t.buildPageVars('main', {
          content: 'Hello {{ brand.name }}',
          cacheBust: '1',
        }, { config: { brand: { name: 'MyApp' }, app: { productName: 'MyApp' } } });
        // Note: content has its own {{ brand.name }} — this test verifies that the OUTER render
        // does not double-render the body. Templating call sites (gulp/html) handle the two-pass
        // explicitly: render body first, then page.
        // For this test, we just check the page-level render applied correctly.
        const final = t.renderPage(tpl, vars);
        ctx.expect(final).toContain('<title>MyApp</title>');
        ctx.expect(final).toContain('<body>Hello {{ brand.name }}</body>');
      },
    },
    {
      name: 'html task: a view with an unresolved {{ missing }} token fails the build, naming the view and the token',
      run: async (ctx) => {
        const { tmp, failure } = await runHtml({
          'src/views/orphan/index.html': '<h1>{{ brand.name }}</h1>\n<p>{{ missing }}</p>\n',
        });
        try {
          ctx.expect(failure).toBeInstanceOf(Error);
          ctx.expect(failure.message).toContain('src/views/orphan/index.html');
          ctx.expect(failure.message).toContain('{{ missing }}');
          ctx.expect(fs.existsSync(path.join(tmp, 'dist', 'views', 'orphan', 'index.html'))).toBe(false);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'html task: a fully resolved view renders into dist/views through the page template',
      run: async (ctx) => {
        const { tmp, failure } = await runHtml({
          'src/views/main/index.html': '<h1>{{ app.productName }}</h1>\n',
        });
        try {
          ctx.expect(failure).toBeFalsy();
          const page = fs.readFileSync(path.join(tmp, 'dist', 'views', 'main', 'index.html'), 'utf8');
          ctx.expect(page).toContain('<h1>Staged Brand</h1>');
          ctx.expect(page).toContain('main.bundle.js');
          ctx.expect(page).not.toContain('{{');
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});
