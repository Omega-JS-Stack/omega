/**
 * Section args, page-layout args and the footer's social platform carry the
 * full Font Awesome class string, the shape the chrome took in
 * [#903](https://github.com/Omega-JS-Stack/omega/issues/903) and the rule
 * icons.md states: a DATA key that carries an icon carries the same string
 * ([#929](https://github.com/Omega-JS-Stack/omega/issues/929)).
 *
 * Every site below emits the authored value verbatim and adds only its own
 * size/utility classes, so `fa-brands fa-docker` renders the mark it names and
 * a bare name renders as the bare class it is, with no `fa-solid` wrapper left
 * in any arg-driven template.
 *
 * A SECTION takes its args at the call site, so a proof page authors them. A
 * page LAYOUT does not: consumer page frontmatter is meta-only (engine.js), so
 * a layout's own frontmatter is the one authoring site, and the proof shadows
 * that layout the way a consumer does: the SHIPPED markup, our args.
 *
 * The two exceptions are KEYS, not icons: the footer's social platform and a
 * team member's link id name a platform, and social profiles are always brand
 * marks, so the family is derived once at the one site that knows it.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { after, test } = require('node:test');
const jetpack = require('fs-jetpack');

const { buildSite, miniData, MINI, PKG } = require('./lib/build.js');

const THEMES = path.join(PKG, 'themes');

// The fixture copies live UNDER cwd, the farm gotcha engine.js documents.
const ROOTS = [];

/** The sections, authored on one page: a unique pair per band, so no band answers another's assertion. */
const SECTION_PAGE = [
  '---',
  'layout: frontend/core/base',
  'permalink: /proof/sections',
  'meta:',
  '  title: Section arg icons',
  '---',
  '',
  '{% section "marketing/hero" %}',
  'headline: "Hero proof"',
  'primary_button:',
  '  text: "Brand"',
  '  href: "/brand"',
  '  icon: "fa-brands fa-docker"',
  'secondary_button:',
  '  enabled: true',
  '  text: "Bare"',
  '  href: "/bare"',
  '  icon: "gavel"',
  '{% endsection %}',
  '',
  '{% section "marketing/bento" %}',
  'items:',
  '  - title: "Brand tile"',
  '    description: "A tile naming a brand mark"',
  '    icon: "fa-brands fa-figma"',
  '  - title: "Bare tile"',
  '    description: "A tile naming a bare class"',
  '    icon: "wrench"',
  '{% endsection %}',
  '',
  '{% section "marketing/stats" %}',
  'items:',
  '  - number: "1"',
  '    label: "Brand"',
  '    icon: "fa-brands fa-npm"',
  '  - number: "2"',
  '    label: "Bare"',
  '    icon: "screwdriver"',
  '{% endsection %}',
  '',
  '{% section "marketing/trusted-by" %}',
  'logos:',
  '  - name: "Brand lockup"',
  '    icon: "fa-brands fa-slack"',
  '  - name: "Bare lockup"',
  '    icon: "hammer"',
  '{% endsection %}',
  '',
  '{% section "marketing/product-demo" %}',
  'enabled: true',
  'tabs:',
  '  - id: "brand"',
  '    label: "Brand"',
  '    icon: "fa-brands fa-discord"',
  '  - id: "bare"',
  '    label: "Bare"',
  '    icon: "anchor"',
  '{% endsection %}',
  '',
  '{% section "about/letter" %}',
  'feed_items:',
  '  - icon: "fa-brands fa-reddit"',
  '    text: "Brand feed item"',
  '  - icon: "feather"',
  '    text: "Bare feed item"',
  '{% endsection %}',
  '',
].join('\n');

