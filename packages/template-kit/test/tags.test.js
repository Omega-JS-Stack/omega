/**
 * tags.test.js — engine-neutral tag renderer semantics against a fake ctx.
 *
 * The ctx contract here is exactly what register-liquid.js builds from a real
 * LiquidJS context: { lookup, page, site: { config, getCollection,
 * getCollectionNames, fileExists }, options }.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { TAGS } = require('../src/tags/index.js');
const { DEFAULT_ICON } = require('../src/tags/media.js');

const FIXTURES = path.join(__dirname, 'fixtures');

/**
 * Build a tag ctx over a plain scope object.
 */
function makeCtx(scope = {}, overrides = {}) {
  const lookup = (dotPath) => {
    let current = scope;
    for (const part of String(dotPath).split('.')) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  };

  return {
    lookup,
    page: scope.page || null,
    site: {
      config: overrides.siteConfig || scope.site || {},
      getCollection: overrides.getCollection || (() => []),
      getCollectionNames: overrides.getCollectionNames || (() => []),
      fileExists: overrides.fileExists || (() => false),
    },
    options: overrides.options || {},
  };
}

const INNER = () => 'INNER';

test('iftruthy / iffalsy follow the Ruby truthiness table (nil/false/""/0 falsy)', () => {
  const ctx = makeCtx({ yes: 'x', no: '', zero: 0, off: false, n: 5 });

  assert.strictEqual(TAGS.iftruthy.render(ctx, 'yes', INNER), 'INNER');
  assert.strictEqual(TAGS.iftruthy.render(ctx, 'n', INNER), 'INNER');
  assert.strictEqual(TAGS.iftruthy.render(ctx, 'no', INNER), '');
  assert.strictEqual(TAGS.iftruthy.render(ctx, 'zero', INNER), '');
  assert.strictEqual(TAGS.iftruthy.render(ctx, 'off', INNER), '');
  assert.strictEqual(TAGS.iftruthy.render(ctx, 'missing', INNER), '');
  assert.strictEqual(TAGS.iftruthy.render(ctx, '"literal"', INNER), 'INNER');

  assert.strictEqual(TAGS.iffalsy.render(ctx, 'no', INNER), 'INNER');
  assert.strictEqual(TAGS.iffalsy.render(ctx, 'zero', INNER), 'INNER');
  assert.strictEqual(TAGS.iffalsy.render(ctx, 'missing', INNER), 'INNER');
  assert.strictEqual(TAGS.iffalsy.render(ctx, 'yes', INNER), '');
});

test('iffile gates on the injected fileExists with leading-slash normalization', () => {
  const files = new Set(['/assets/images/hero.png']);
  const ctx = makeCtx({}, { fileExists: (p) => files.has(p) });

  assert.strictEqual(TAGS.iffile.render(ctx, '"assets/images/hero.png"', INNER), 'INNER');
  assert.strictEqual(TAGS.iffile.render(ctx, '"/assets/images/hero.png"', INNER), 'INNER');
  assert.strictEqual(TAGS.iffile.render(ctx, '"/nope.png"', INNER), '');

  // Bare token: falls back to the literal when the root is undefined in context
  assert.strictEqual(TAGS.iffile.render(ctx, '/assets/images/hero.png', INNER), 'INNER');
});

test('urlmatches normalizes index.html and trailing slashes', () => {
  const ctx = makeCtx({ page: { url: '/about/index.html' } });
  assert.strictEqual(TAGS.urlmatches.render(ctx, '"/about/"'), 'active');
  assert.strictEqual(TAGS.urlmatches.render(ctx, '"/about"'), 'active');
  assert.strictEqual(TAGS.urlmatches.render(ctx, '"/about/", "current"'), 'current');
  assert.strictEqual(TAGS.urlmatches.render(ctx, '"/pricing"'), '');

  const root = makeCtx({ page: { url: '/' } });
  assert.strictEqual(TAGS.urlmatches.render(root, '"/"'), 'active');
});

