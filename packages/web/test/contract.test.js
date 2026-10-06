/**
 * Theme-contract suite (B2): EVERY packaged theme must build the ENTIRE
 * default page set through buildSite() — a bare consumer (a few collection
 * docs, no pages) gets the full working site. Pins: page count, key URLs,
 * literal /404.html, taxonomy + collection generators, markdown legal
 * layouts, manifest-injected assets, zero unresolved Liquid, and the
 * base-fallback contract for partial themes (neobrutalism, newsflash).
 */
const fs = require('node:fs');
const path = require('node:path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { buildTheme, themeOutDir, FIXTURE_VERSION } = require('./lib/contract-build.js');
const { readBuildJsFile } = require('./lib/build.js');

const PKG = path.resolve(__dirname, '..');

const THEMES = ['classy', 'neobrutalism', 'newsflash'];
const builds = {};

/**
 * Read a built page's HTML.
 * @param {string} theme
 * @param {string} rel - output-relative path
 * @returns {string}
 */
function page(theme, rel) {
  return fs.readFileSync(path.join(themeOutDir(theme), rel), 'utf8');
}

module.exports = defineCases({
  type: 'group',
  description: 'contract',
  // One process per theme (#179): Eleventy's layout cache is a module singleton
  // that outlives the instance, so same-process theme builds share the FIRST
  // theme's layouts. See test/lib/contract-build.js.
  setup: async () => {
    await Promise.all(THEMES.map(async (theme) => {
      builds[theme] = await buildTheme(theme);
    }));
  },
  tests: [
    {
      name: 'every theme builds the full default page set for a bare consumer',
      run: (ctx) => {
        for (const theme of THEMES) {
          ctx.expect(builds[theme].htmlCount >= 60, `${theme}: ${builds[theme].htmlCount} pages (full default set)`).toBeTruthy();
        }
        // Identical page sets across themes — fallback fills every gap. The ONE
        // sanctioned delta (cp219): the showcase documents each theme's RESOLVED
        // library, so a theme shipping its own sections gets exactly that many
        // extra entry pages — plus one embedded-frame page per demo variant of
        // them (#463). Derived from the collector, never hardcoded — a new
        // theme-only section (or a new demo variant) moves both sides together.
        const { buildSectionLibrary } = require('../src/sections.js');
        const libSize = (...layers) => {
          const library = buildSectionLibrary({
            baseDirs: layers.map((layer) => path.join(PKG, 'themes', layer)),
          });
          return library.entries.length + library.variants.length;
        };
        ctx.expect(builds.neobrutalism.htmlCount, 'neobrutalism = classy page count (no own sections)').toBe(builds.classy.htmlCount);
        ctx.expect(builds.newsflash.htmlCount - builds.classy.htmlCount, 'newsflash delta = its own showcase entries and their frames, nothing else').toBe(libSize('newsflash', 'base') - libSize('base'));
      },
    },

    // #179: every assertion here used to be theme-agnostic, so the suite stayed
    // green while the neobrutalism and newsflash outputs rendered CLASSY pages:
    // Eleventy's module-singleton layout cache served the first build's layouts to
    // the other two. Each homepage carries its own layout's signature markup, so a
    // returning leak fails here instead of shipping wrong fixtures.
    {
      name: '#179: every theme renders its OWN homepage layout (no cross-build layout-cache leak)',
      run: (ctx) => {
        const markers = {
          classy: 'omega-hero', // no own index layout: the base marketing/hero section
          neobrutalism: 'neo-hero', // its own index layout
          newsflash: 'newsflash-hero', // its own index layout
        };
        for (const theme of THEMES) {
          // Markup only: the inlined critical CSS (#750) carries the shared base
          // section rules (`.omega-hero{...}`) into every theme's head, and a
          // selector in a style block is not a rendered layout
          const html = page(theme, 'index.html').replace(/<style[\s\S]*?<\/style>/g, '');
          ctx.expect(html.includes(markers[theme]), `${theme}: homepage missing its own markup (${markers[theme]})`).toBeTruthy();
          for (const other of THEMES.filter((id) => id !== theme)) {
            ctx.expect(!html.includes(markers[other]), `${theme}: homepage rendered ${other} markup (${markers[other]})`).toBeTruthy();
          }
        }
      },
    },

    {
      name: 'key default pages land at their real URLs',
      run: (ctx) => {
        for (const rel of [
          '404.html', 'about.html', 'pricing.html', 'signin.html',
          'contact.html', 'blog.html', 'terms.html', 'team.html',
          'careers.html', 'payment/checkout.html', 'admin.html', 'dashboard/account.html',
        ]) {
          ctx.expect(fs.existsSync(path.join(themeOutDir('classy'), rel)), `classy builds ${rel}`).toBeTruthy();
        }
      },
    },

    {
      name: 'collection docs + generators: team, updates, alternatives, taxonomy',
      run: (ctx) => {
        ctx.expect(page('classy', 'team/ian-wiedenman.html').includes('Ian Wiedenman'), 'team member page').toBeTruthy();
        ctx.expect(page('classy', 'updates/v1.0.0.html').includes('1.0.0'), 'update page').toBeTruthy();
        ctx.expect(page('classy', 'alternatives/example-competitor.html').includes('Example Competitor'), 'alternative page').toBeTruthy();
        ctx.expect(page('classy', 'blog/categories/news.html').includes('Hello OMEGA'), 'category generator page lists its post').toBeTruthy();
        ctx.expect(page('classy', 'blog/tags/omega.html').includes('OMEGA'), 'tag generator page').toBeTruthy();
      },
    },

    {
      name: 'markdown legal layout renders its default text as HTML (append pattern)',
      run: (ctx) => {
        const terms = page('classy', 'terms.html');
        ctx.expect(terms.includes('<h2') || terms.includes('<h1'), 'legal markdown became HTML headings').toBeTruthy();
        ctx.expect(terms.includes('Contract'), 'brand name templated into legal text').toBeTruthy();
      },
    },

    // #9: the cookie policy shipped as raw INDENTED html inside a .md blueprint,
    // so markdown mangled it (`<p><li>`, literal `**Brand**`) and — because it
    // carried no headings — the page JS hid the TOC rail, dropping the document
    // into the rail's 15rem grid track. Every legal blueprint is markdown now, and
    // the three pages get the SAME document treatment.
    {
      name: '#9: every legal page gets the same document treatment as terms/privacy',
      run: (ctx) => {
        for (const theme of THEMES) {
          for (const file of ['terms.html', 'privacy.html', 'cookies.html']) {
            const html = page(theme, file);
            // Anchored on the MARKUP: the page's own sheet is inlined in the head
            // (#767), so the bare class token first appears in a selector up there.
            const region = html.slice(html.indexOf('data-legal-doc'), html.indexOf('class="omega-legal__doc-foot'));
            // #92: a commented-out clause is still SHIPPED bytes — a draft parked in
            // an HTML comment reaches every consumer's legal page verbatim, raw
            // markdown and all. Comments in a legal document carry no draft copy.
            const drafts = [...region.matchAll(/<!--[\s\S]*?-->/g)]
              .filter(([comment]) => comment.includes('**'))
              .map(([comment]) => comment.slice(0, 80));
            ctx.expect(drafts, `${theme}/${file}: HTML comments shipping draft markdown`).toEqual([]);
            // Comments are not rendered text — the rendered-copy checks skip them.
            const doc = region.replace(/<!--[\s\S]*?-->/g, '');

            ctx.expect(html.includes('<article class="omega-legal__doc omega-prose" data-legal-doc>'), `${theme}/${file}: the document wrapper`).toBeTruthy();
            ctx.expect(doc.includes('<h2>'), `${theme}/${file}: section headings — no headings means the JS hides the rail and the doc falls into its track`).toBeTruthy();
            ctx.expect(!doc.includes('**'), `${theme}/${file}: markdown emphasis resolved, never literal`).toBeTruthy();
            ctx.expect(!/<p>\s*<li>/.test(doc), `${theme}/${file}: no list mangled by markdown's indented-html handling`).toBeTruthy();
            ctx.expect(doc.includes('Contract'), `${theme}/${file}: brand name templated into the legal text`).toBeTruthy();
          }
        }
      },
    },

    // #86: consumers cannot fix stock-chrome icon misses, so a Pro-only icon name
    // in packaged markup must break the build lane. The build's inlining pass
    // (#619) marks every unresolved name on the element it left empty.
    {
      name: '#86: no stock page ships a missing-icon marker',
      run: (ctx) => {
        for (const theme of THEMES) {
          const outDir = themeOutDir(theme);
          const misses = [];
          for (const entry of fs.readdirSync(outDir, { recursive: true, withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
            const html = fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
            for (const [, slug] of html.matchAll(/data-omega-icon-missing="([^"]*)"/g)) {
              misses.push(`${path.relative(outDir, path.join(entry.parentPath, entry.name))}: ${slug}`);
            }
          }
          ctx.expect([...new Set(misses)], `${theme}: icon names that resolved to the fallback triangle`).toEqual([]);
        }
      },
    },

    {
      name: 'manifest-injected assets on every theme (hashed main css/js, valid build bake)',
      run: (ctx) => {
        for (const theme of THEMES) {
          const html = page(theme, 'pricing.html');
          ctx.expect(html, `${theme}: hashed main css linked`).toMatch(/href="\/assets\/css\/main-[a-f0-9]{8}\.css"/);
          ctx.expect(html, `${theme}: hashed main js linked as an ESM module`).toMatch(/<script type="module" src="\/assets\/js\/main-[A-Z0-9]{8}\.js"><\/script>/);
          ctx.expect(html.includes('<script src="/build.js?cb='), `${theme}: the one build snapshot is loaded`).toBeTruthy();
          ctx.expect(html.includes(`data-theme-id="${theme}"`), `${theme}: active theme id in chrome`).toBeTruthy();
        }
      },
    },

    // #380: the ONE place web hands the client its error-reporting config. Parsed,
    // not string-matched, so a Liquid slip that renders an unparseable literal fails
    // HERE rather than as a blank page in a browser.
    {
      name: '#380: omega.json5 `monitoring` reaches the client at its canonical home',
      run: (ctx) => {
        for (const theme of THEMES) {
          const buildJson = readBuildJsFile(path.join(themeOutDir(theme), 'build.js'));
          ctx.expect(buildJson, `${theme}: the OMEGA_BUILD_JSON snapshot is present`).toBeTruthy();

          const config = buildJson.config;
          // The whole sentry PROVIDER block rides (#425); @omega.js/client turns a
          // DSN's presence into its own `sentry` contract (#894), so the page no
          // longer composes one.
          ctx.expect(config.monitoring.providers.sentry.dsn, `${theme}: the DSN rides`).toBe('https://key@o1.ingest.sentry.io/1');
          ctx.expect(config.monitoring.providers.sentry.org, `${theme}: the whole provider block rides`).toBe('contract-org');
          ctx.expect(config.sentry, `${theme}: and the page composes no second home for it`).toBe(undefined);
          // The release tag's version half: the WEBSITE APP's own package version, so
          // every host tags `brand.id@version` instead of falling back to buildTime.
          ctx.expect(config.version, `${theme}: the target's own version rides the snapshot`).toBe(FIXTURE_VERSION);
          // The wrapper is the same five keys on every OMEGA browser surface (#894)
          ctx.expect(Object.keys(buildJson).sort(), `${theme}: the one wrapper`).toEqual(['builtAt', 'config', 'license', 'mode', 'package']);
        }
      },
    },

    {
      name: 'dispersal-era section markers are DEAD: no packaged template carries `### X ###` (C2)',
      run: (ctx) => {
        const roots = [
          path.join(PKG, 'defaults'),
          path.join(PKG, 'core'),
          path.join(PKG, 'themes'),
        ];
        const offenders = [];
        for (const root of roots) {
          for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
            if (!entry.isFile() || !/\.(html|md)$/.test(entry.name)) continue;
            const file = path.join(entry.parentPath, entry.name);
            if (/^### .+ ###\s*$/m.test(fs.readFileSync(file, 'utf8'))) {
              offenders.push(path.relative(PKG, file));
            }
          }
        }
        ctx.expect(offenders, 'files still carrying dispersal-era markers').toEqual([]);
      },
    },

    {
      name: 'no unresolved Liquid syntax leaks into any built page',
      run: (ctx) => {
        for (const theme of THEMES) {
          const outDir = themeOutDir(theme);
          const leaks = [];
          for (const entry of fs.readdirSync(outDir, { recursive: true, withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
            const file = path.join(entry.parentPath, entry.name);
            const html = fs.readFileSync(file, 'utf8');
            if (html.includes('{{ ') || html.includes('{% ') || html.includes('Liquid error')) {
              leaks.push(path.relative(outDir, file));
            }
          }
          ctx.expect(leaks, `${theme}: pages with unresolved Liquid`).toEqual([]);
        }
      },
    },

    {
      name: '#16: no LEGACY click-trigger class survives in built output (html/css/js)',
      run: (ctx) => {
        // The three names the unified `omega-*` trigger registry retired. No aliases
        // were kept, so a single surviving spelling in dist means dead markup: the
        // class no longer has a handler behind it.
        const legacy = ['auth-signout-btn', 'auth-signin-btn', 'uj-password-toggle'];
        for (const theme of THEMES) {
          const outDir = themeOutDir(theme);
          const offenders = [];
          for (const entry of fs.readdirSync(outDir, { recursive: true, withFileTypes: true })) {
            if (!entry.isFile() || !/\.(html|css|js)$/.test(entry.name)) continue;
            const file = path.join(entry.parentPath, entry.name);
            const contents = fs.readFileSync(file, 'utf8');
            for (const name of legacy) {
              if (contents.includes(name)) {
                offenders.push(`${path.relative(outDir, file)} → ${name}`);
              }
            }
          }
          ctx.expect(offenders, `${theme}: built files still carrying a legacy trigger class`).toEqual([]);
        }

        // The replacements ARE in the output — otherwise the assertion above passes
        // for the wrong reason (a build that emitted no auth markup at all).
        ctx.expect(page('classy', 'signin.html').includes('omega-password-toggle'), 'signin carries the password-eye trigger').toBeTruthy();
        ctx.expect(page('classy', 'dashboard/account.html').includes('omega-signout'), 'the account menu carries the sign-out trigger').toBeTruthy();
      },
    },

    {
      name: 'redirect module: careers renders the redirect chrome',
      run: (ctx) => {
        const careers = page('classy', 'careers.html');
        ctx.expect(careers.includes('docs.google.com/forms'), 'redirect target URL present').toBeTruthy();
      },
    },

    {
      name: 'redirect shortlinks: auth + billing defaults emit their targets',
      run: (ctx) => {
        const cases = [
          ['login.html', '/signin'],
          ['register.html', '/signup'],
          ['join.html', '/signup'],
          ['forgot.html', '/reset?authSignout=true'],
          ['recover.html', '/reset?authSignout=true'],
          ['reset-password.html', '/reset?authSignout=true'],
          ['change-password.html', '/reset?authSignout=true'],
          ['cancel.html', '/dashboard/account#billing'],
          ['refund.html', '/terms'],
        ];
        for (const [file, target] of cases) {
          ctx.expect(page('classy', file).includes(target), `${file} → ${target}`).toBeTruthy();
        }
      },
    },
  ],
});