/** One shadow per changed layout: the shipped markup, rendered against BOTH arg shapes. */
const SHADOWS = [
  {
    build: 'classy-proof', slug: 'download', theme: 'base', layout: 'frontend/pages/download',
    data: [
      'downloads:',
      '  platforms:',
      '    - id: "mac"',
      '      name: "macOS"',
      '      icon: "fa-brands fa-apple"',
      '      description: "The brand mark a bare name could never reach"',
      '      types: []',
      '    - id: "windows"',
      '      name: "Bare"',
      '      icon: "binoculars"',
      '      description: "A bare class, emitted as authored"',
      '      types: []',
    ],
  },
  {
    build: 'classy-proof', slug: 'contact', theme: 'base', layout: 'frontend/pages/contact',
    data: [
      'contact_methods:',
      '  - title: "Brand channel"',
      '    description: "Authored as a class string"',
      '    icon: "fa-brands fa-whatsapp"',
      '    link: "#brand"',
      '  - title: "Bare channel"',
      '    description: "Authored as a bare class"',
      '    icon: "trowel"',
      '    link: "#bare"',
    ],
  },
  {
    build: 'classy-proof', slug: 'extension', theme: 'base', layout: 'frontend/pages/extension/index',
    data: [
      'setup:',
      '  steps:',
      '    - title: "Brand step"',
      '      description: "Authored as a class string"',
      '      icon: "fa-brands fa-chrome"',
      'highlights:',
      '  items:',
      '    - title: "Bare highlight"',
      '      description: "Authored as a bare class"',
      '      icon: "scissors"',
    ],
  },
  {
    build: 'classy-proof', slug: 'signin', theme: 'base', layout: 'frontend/pages/auth/signin',
    data: [
      'social_signin:',
      '  - id: "microsoft.com"',
      '    name: "Microsoft"',
      '    icon: "fa-brands fa-microsoft"',
      '  - id: "bare.com"',
      '    name: "Bare"',
      '    icon: "paperclip"',
    ],
  },
  {
    build: 'classy-proof', slug: 'signup', theme: 'base', layout: 'frontend/pages/auth/signup',
    data: [
      'social_signup:',
      '  - id: "gitlab.com"',
      '    name: "GitLab"',
      '    icon: "fa-brands fa-gitlab"',
      '  - id: "bare.com"',
      '    name: "Bare"',
      '    icon: "syringe"',
    ],
  },
  {
    build: 'classy-proof', slug: 'team', theme: 'base', layout: 'frontend/pages/team/index',
    data: [
      'principles:',
      '  items:',
      '    - title: "Brand principle"',
      '      description: "Authored as a class string"',
      '      icon: "fa-brands fa-stripe"',
      '    - title: "Bare principle"',
      '      description: "Authored as a bare class"',
      '      icon: "ruler"',
    ],
  },
  {
    build: 'classy-proof', slug: 'alternatives', theme: 'base', layout: 'frontend/pages/alternatives/index',
    data: [
      'value_props:',
      '  items:',
      '    - title: "Brand prop"',
      '      description: "Authored as a class string"',
      '      icon: "fa-brands fa-spotify"',
      '    - title: "Bare prop"',
      '      description: "Authored as a bare class"',
      '      icon: "toolbox"',
    ],
  },
  {
    build: 'classy-proof', slug: 'account', theme: 'base', layout: 'frontend/pages/account/index',
    data: [
      'sections:',
      '  - id: "profile"',
      '    name: "Brand section"',
      '    icon: "fa-brands fa-bitbucket"',
      '  - id: "security"',
      '    name: "Bare section"',
      '    icon: "broom"',
    ],
  },
  {
    build: 'classy-proof', slug: 'dashboard', theme: 'base', layout: 'backend/pages/dashboard/index',
    data: [
      'stats_cards:',
      '  - id: "brand"',
      '    title: "Brand card"',
      '    value: "1"',
      '    change: "+1%"',
      '    change_type: "success"',
      '    icon: "fa-brands fa-twitch"',
      'quick_actions:',
      '  - id: "bare"',
      '    label: "Bare action"',
      '    icon: "plug"',
      '    style: "outline-adaptive"',
      '    href: "#bare"',
    ],
  },
  {
    build: 'newsflash-proof', slug: 'nf', theme: 'newsflash', layout: 'frontend/pages/index',
    data: [
      'hero:',
      '  headline: "Newsflash proof"',
      '  primary_button:',
      '    text: "Brand"',
      '    icon: "fa-brands fa-soundcloud"',
      '    href: "/brand"',
      '  secondary_button:',
      '    text: "Bare"',
      '    icon: "compass"',
      '    href: "/bare"',
      'desks:',
      '  cta_button:',
      '    text: "Brand desk cta"',
      '    icon: "fa-brands fa-rss"',
      '    href: "/blog"',
      '  items:',
      '    - title: "Brand desk"',
      '      description: "Authored as a class string"',
      '      icon: "fa-brands fa-twitch"',
      '    - title: "Bare desk"',
      '      description: "Authored as a bare class"',
      '      icon: "faucet"',
    ],
  },
  {
    build: 'neobrutalism-proof', slug: 'neo', theme: 'neobrutalism', layout: 'frontend/pages/index',
    data: [
      'hero:',
      '  headline: "Neobrutalism proof"',
      '  primary_button:',
      '    text: "Brand"',
      '    icon: "fa-brands fa-stripe"',
      '    href: "/brand"',
      '  secondary_button:',
      '    text: "Bare"',
      '    icon: "bullhorn"',
      '    href: "/bare"',
      'highlights:',
      '  cta_button:',
      '    text: "Brand cta"',
      '    icon: "fa-brands fa-figma"',
      '    href: "/brand"',
      '  items:',
      '    - title: "Bare step"',
      '      description: "Authored as a bare class"',
      '      icon: "chess-rook"',
    ],
  },
];