test('uj_readtime: 269 wpm, min 1, page-content default, HTML stripped', () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

  const short = makeCtx({ page: { content: words(100) } });
  assert.strictEqual(TAGS.uj_readtime.render(short, ''), '1');

  const long = makeCtx({ page: { content: words(600) } });
  assert.strictEqual(TAGS.uj_readtime.render(long, ''), '3'); // ceil(600/269) = 3

  const html = makeCtx({ page: { content: `<script>junk junk</script><p>${words(10)}</p>` } });
  assert.strictEqual(TAGS.uj_readtime.render(html, ''), '1');

  const fromVar = makeCtx({ description: words(300) });
  assert.strictEqual(TAGS.uj_readtime.render(fromVar, 'description'), '2');

  assert.strictEqual(TAGS.uj_readtime.render(makeCtx({}), ''), '1');
});

test('uj_fake_comments: words % 13', () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const ctx = makeCtx({ page: { content: words(30) } });
  assert.strictEqual(TAGS.uj_fake_comments.render(ctx, ''), String(30 % 13));
  assert.strictEqual(TAGS.uj_fake_comments.render(makeCtx({}), ''), '0');
});

test('uj_external absolutizes against site.url, passes full URLs through', () => {
  const ctx = makeCtx({ pageref: 'pricing' }, { siteConfig: { url: 'https://somiibo.com/' } });

  assert.strictEqual(TAGS.uj_external.render(ctx, '"pricing"'), 'https://somiibo.com/pricing');
  assert.strictEqual(TAGS.uj_external.render(ctx, '"/pricing"'), 'https://somiibo.com/pricing');
  assert.strictEqual(TAGS.uj_external.render(ctx, 'pageref'), 'https://somiibo.com/pricing');
  assert.strictEqual(TAGS.uj_external.render(ctx, '"https://other.com/x"'), 'https://other.com/x');
  assert.strictEqual(TAGS.uj_external.render(ctx, '"//cdn.com/x"'), '//cdn.com/x');
  assert.strictEqual(TAGS.uj_external.render(makeCtx({}), ''), '');
});

test('uj_social builds platform URLs from page.resolved.socials', () => {
  const ctx = makeCtx({ page: { resolved: { socials: { twitter: 'somiibo', tumblr: 'myblog' } } } });

  assert.strictEqual(TAGS.uj_social.render(ctx, '"twitter"'), 'https://twitter.com/somiibo');
  assert.strictEqual(TAGS.uj_social.render(ctx, '"tumblr"'), 'https://myblog.tumblr.com');
  assert.strictEqual(TAGS.uj_social.render(ctx, '"github"'), ''); // no handle
  assert.strictEqual(TAGS.uj_social.render(makeCtx({ page: {} }), '"twitter"'), '');
});

test('uj_language resolves english/native names, echoes unknown codes', () => {
  const ctx = makeCtx({ lang: 'es' });

  assert.strictEqual(TAGS.uj_language.render(ctx, '"es"'), 'Spanish');
  assert.strictEqual(TAGS.uj_language.render(ctx, '"es", "native"'), 'español');
  assert.strictEqual(TAGS.uj_language.render(ctx, 'lang'), 'Spanish');
  assert.strictEqual(TAGS.uj_language.render(ctx, '"ZH", "native"'), '中文');
  assert.strictEqual(TAGS.uj_language.render(ctx, '"xx"'), 'xx');
});

