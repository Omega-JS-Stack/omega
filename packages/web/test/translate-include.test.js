/**
 * `translation.include`, the glob list that says which page routes get
 * translated ([#858](https://github.com/Omega-JS-Stack/omega/issues/858),
 * Ian 2026-09-13). It replaced `translation.exclude`, which named what to
 * skip and defaulted to nothing, so every brand that never thought about it
 * paid a provider for its whole blog.
 *
 * Two halves, both here:
 *   - the MATCHER (`routeIncluded`): gitignore order, so the LAST pattern that
 *     matches wins, `!` negates, no match at all is excluded;
 *   - the WIRING: the route list, the framework's own derived exclusions and
 *     the per-page `translation.include` stamp meeting in `translateSite`.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { routeIncluded, includePatterns, readTranslateStamp } = require('../src/translate/route-include.js');
const { TRANSLATION_INCLUDE_DEFAULT } = require('@omega.js/config/schema');
const { translateSite } = require('../src/translate/index.js');
const { CONTROL } = require('@omega.js/devkit/translate');
const { buildSite, BARE } = require('./lib/build.js');

// ─── The matcher ─────────────────────────────────────────────────────────────

test('routeIncluded: the framework default translates everything but the blog', () => {
  const patterns = TRANSLATION_INCLUDE_DEFAULT;

  assert.equal(routeIncluded('', patterns), true, 'the home page');
  assert.equal(routeIncluded('docs/api', patterns), true);
  assert.equal(routeIncluded('pricing', patterns), true);

  // `blog/**` covers the folder ITSELF, not only what is under it: the same
  // subtree semantics the exclusion sets have always had.
  assert.equal(routeIncluded('blog', patterns), false, 'the listing itself');
  assert.equal(routeIncluded('blog/post-1', patterns), false);
  assert.equal(routeIncluded('blog/page/2', patterns), false);
  assert.equal(routeIncluded('blogroll', patterns), true, 'a SEGMENT, never a bare prefix');
});

test('routeIncluded: a brand list replaces the default outright, nothing else is translated', () => {
  const patterns = ['docs/**'];

  assert.equal(routeIncluded('docs', patterns), true);
  assert.equal(routeIncluded('docs/api', patterns), true);
  assert.equal(routeIncluded('', patterns), false, 'the home page is out when the list does not name it');
  assert.equal(routeIncluded('pricing', patterns), false);
});

test('routeIncluded: the LAST matching pattern wins, in either direction', () => {
  // A negation after a positive excludes…
  assert.equal(routeIncluded('blog/post-1', ['**', '!blog/**']), false);
  // …and a positive after a negation puts one subtree back.
  assert.equal(routeIncluded('blog/post-1', ['**', '!blog/**', 'blog/post-1']), true);
  assert.equal(routeIncluded('blog/post-2', ['**', '!blog/**', 'blog/post-1']), false);
});

test('routeIncluded: routes and patterns normalize the same way, slashes and all', () => {
  assert.equal(routeIncluded('/docs/api/', ['docs/**']), true);
  assert.equal(routeIncluded('docs/api', ['/docs/**']), true);
  assert.equal(routeIncluded('docs', ['!/docs', '**']), true, 'order, not specificity');
});

test('includePatterns: an absent list is the framework default, an empty one translates nothing', () => {
  assert.deepEqual(includePatterns({}), TRANSLATION_INCLUDE_DEFAULT);
  assert.deepEqual(includePatterns({ translation: {} }), TRANSLATION_INCLUDE_DEFAULT);
  assert.deepEqual(includePatterns({ translation: { include: ['docs/**'] } }), ['docs/**']);
  assert.equal(routeIncluded('anything', includePatterns({ translation: { include: [] } })), false);
});

// ─── The page stamp ──────────────────────────────────────────────────────────

test('readTranslateStamp: the <html> stamp a page carrying `translation.include` ships', () => {
  assert.equal(readTranslateStamp('<!doctype html><html lang="en" data-omega-translate="true">'), true);
  assert.equal(readTranslateStamp('<!doctype html><html lang="en" data-omega-translate="false">'), false);
  assert.equal(readTranslateStamp('<!doctype html><html data-omega-translate=false>'), false, 'minified, unquoted');
  assert.equal(readTranslateStamp('<!doctype html><html lang="en">'), null, 'no stamp is no opinion');
});

// ─── The wiring ──────────────────────────────────────────────────────────────

const NO_PACKAGED = path.join(os.tmpdir(), 'omega-packaged-defaults-absent');

const PAGE = (title, body, stamp = '') => `<!doctype html><html lang="en" dir="ltr"${stamp ? ` data-omega-translate="${stamp}"` : ''}><head>
<title>${title}</title>
<link rel="canonical" href="https://mini.co/"/>
</head><body>${body}</body></html>`;

/** Stage a dist with a home page, a docs page, a blog post and a stamped pair. */
function stage() {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-translate-include-')));
  const dist = path.join(scratch, 'dist');
  const write = (rel, html) => {
    fs.mkdirSync(path.join(dist, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dist, rel), html);
  };

  write('index.html', PAGE('Home', '<p>Welcome</p><a href="/blog/post-1">Post</a>'));
  write('docs/api/index.html', PAGE('API', '<p>The API</p>'));
  write('blog/post-1/index.html', PAGE('Post one', '<p>First post</p>'));
  write('blog/post-2/index.html', PAGE('Post two', '<p>Second post</p>', 'true'));
  write('docs/secret/index.html', PAGE('Secret', '<p>Not for translation</p>', 'false'));

  return { scratch, dist };
}