/** build name to the theme it renders with. A `-proof` build carries the shadows and the proof pages. */
const THEME_OF = {
  classy: 'classy',
  'classy-proof': 'classy',
  newsflash: 'newsflash',
  'newsflash-proof': 'newsflash',
  neobrutalism: 'neobrutalism',
  'neobrutalism-proof': 'neobrutalism',
};

/**
 * Shadow a shipped layout: its own markup, our args, at the path a consumer would use.
 * @param {string} root - the fixture copy
 * @param {object} shadow - one SHADOWS entry
 */
function writeShadow(root, shadow) {
  const shipped = fs.readFileSync(path.join(THEMES, shadow.theme, '_layouts', `${shadow.layout}.html`), 'utf8');
  const parts = shipped.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  assert.ok(parts, `${shadow.layout} ships with frontmatter`);
  const parent = parts[1].match(/^layout:.*$/m);
  assert.ok(parent, `${shadow.layout} names its parent layout`);

  jetpack.write(
    path.join(root, '_layouts', `${shadow.layout}.html`),
    ['---', parent[0], ...shadow.data, '---', '', parts[2]].join('\n'),
  );
  jetpack.write(
    path.join(root, 'pages', `proof-${shadow.slug}.html`),
    ['---', `layout: ${shadow.layout}`, `permalink: /proof/${shadow.slug}`, '---', ''].join('\n'),
  );
}

const builds = new Map();

/**
 * Build the mini fixture once per named build.
 * @param {string} name - a THEME_OF key
 * @returns {Promise<Map<string, string>>} url to rendered content
 */
function build(name) {
  if (builds.has(name)) return builds.get(name);

  const root = path.join(PKG, '.omega', `section-arg-icons-${name}-${process.pid}`);
  ROOTS.push(root);
  jetpack.copy(MINI, root, { overwrite: true });

  if (name.endsWith('-proof')) {
    for (const shadow of SHADOWS.filter((entry) => entry.build === name)) writeShadow(root, shadow);
    if (name === 'classy-proof') jetpack.write(path.join(root, 'pages', 'proof-sections.html'), SECTION_PAGE);
  }

  // A brand's `socials` block IS the footer's social row (#462): one platform
  // KEY, and the footer derives the brand family from it.
  const siteData = { ...miniData, theme: { id: THEME_OF[name] }, socials: { github: 'omegajs' } };
  const built = buildSite(root, siteData, {}, `section-arg-icons-${name}`);
  builds.set(name, built);

  return built;
}

after(() => {
  for (const root of ROOTS) fs.rmSync(root, { recursive: true, force: true });
});