test('uj_translation_url prefixes languages, honors default + excludes + blog normalization', () => {
  const siteConfig = {
    translation: { default: 'en', languages: ['en', 'es', 'fr'], exclude: ['admin'] },
  };
  const ctx = makeCtx({ lang: 'es', pageUrl: '/pricing' }, { siteConfig });

  assert.strictEqual(TAGS.uj_translation_url.render(ctx, '"es", "/pricing"'), '/es/pricing');
  assert.strictEqual(TAGS.uj_translation_url.render(ctx, '"en", "/pricing"'), '/pricing');
  assert.strictEqual(TAGS.uj_translation_url.render(ctx, '"es", "/"'), '/es');
  assert.strictEqual(TAGS.uj_translation_url.render(ctx, '"de", "/pricing"'), '/pricing'); // unavailable -> default
  assert.strictEqual(TAGS.uj_translation_url.render(ctx, '"es", "/admin/panel"'), '/admin/panel'); // excluded
  assert.strictEqual(TAGS.uj_translation_url.render(ctx, '"es", "/blog/index.html"'), '/es/blog');
  assert.strictEqual(TAGS.uj_translation_url.render(ctx, '"es", "/blog/page/2.html"'), '/es/blog/page/2');
  assert.strictEqual(TAGS.uj_translation_url.render(ctx, 'lang, pageUrl'), '/es/pricing');
  assert.strictEqual(TAGS.uj_translation_url.render(makeCtx({}), ''), '/');
});

test('uj_icon loads from injected dirs with brands fallback, flag mapping, and default icon', () => {
  const options = { icons: { fontAwesomeDirs: [path.join(FIXTURES, 'icons')], flagsDir: path.join(FIXTURES, 'flags') } };
  const ctx = makeCtx({}, { options });

  const rocket = TAGS.uj_icon.render(ctx, 'rocket');
  assert.ok(rocket.startsWith('<i class="fa" data-icon="rocket">'));
  assert.ok(rocket.includes('M1 1'));
  assert.ok(rocket.includes('width="1em"') && rocket.includes('height="1em"') && rocket.includes('fill="currentColor"'));

  // brands fallback when not in the configured style
  const github = TAGS.uj_icon.render(ctx, 'github, "me-2"');
  assert.ok(github.startsWith('<i class="fa me-2" data-icon="github">'));
  assert.ok(github.includes('M2 2'));
  assert.ok(!github.includes('width="1em" width')); // existing width= not duplicated

  // flag via direct country code and via language mapping (en -> us)
  assert.ok(TAGS.uj_icon.render(ctx, 'us').includes('M3 3'));
  const enFlag = TAGS.uj_icon.render(ctx, 'en');
  assert.ok(enFlag.includes('M3 3'));
  // the flag set's hardcoded width/height="512" is stripped so the standard
  // 1em inline-icon sizing applies (a 512px flag blew up the dropdown)
  assert.ok(!enFlag.includes('"512"'), 'hardcoded flag dimensions stripped');
  assert.ok(enFlag.includes('width="1em"') && enFlag.includes('height="1em"'), '1em sizing injected');

  // unknown -> default warning triangle
  const missing = TAGS.uj_icon.render(ctx, 'definitely-not-real');
  assert.ok(missing.includes('M320 64'));
  // The fallback carries the failed slug so the dev-only browser audit can
  // console.error it ([data-omega-icon-missing] scan)
  assert.ok(missing.includes('data-omega-icon-missing="definitely-not-real"'));

  // no dirs configured -> default icon, no crash
  const bare = makeCtx({});
  assert.ok(TAGS.uj_icon.render(bare, 'rocket').includes('M320 64'));
});

test('uj_icon walks the dir chain and resolves aliases (icon-core semantics)', () => {
  const options = {
    icons: {
      fontAwesomeDirs: [path.join(FIXTURES, 'icons'), path.join(FIXTURES, 'icons-fallback')],
      aliasFile: path.join(FIXTURES, 'icon-families.json'),
    },
  };
  const ctx = makeCtx({}, { options });

  // first dir wins for names it has
  assert.ok(TAGS.uj_icon.render(ctx, 'rocket').includes('M1 1'));

  // a name only the second dir has resolves through the chain
  const bolt = TAGS.uj_icon.render(ctx, 'bolt');
  assert.ok(bolt.includes('M9 9'));

  // the shared root attributes ride every icon (icon-core's full set)
  assert.ok(bolt.includes('aria-hidden="true"') && bolt.includes('overflow="visible"'));

  // alias resolves to the canonical file ('search' → 'magnifying-glass')
  const search = TAGS.uj_icon.render(ctx, 'search');
  assert.ok(search.includes('M8 8'));
  assert.ok(search.startsWith('<i class="fa" data-icon="search">')); // data-icon keeps the requested name
});