const CONFIG = (translation) => ({
  url: 'https://mini.co',
  brand: { name: 'MiniCo', url: 'https://mini.co' },
  translation: { languages: ['es'], ...translation },
});

/** Fake provider: suffixes each string with the target language. */
const send = async ({ user }) => {
  const lang = user.match(/^Target language: (\S+)/)[1];
  const payload = JSON.parse(user.slice(user.indexOf('\n\n') + 2));

  return { text: JSON.stringify(payload.map((value) => (value === CONTROL ? value : `${value.trim()}·${lang}`))), usage: { input: 1, output: 1 } };
};

test('#858: the default list keeps the blog off the provider and translates everything else', async () => {
  const { scratch, dist } = stage();
  const stats = await translateSite({ root: scratch, outDir: dist, config: CONFIG(), send, packagedRoot: NO_PACKAGED });

  // The language HOME lands as es.html, a FILE (translate/index.js), never
  // an es/index.html.
  assert.ok(fs.existsSync(path.join(dist, 'es.html')), 'the home page is translated');
  assert.ok(fs.existsSync(path.join(dist, 'es', 'docs', 'api', 'index.html')), 'a docs page is translated');
  assert.ok(!fs.existsSync(path.join(dist, 'es', 'blog', 'post-1')), 'the blog is out by default');
  assert.ok(stats.pages > 0, 'the pass ran');

  // A link to an excluded route is left alone, the same guard the framework
  // routes get.
  const es = fs.readFileSync(path.join(dist, 'es.html'), 'utf8');
  assert.ok(es.includes('href="/blog/post-1"'), 'the excluded route link is not rewritten');
});

test('#858: a page\'s own `translation.include` wins over the list, both directions', async () => {
  const { scratch, dist } = stage();
  await translateSite({ root: scratch, outDir: dist, config: CONFIG(), send, packagedRoot: NO_PACKAGED });

  assert.ok(fs.existsSync(path.join(dist, 'es', 'blog', 'post-2', 'index.html')), 'an opted-IN blog post is translated');
  assert.ok(!fs.existsSync(path.join(dist, 'es', 'docs', 'secret')), 'an opted-OUT docs page is not');
});

test('#858: a brand list REPLACES the default, so only what it names is translated', async () => {
  const { scratch, dist } = stage();
  await translateSite({ root: scratch, outDir: dist, config: CONFIG({ include: ['blog/**'] }), send, packagedRoot: NO_PACKAGED });

  assert.ok(fs.existsSync(path.join(dist, 'es', 'blog', 'post-1', 'index.html')), 'the named subtree is in');
  assert.ok(!fs.existsSync(path.join(dist, 'es.html')), 'the home page is out: the list replaced the default');
  assert.ok(!fs.existsSync(path.join(dist, 'es', 'docs', 'api')), 'and so is docs');
});

// ─── The build half of the stamp ─────────────────────────────────────────────

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

/** A consumer whose `pages/` carries one page with the given frontmatter. */
function makePage(frontmatter) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-translate-page-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'index.html'), [
    '---',
    'layout: frontend/core/base',
    'permalink: /',
    ...frontmatter,
    '---',
    '<section><h2>Body</h2></section>',
    '',
  ].join('\n'));

  return { tmp, consumerDir };
}

test('#858: a page\'s `translation.include` reaches the built page as the <html> stamp', async () => {
  for (const [value, expected] of [['false', false], ['true', true]]) {
    const { tmp, consumerDir } = makePage(['translation:', `  include: ${value}`]);

    try {
      const built = await buildSite(consumerDir, bareData, {}, `translate-stamp-${value}`);
      assert.equal(readTranslateStamp(built.get('/')), expected, `include: ${value} stamps the page`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test('#858: a page that says nothing carries no stamp, so the list decides', async () => {
  const { tmp, consumerDir } = makePage([]);

  try {
    const built = await buildSite(consumerDir, bareData, {}, 'translate-stamp-absent');
    assert.equal(readTranslateStamp(built.get('/')), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// `include` is the ONE key the bare `translation:` opens: the rest of the
// section is omega.json5 config, and a page restating it bare would reach
// nothing at all.
test('#858: a SCALAR `translation:` fails the build, naming the shape (C8)', async () => {
  const { tmp, consumerDir } = makePage(['translation: false']);

  try {
    await assert.rejects(
      () => buildSite(consumerDir, bareData, {}, 'translate-stamp-scalar'),
      (error) => {
        const parts = [];
        for (let node = error; node; node = node.originalError || node.cause) parts.push(node.message);
        const message = parts.join(' | ');
        assert.match(message, /translation: \{ include: true\|false \}/, 'the error names the shape');
        return true;
      },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#858: any other key under a page\'s bare `translation:` fails the build', async () => {
  const { tmp, consumerDir } = makePage(['translation:', '  languages: ["es"]']);

  try {
    await assert.rejects(
      () => buildSite(consumerDir, bareData, {}, 'translate-stamp-stray'),
      (error) => {
        const parts = [];
        for (let node = error; node; node = node.originalError || node.cause) parts.push(node.message);
        const message = parts.join(' | ');
        assert.match(message, /`languages`/, 'the error names the stray key');
        assert.match(message, /config:/, 'and the lane it belongs in');
        return true;
      },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