/** One render case per changed section or layout: the authored string reaches the markup, unwrapped. */
const CASES = [
  { what: 'the marketing/hero section', build: 'classy-proof', url: '/proof/sections', brand: 'fa-brands fa-docker', bare: 'gavel' },
  { what: 'the marketing/bento section', build: 'classy-proof', url: '/proof/sections', brand: 'fa-brands fa-figma', bare: 'wrench' },
  { what: 'the marketing/stats section', build: 'classy-proof', url: '/proof/sections', brand: 'fa-brands fa-npm', bare: 'screwdriver' },
  { what: 'the marketing/trusted-by section', build: 'classy-proof', url: '/proof/sections', brand: 'fa-brands fa-slack', bare: 'hammer' },
  { what: 'the marketing/product-demo section', build: 'classy-proof', url: '/proof/sections', brand: 'fa-brands fa-discord', bare: 'anchor' },
  { what: 'the about/letter section', build: 'classy-proof', url: '/proof/sections', brand: 'fa-brands fa-reddit', bare: 'feather' },
  { what: 'the download layout', build: 'classy-proof', url: '/proof/download', brand: 'fa-brands fa-apple', bare: 'binoculars' },
  { what: 'the contact layout', build: 'classy-proof', url: '/proof/contact', brand: 'fa-brands fa-whatsapp', bare: 'trowel' },
  { what: 'the extension layout', build: 'classy-proof', url: '/proof/extension', brand: 'fa-brands fa-chrome', bare: 'scissors' },
  { what: 'the signin layout', build: 'classy-proof', url: '/proof/signin', brand: 'fa-brands fa-microsoft', bare: 'paperclip' },
  { what: 'the signup layout', build: 'classy-proof', url: '/proof/signup', brand: 'fa-brands fa-gitlab', bare: 'syringe' },
  { what: 'the team index layout', build: 'classy-proof', url: '/proof/team', brand: 'fa-brands fa-stripe', bare: 'ruler' },
  { what: 'the alternatives layout', build: 'classy-proof', url: '/proof/alternatives', brand: 'fa-brands fa-spotify', bare: 'toolbox' },
  { what: 'the account layout', build: 'classy-proof', url: '/proof/account', brand: 'fa-brands fa-bitbucket', bare: 'broom' },
  { what: 'the dashboard layout', build: 'classy-proof', url: '/proof/dashboard', brand: 'fa-brands fa-twitch', bare: 'plug' },
  { what: 'the newsflash index layout', build: 'newsflash-proof', url: '/proof/nf', brand: 'fa-brands fa-soundcloud', bare: 'compass' },
  { what: 'the newsflash desks section', build: 'newsflash-proof', url: '/proof/nf', brand: 'fa-brands fa-rss', bare: 'faucet' },
  { what: 'the neobrutalism index layout', build: 'neobrutalism-proof', url: '/proof/neo', brand: 'fa-brands fa-figma', bare: 'chess-rook' },
];

for (const { what, build: name, url, brand, bare } of CASES) {
  test(`#929: ${what} emits an arg icon exactly as authored`, async () => {
    const html = (await build(name)).get(url);
    assert.ok(html, `${url} rendered`);

    assert.ok(html.includes(brand), `the authored brand classes (${brand}) reach the markup`);
    assert.ok(!html.includes(`fa-solid ${brand.split(' ')[1]}`), 'nothing re-wraps them as solid');
    assert.match(html, new RegExp(`<i class="${bare}[ "]`), 'a bare name lands as the bare class it is');
    assert.ok(!html.includes(`fa-solid fa-${bare}`), `the fa-solid wrapper is gone (fa-${bare})`);
  });
}

test('#929: the footer derives a social platform\'s brand family from the ONE key the brand names', async () => {
  const html = (await build('classy')).get('/');

  assert.match(html, /<i class="fa-brands fa-github fa-sm"/, 'a github platform renders the brand mark');
  assert.ok(!html.includes('fa-solid fa-github'), 'never the solid family a brand mark has no glyph in');
});

test('#929: a team member link renders its platform as a brand mark, and website as the one solid globe', async () => {
  const pages = await build('classy');

  const brandMark = pages.get('/team/riley-nakamura');
  assert.match(brandMark, /<i class="fa-brands fa-x-twitter fa-sm"/, 'the link id names the brand mark');
  // The solid family carries no x-twitter glyph, so the old wrap rendered nothing at all.
  assert.ok(!brandMark.includes('fa-solid fa-x-twitter'), 'no solid wrapper on a brand platform');

  const website = pages.get('/team/sam-okafor');
  assert.match(website, /<i class="fa-solid fa-globe fa-sm"/, 'website is the one link that is not a brand mark');
});

test('#929: the team grid renders every member link the same way', async () => {
  const html = (await build('classy')).get('/team');

  assert.ok(html.includes('fa-brands fa-x-twitter'), 'the grid reaches the brands family too');
  assert.ok(html.includes('fa-brands fa-linkedin'), 'and every other platform a member names');
  assert.ok(!html.includes('fa-solid fa-linkedin'), 'with no solid wrapper left on the card links');
});

for (const name of ['classy', 'newsflash', 'neobrutalism']) {
  test(`#929: no packaged ${name} page double-wraps a class-string icon`, async () => {
    const offenders = [];
    for (const [url, html] of await build(name)) {
      if (/fa-(solid|brands|regular|sharp) fa-fa-/.test(html)) offenders.push(url);
    }

    // A packaged default that carries the class string and a template that
    // still wraps it produce `fa-solid fa-fa-solid fa-rocket`, the one string
    // that proves a site was missed, wherever it lives.
    assert.deepEqual(offenders, [], 'every packaged icon default flows through an unwrapped site');
  });
}