test('uj_logo prefixes SVG ids uniquely per instance', () => {
  const options = { logos: { dir: path.join(FIXTURES, 'logos') } };
  const ctx = makeCtx({}, { options });

  const first = TAGS.uj_logo.render(ctx, 'acme');
  const second = TAGS.uj_logo.render(ctx, 'acme');

  assert.match(first, /id="acme-\d+-grad"/);
  assert.match(first, /url\(#acme-\d+-grad\)/);
  assert.match(first, /href="#acme-\d+-grad"/);
  assert.notStrictEqual(first, second); // unique prefix per render

  // missing logo -> default
  assert.ok(TAGS.uj_logo.render(ctx, 'ghost').includes('M320 64'));
  // no name -> empty
  assert.strictEqual(TAGS.uj_logo.render(ctx, ''), '');
});

test('uj_image builds the picture element (webp sources, max_width, webp=false, external)', () => {
  const ctx = makeCtx({ img: '/assets/pic.png' });

  const full = TAGS.uj_image.render(ctx, '"/assets/pic.png", alt="Hero", class="img-fluid"');
  assert.ok(full.startsWith('<picture>'));
  assert.ok(full.includes('data-lazy="@srcset /assets/pic-320px.webp" media="(max-width: 320px)" type="image/webp"'));
  assert.ok(full.includes('data-lazy="@srcset /assets/pic.webp" type="image/webp"'));
  assert.ok(full.includes('data-lazy="@srcset /assets/pic-1024px.png" media="(max-width: 1024px)"'));
  assert.ok(full.includes('alt="Hero"'));
  assert.ok(full.includes('class="img-fluid"'));
  assert.ok(full.includes('data-lazy="@src /assets/pic.png"'));

  const capped = TAGS.uj_image.render(ctx, '"/assets/pic.png", max_width="640"');
  assert.ok(capped.includes('-640px.webp" type="image/webp"'));
  assert.ok(!capped.includes('-1024px'));

  const noWebp = TAGS.uj_image.render(ctx, '"/assets/pic.png", webp="false"');
  assert.ok(!noWebp.includes('.webp'));

  const external = TAGS.uj_image.render(ctx, '"https://cdn.com/pic.png", alt="X"');
  assert.ok(external.startsWith('<img'));
  assert.ok(!external.includes('<picture>'));
  assert.ok(external.includes('loading="lazy"'));

  // variable src
  assert.ok(TAGS.uj_image.render(ctx, 'img').includes('data-lazy="@src /assets/pic.png"'));
  assert.strictEqual(TAGS.uj_image.render(makeCtx({}), ''), '');
});

test('uj_video builds video element with flag attributes and mime types', () => {
  const ctx = makeCtx({});

  const local = TAGS.uj_video.render(ctx, '"/assets/demo.mp4", autoplay="true", muted="true"');
  assert.ok(local.startsWith('<div class="lazy-loading" data-lazy-load-container>'));
  assert.ok(local.includes('autoplay\n'));
  assert.ok(local.includes('muted\n'));
  assert.ok(local.includes('controls\n')); // default on
  assert.ok(local.includes('preload="metadata"'));
  assert.ok(local.includes('type="video/mp4"'));
  assert.ok(local.includes('-640px.mp4" media="(max-width: 640px)"'));

  const noControls = TAGS.uj_video.render(ctx, '"/a.webm", controls="false"');
  assert.ok(!noControls.includes('controls'));
  assert.ok(noControls.includes('type="video/webm"'));

  const external = TAGS.uj_video.render(ctx, '"https://cdn.com/demo.mov"');
  assert.ok(external.includes('type="video/quicktime"'));
  assert.ok(external.includes('data-lazy="@src https://cdn.com/demo.mov"'));
});

test('uj_member resolves team docs: name/url/path/image/image-tag/dynamic', () => {
  const team = [
    { id: '/team/ian-wieds', url: '/team/ian-wieds', data: { member: { name: 'Ian Wieds', role: 'Founder' } } },
    {
      id: '/team/sam-okafor',
      url: '/team/sam-okafor',
      data: { member: { name: 'Sam Okafor', image: 'https://images.example.com/sam.jpg' } },
    },
  ];
  const ctx = makeCtx(
    { page: { post: { member: 'ian-wieds' } }, who: 'ian-wieds' },
    { getCollection: (name) => (name === 'team' ? team : []), siteConfig: { url: 'https://somiibo.com' } }
  );

  assert.strictEqual(TAGS.uj_member.render(ctx, '"ian-wieds"'), 'Ian Wieds');
  assert.strictEqual(TAGS.uj_member.render(ctx, '"ian-wieds", "url"'), 'https://somiibo.com/team/ian-wieds');
  assert.strictEqual(TAGS.uj_member.render(ctx, '"ian-wieds", "path"'), '/team/ian-wieds');
  assert.strictEqual(TAGS.uj_member.render(ctx, '"ian-wieds", "image"'), '/assets/images/team/ian-wieds/profile.jpg');
  assert.strictEqual(
    TAGS.uj_member.render(ctx, '"sam-okafor", "image"'),
    'https://images.example.com/sam.jpg',
    'explicit member.image beats the team-assets convention',
  );
  assert.strictEqual(TAGS.uj_member.render(ctx, '"ian-wieds", "role"'), 'Founder');
  assert.strictEqual(TAGS.uj_member.render(ctx, 'who'), 'Ian Wieds'); // variable id
  assert.strictEqual(TAGS.uj_member.render(ctx, ''), 'Ian Wieds'); // page.post.member default

  const imageTag = TAGS.uj_member.render(ctx, '"ian-wieds", "image-tag", class="rounded"');
  assert.ok(imageTag.includes('<picture>'));
  assert.ok(imageTag.includes('alt="Ian Wieds"')); // default alt from member name
  assert.ok(imageTag.includes('class="rounded"'));

  assert.strictEqual(TAGS.uj_member.render(ctx, '"ghost"'), '');
});

test('uj_post finds docs by id / custom post.id across collections', () => {
  const posts = [
    {
      id: '/posts/2024-01-15-my-slug',
      url: '/blog/my-slug',
      data: {
        title: 'My Post',
        date: new Date('2024-01-15T12:00:00Z'),
        categories: ['Tech', 'News'],
        tags: ['a', 'b'],
        post: { id: 1732444329, author: 'rare-ivy', title: 'Custom Title' },
      },
    },
  ];
  const ctx = makeCtx(
    { page: {} },
    {
      getCollection: (name) => (name === 'posts' ? posts : []),
      getCollectionNames: () => ['posts'],
      siteConfig: { url: 'https://somiibo.com' },
    }
  );

  // UJM posts carry the real title in post.title (Jekyll only had data.title
  // because it derives one from the filename) — post.title wins when present.
  assert.strictEqual(TAGS.uj_post.render(ctx, '"1732444329"'), 'Custom Title'); // custom post.id, default property
  assert.strictEqual(TAGS.uj_post.render(ctx, '"my-slug", "url"'), 'https://somiibo.com/blog/my-slug');
  assert.strictEqual(TAGS.uj_post.render(ctx, '"my-slug", "date"'), '2024-01-15');
  assert.strictEqual(TAGS.uj_post.render(ctx, '"my-slug", "author"'), 'rare-ivy'); // post.post.author wins
  assert.strictEqual(TAGS.uj_post.render(ctx, '"my-slug", "categories"'), 'Tech, News');
  assert.strictEqual(TAGS.uj_post.render(ctx, '"my-slug", "tags"'), 'a, b');
  assert.strictEqual(TAGS.uj_post.render(ctx, '"my-slug", "image"'), '/assets/images/blog/post-1732444329/my-slug.jpg');

  const imageTag = TAGS.uj_post.render(ctx, '"my-slug", "image-tag"');
  assert.ok(imageTag.includes('alt="Custom Title"')); // post.post.title preferred for alt

  assert.strictEqual(TAGS.uj_post.render(ctx, '"ghost"'), '');
});
