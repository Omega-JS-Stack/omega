/**
 * tags.test.js — engine-neutral tag renderer semantics against a fake ctx.
 *
 * The ctx contract here is exactly what register-liquid.js builds from a real
 * LiquidJS context: { lookup, page, site: { config, getCollection,
 * getCollectionNames, fileExists }, options }.
 */

const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('path');
const { TAGS } = require('../src/tags/index.js');

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

module.exports = defineCases({
  type: 'group',
  description: 'tags',
  tests: [
    {
      name: 'iftruthy / iffalsy follow the Ruby truthiness table (nil/false/""/0 falsy)',
      run: (ctx) => {
        const context = makeCtx({ yes: 'x', no: '', zero: 0, off: false, n: 5 });

        ctx.expect(TAGS.iftruthy.render(context, 'yes', INNER)).toBe('INNER');
        ctx.expect(TAGS.iftruthy.render(context, 'n', INNER)).toBe('INNER');
        ctx.expect(TAGS.iftruthy.render(context, 'no', INNER)).toBe('');
        ctx.expect(TAGS.iftruthy.render(context, 'zero', INNER)).toBe('');
        ctx.expect(TAGS.iftruthy.render(context, 'off', INNER)).toBe('');
        ctx.expect(TAGS.iftruthy.render(context, 'missing', INNER)).toBe('');
        ctx.expect(TAGS.iftruthy.render(context, '"literal"', INNER)).toBe('INNER');

        ctx.expect(TAGS.iffalsy.render(context, 'no', INNER)).toBe('INNER');
        ctx.expect(TAGS.iffalsy.render(context, 'zero', INNER)).toBe('INNER');
        ctx.expect(TAGS.iffalsy.render(context, 'missing', INNER)).toBe('INNER');
        ctx.expect(TAGS.iffalsy.render(context, 'yes', INNER)).toBe('');
      },
    },

    {
      name: 'iffile gates on the injected fileExists with leading-slash normalization',
      run: (ctx) => {
        const files = new Set(['/assets/images/hero.png']);
        const context = makeCtx({}, { fileExists: (p) => files.has(p) });

        ctx.expect(TAGS.iffile.render(context, '"assets/images/hero.png"', INNER)).toBe('INNER');
        ctx.expect(TAGS.iffile.render(context, '"/assets/images/hero.png"', INNER)).toBe('INNER');
        ctx.expect(TAGS.iffile.render(context, '"/nope.png"', INNER)).toBe('');

        // Bare token: falls back to the literal when the root is undefined in context
        ctx.expect(TAGS.iffile.render(context, '/assets/images/hero.png', INNER)).toBe('INNER');
      },
    },

    {
      name: 'urlmatches normalizes index.html and trailing slashes',
      run: (ctx) => {
        const context = makeCtx({ page: { url: '/about/index.html' } });
        ctx.expect(TAGS.urlmatches.render(context, '"/about/"')).toBe('active');
        ctx.expect(TAGS.urlmatches.render(context, '"/about"')).toBe('active');
        ctx.expect(TAGS.urlmatches.render(context, '"/about/", "current"')).toBe('current');
        ctx.expect(TAGS.urlmatches.render(context, '"/pricing"')).toBe('');

        const root = makeCtx({ page: { url: '/' } });
        ctx.expect(TAGS.urlmatches.render(root, '"/"')).toBe('active');
      },
    },

    {
      name: 'omega_readtime: 269 wpm, min 1, page-content default, HTML stripped',
      run: (ctx) => {
        const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

        const short = makeCtx({ page: { content: words(100) } });
        ctx.expect(TAGS.omega_readtime.render(short, '')).toBe('1');

        const long = makeCtx({ page: { content: words(600) } });
        ctx.expect(TAGS.omega_readtime.render(long, '')).toBe('3'); // ceil(600/269) = 3

        const html = makeCtx({ page: { content: `<script>junk junk</script><p>${words(10)}</p>` } });
        ctx.expect(TAGS.omega_readtime.render(html, '')).toBe('1');

        const fromVar = makeCtx({ description: words(300) });
        ctx.expect(TAGS.omega_readtime.render(fromVar, 'description')).toBe('2');

        ctx.expect(TAGS.omega_readtime.render(makeCtx({}), '')).toBe('1');
      },
    },

    {
      name: 'omega_fake_comments: words % 13',
      run: (ctx) => {
        const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
        const context = makeCtx({ page: { content: words(30) } });
        ctx.expect(TAGS.omega_fake_comments.render(context, '')).toBe(String(30 % 13));
        ctx.expect(TAGS.omega_fake_comments.render(makeCtx({}), '')).toBe('0');
      },
    },

    {
      name: 'omega_external absolutizes against site.url, passes full URLs through',
      run: (ctx) => {
        const context = makeCtx({ pageref: 'pricing' }, { siteConfig: { url: 'https://somiibo.com/' } });

        ctx.expect(TAGS.omega_external.render(context, '"pricing"')).toBe('https://somiibo.com/pricing');
        ctx.expect(TAGS.omega_external.render(context, '"/pricing"')).toBe('https://somiibo.com/pricing');
        ctx.expect(TAGS.omega_external.render(context, 'pageref')).toBe('https://somiibo.com/pricing');
        ctx.expect(TAGS.omega_external.render(context, '"https://other.com/x"')).toBe('https://other.com/x');
        ctx.expect(TAGS.omega_external.render(context, '"//cdn.com/x"')).toBe('//cdn.com/x');
        ctx.expect(TAGS.omega_external.render(makeCtx({}), '')).toBe('');
      },
    },

    {
      name: 'omega_social builds platform URLs from page.resolved.config.socials',
      run: (ctx) => {
        const context = makeCtx({ page: { resolved: { config: { socials: { twitter: 'somiibo', tumblr: 'myblog' } } } } });

        ctx.expect(TAGS.omega_social.render(context, '"twitter"')).toBe('https://twitter.com/somiibo');
        ctx.expect(TAGS.omega_social.render(context, '"tumblr"')).toBe('https://myblog.tumblr.com');
        ctx.expect(TAGS.omega_social.render(context, '"github"')).toBe(''); // no handle
        ctx.expect(TAGS.omega_social.render(makeCtx({ page: {} }), '"twitter"')).toBe('');
      },
    },

    {
      name: 'omega_social reads the SSG\'s own `resolved` scope too, and the { handle, redirect } entry form (#429)',
      run: (ctx) => {
        // @omega.js/web's data cascade puts `resolved` beside `page`, not inside it
        // (its migrate rule 1 is literally `page.resolved.` → `resolved.`), so the
        // page-only lookup resolved nothing on every omega build — an empty href on
        // the footer's social row and an empty JSON-LD sameAs entry.
        const engineCtx = makeCtx({ page: { url: '/' }, resolved: { config: { socials: { twitter: 'somiibo' } } } });
        ctx.expect(TAGS.omega_social.render(engineCtx, '"twitter"')).toBe('https://twitter.com/somiibo');

        // The object form names a PROFILE with its handle; where its shortlink
        // redirects is the socials page lane's business, never sameAs's.
        const objectCtx = makeCtx({
          page: { url: '/' },
          resolved: { config: { socials: { spotify: { handle: 'somiibo', redirect: 'https://open.spotify.com/artist/1k6' } } } },
        });
        ctx.expect(TAGS.omega_social.render(objectCtx, '"spotify"')).toBe('https://open.spotify.com/user/somiibo');

        // Redirect-only (a platform with no URL pattern): nothing to derive.
        const redirectOnly = makeCtx({ page: { url: '/' }, resolved: { config: { socials: { spotify: { redirect: 'https://open.spotify.com/artist/1k6' } } } } });
        ctx.expect(TAGS.omega_social.render(redirectOnly, '"spotify"')).toBe('');
      },
    },

    {
      name: 'omega_language resolves english/native names, echoes unknown codes',
      run: (ctx) => {
        const context = makeCtx({ lang: 'es' });

        ctx.expect(TAGS.omega_language.render(context, '"es"')).toBe('Spanish');
        ctx.expect(TAGS.omega_language.render(context, '"es", "native"')).toBe('español');
        ctx.expect(TAGS.omega_language.render(context, 'lang')).toBe('Spanish');
        ctx.expect(TAGS.omega_language.render(context, '"ZH", "native"')).toBe('中文');
        ctx.expect(TAGS.omega_language.render(context, '"xx"')).toBe('xx');
      },
    },

    // #858: the tag prefixes, and that is all it does. Exclusion left with
    // `translation.exclude`: the include list that replaced it is glob-matched
    // against the framework's derived exclusions and each page's own stamp, which
    // only the build's link rewriter can see.
    {
      name: 'omega_translation_url prefixes languages, honors default + blog normalization',
      run: (ctx) => {
        const siteConfig = {
          translation: { default: 'en', languages: ['en', 'es', 'fr'] },
        };
        const context = makeCtx({ lang: 'es', pageUrl: '/pricing' }, { siteConfig });

        ctx.expect(TAGS.omega_translation_url.render(context, '"es", "/pricing"')).toBe('/es/pricing');
        ctx.expect(TAGS.omega_translation_url.render(context, '"en", "/pricing"')).toBe('/pricing');
        ctx.expect(TAGS.omega_translation_url.render(context, '"es", "/"')).toBe('/es');
        ctx.expect(TAGS.omega_translation_url.render(context, '"de", "/pricing"')).toBe('/pricing'); // unavailable -> default
        ctx.expect(TAGS.omega_translation_url.render(context, '"es", "/blog/index.html"')).toBe('/es/blog');
        ctx.expect(TAGS.omega_translation_url.render(context, '"es", "/blog/page/2.html"')).toBe('/es/blog/page/2');
        ctx.expect(TAGS.omega_translation_url.render(context, 'lang, pageUrl')).toBe('/es/pricing');
        ctx.expect(TAGS.omega_translation_url.render(makeCtx({}), '')).toBe('/');
      },
    },

    {
      name: 'omega_logo prefixes SVG ids uniquely per instance',
      run: (ctx) => {
        const options = { logos: { dir: path.join(FIXTURES, 'logos') } };
        const context = makeCtx({}, { options });

        const first = TAGS.omega_logo.render(context, 'acme');
        const second = TAGS.omega_logo.render(context, 'acme');

        ctx.expect(first).toMatch(/id="acme-\d+-grad"/);
        ctx.expect(first).toMatch(/url\(#acme-\d+-grad\)/);
        ctx.expect(first).toMatch(/href="#acme-\d+-grad"/);
        ctx.expect(first).not.toBe(second); // unique prefix per render

        // missing logo -> default
        ctx.expect(TAGS.omega_logo.render(context, 'ghost').includes('M320 64')).toBeTruthy();
        // no name -> empty
        ctx.expect(TAGS.omega_logo.render(context, '')).toBe('');
      },
    },

    {
      name: 'omega_image builds the picture element (webp sources, max_width, webp=false, external)',
      run: (ctx) => {
        const context = makeCtx({ img: '/assets/pic.png' });

        const full = TAGS.omega_image.render(context, '"/assets/pic.png", alt="Hero", class="img-fluid"');
        ctx.expect(full.startsWith('<picture>')).toBeTruthy();
        ctx.expect(full.includes('data-lazy="@srcset /assets/pic-320px.webp" media="(max-width: 320px)" type="image/webp"')).toBeTruthy();
        ctx.expect(full.includes('data-lazy="@srcset /assets/pic.webp" type="image/webp"')).toBeTruthy();
        ctx.expect(full.includes('data-lazy="@srcset /assets/pic-1024px.png" media="(max-width: 1024px)"')).toBeTruthy();
        ctx.expect(full.includes('alt="Hero"')).toBeTruthy();
        ctx.expect(full.includes('class="img-fluid"')).toBeTruthy();
        ctx.expect(full.includes('data-lazy="@src /assets/pic.png"')).toBeTruthy();

        const capped = TAGS.omega_image.render(context, '"/assets/pic.png", max_width="640"');
        ctx.expect(capped.includes('-640px.webp" type="image/webp"')).toBeTruthy();
        ctx.expect(!capped.includes('-1024px')).toBeTruthy();

        const noWebp = TAGS.omega_image.render(context, '"/assets/pic.png", webp="false"');
        ctx.expect(!noWebp.includes('.webp')).toBeTruthy();

        const external = TAGS.omega_image.render(context, '"https://cdn.com/pic.png", alt="X"');
        ctx.expect(external.startsWith('<img')).toBeTruthy();
        ctx.expect(!external.includes('<picture>')).toBeTruthy();
        ctx.expect(external.includes('loading="lazy"')).toBeTruthy();

        // variable src
        ctx.expect(TAGS.omega_image.render(context, 'img').includes('data-lazy="@src /assets/pic.png"')).toBeTruthy();
        ctx.expect(TAGS.omega_image.render(makeCtx({}), '')).toBe('');
      },
    },

    {
      name: 'omega_video builds video element with flag attributes and mime types',
      run: (ctx) => {
        const context = makeCtx({});

        const local = TAGS.omega_video.render(context, '"/assets/demo.mp4", autoplay="true", muted="true"');
        ctx.expect(local.startsWith('<div class="lazy-loading" data-lazy-load-container>')).toBeTruthy();
        ctx.expect(local.includes('autoplay\n')).toBeTruthy();
        ctx.expect(local.includes('muted\n')).toBeTruthy();
        ctx.expect(local.includes('controls\n')).toBeTruthy(); // default on
        ctx.expect(local.includes('preload="metadata"')).toBeTruthy();
        ctx.expect(local.includes('type="video/mp4"')).toBeTruthy();
        ctx.expect(local.includes('-640px.mp4" media="(max-width: 640px)"')).toBeTruthy();

        const noControls = TAGS.omega_video.render(context, '"/a.webm", controls="false"');
        ctx.expect(!noControls.includes('controls')).toBeTruthy();
        ctx.expect(noControls.includes('type="video/webm"')).toBeTruthy();

        const external = TAGS.omega_video.render(context, '"https://cdn.com/demo.mov"');
        ctx.expect(external.includes('type="video/quicktime"')).toBeTruthy();
        ctx.expect(external.includes('data-lazy="@src https://cdn.com/demo.mov"')).toBeTruthy();
      },
    },

    {
      name: 'omega_member resolves team docs: name/url/path/image/image-tag/dynamic',
      run: (ctx) => {
        const team = [
          { id: '/team/ian-wieds', url: '/team/ian-wieds', data: { member: { name: 'Ian Wieds', role: 'Founder' } } },
          {
            id: '/team/sam-okafor',
            url: '/team/sam-okafor',
            data: { member: { name: 'Sam Okafor', image: 'https://images.example.com/sam.jpg' } },
          },
        ];
        const context = makeCtx(
          { page: { post: { member: 'ian-wieds' } }, who: 'ian-wieds' },
          { getCollection: (name) => (name === 'team' ? team : []), siteConfig: { url: 'https://somiibo.com' } }
        );

        ctx.expect(TAGS.omega_member.render(context, '"ian-wieds"')).toBe('Ian Wieds');
        ctx.expect(TAGS.omega_member.render(context, '"ian-wieds", "url"')).toBe('https://somiibo.com/team/ian-wieds');
        ctx.expect(TAGS.omega_member.render(context, '"ian-wieds", "path"')).toBe('/team/ian-wieds');
        ctx.expect(TAGS.omega_member.render(context, '"ian-wieds", "image"')).toBe('/assets/images/team/ian-wieds/profile.jpg');
        ctx.expect(TAGS.omega_member.render(context, '"sam-okafor", "image"'), 'explicit member.image beats the team-assets convention').toBe('https://images.example.com/sam.jpg');
        ctx.expect(TAGS.omega_member.render(context, '"ian-wieds", "role"')).toBe('Founder');
        ctx.expect(TAGS.omega_member.render(context, 'who')).toBe('Ian Wieds'); // variable id
        ctx.expect(TAGS.omega_member.render(context, '')).toBe('Ian Wieds'); // page.post.member default

        const imageTag = TAGS.omega_member.render(context, '"ian-wieds", "image-tag", class="rounded"');
        ctx.expect(imageTag.includes('<picture>')).toBeTruthy();
        ctx.expect(imageTag.includes('alt="Ian Wieds"')).toBeTruthy(); // default alt from member name
        ctx.expect(imageTag.includes('class="rounded"')).toBeTruthy();

        ctx.expect(TAGS.omega_member.render(context, '"ghost"')).toBe('');
      },
    },

    {
      name: 'omega_post finds docs by id / custom post.id across collections',
      run: (ctx) => {
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
        const context = makeCtx(
          { page: {} },
          {
            getCollection: (name) => (name === 'posts' ? posts : []),
            getCollectionNames: () => ['posts'],
            siteConfig: { url: 'https://somiibo.com' },
          }
        );

        // UJM posts carry the real title in post.title (Jekyll only had data.title
        // because it derives one from the filename) — post.title wins when present.
        ctx.expect(TAGS.omega_post.render(context, '"1732444329"')).toBe('Custom Title'); // custom post.id, default property
        ctx.expect(TAGS.omega_post.render(context, '"my-slug", "url"')).toBe('https://somiibo.com/blog/my-slug');
        ctx.expect(TAGS.omega_post.render(context, '"my-slug", "date"')).toBe('2024-01-15');
        ctx.expect(TAGS.omega_post.render(context, '"my-slug", "author"')).toBe('rare-ivy'); // post.post.author wins
        ctx.expect(TAGS.omega_post.render(context, '"my-slug", "categories"')).toBe('Tech, News');
        ctx.expect(TAGS.omega_post.render(context, '"my-slug", "tags"')).toBe('a, b');
        ctx.expect(TAGS.omega_post.render(context, '"my-slug", "image"')).toBe('/assets/images/blog/post-1732444329/my-slug.jpg');

        const imageTag = TAGS.omega_post.render(context, '"my-slug", "image-tag"');
        ctx.expect(imageTag.includes('alt="Custom Title"')).toBeTruthy(); // post.post.title preferred for alt

        ctx.expect(TAGS.omega_post.render(context, '"ghost"')).toBe('');
      },
    },

    {
      name: 'omega_post media contract: explicit post.image wins, image:false renders nothing (cp189)',
      run: (ctx) => {
        // The classy includes honored post.image at the include level while
        // postImagePath ignored it — every omega_post image-tag consumer (newsflash
        // layouts) 404'd on remote-hero sample posts. The contract now lives in
        // the tag, mirroring memberImagePath.
        const posts = [
          {
            id: '/posts/2026-01-01-remote-hero',
            url: '/blog/remote-hero',
            data: { post: { id: 9000001, title: 'Remote', image: 'https://images.example.com/hero.jpg' } },
          },
          {
            id: '/posts/2026-01-02-no-media',
            url: '/blog/no-media',
            data: { post: { id: 9000002, title: 'Quiet', image: false } },
          },
          {
            id: '/posts/2026-01-03-conventional',
            url: '/blog/conventional',
            data: { post: { id: 9000003, title: 'Local' } },
          },
        ];
        const context = makeCtx(
          { page: {} },
          {
            getCollection: (name) => (name === 'posts' ? posts : []),
            getCollectionNames: () => ['posts'],
            siteConfig: { url: 'https://somiibo.com' },
          }
        );

        // Explicit image (remote URL) wins for both properties — image-tag rides
        // buildImageHtml's external branch (lazy-loaded, no local variants)
        ctx.expect(TAGS.omega_post.render(context, '"remote-hero", "image"')).toBe('https://images.example.com/hero.jpg');
        ctx.expect(TAGS.omega_post.render(context, '"remote-hero", "image-tag"').includes('data-lazy="@src https://images.example.com/hero.jpg"')).toBeTruthy();

        // image: false = deliberately no media — nothing rendered, no 404 bait
        ctx.expect(TAGS.omega_post.render(context, '"no-media", "image"')).toBe('');
        ctx.expect(TAGS.omega_post.render(context, '"no-media", "image-tag"')).toBe('');

        // No image key → the blog-assets convention stands
        ctx.expect(TAGS.omega_post.render(context, '"conventional", "image"')).toBe('/assets/images/blog/post-9000003/conventional.jpg');
      },
    },

    // ─── wave-4 regressions (F13, F14, F17) ───

    {
      name: 'omega_image: bare literal options resolve to values — max_width=640 and webp=false work unquoted (F13)',
      run: (ctx) => {
        const context = makeCtx({});
        const html = TAGS.omega_image.render(context, '"/assets/img/hero.png", max_width=640, webp=false');

        // webp=false → no webp sources at all
        ctx.expect(!html.includes('.webp'), 'webp sources should be suppressed').toBeTruthy();
        // max_width=640 → capped source set (no 1024px variant)
        ctx.expect(html.includes('hero-640px.png'), '640px source expected').toBeTruthy();
        ctx.expect(!html.includes('hero-1024px.png'), '1024px source should be capped away').toBeTruthy();
      },
    },

    {
      name: 'option parsers are unified: unresolvable unquoted values keep their literal text (F14)',
      run: (ctx) => {
        const context = makeCtx({});
        const html = TAGS.omega_image.render(context, '"/assets/img/hero.png", class=hero-img');
        ctx.expect(html.includes('class="hero-img"'), 'unresolvable bare value should fall back to its literal text').toBeTruthy();
      },
    },

    {
      name: 'caller-supplied attribute values are escaped (F17)',
      run: (ctx) => {
        const context = makeCtx({ title: 'He said "hi" & left' });
        const html = TAGS.omega_image.render(context, '"/assets/img/hero.png", alt=title');
        ctx.expect(html.includes('alt="He said &quot;hi&quot; &amp; left"'), `alt should be attribute-escaped, got: ${html}`).toBeTruthy();
        ctx.expect(!html.includes('alt="He said "hi"'), 'raw quote must not break out of the attribute').toBeTruthy();
      },
    },
  ],
});
