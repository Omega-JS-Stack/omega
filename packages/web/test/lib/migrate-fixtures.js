/**
 * The synthetic UJM consumer the web migrate suites convert: the legacy config
 * pair as data, and a temp-dir consumer staged from it.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const LEGACY_JEKYLL = {
  url: 'https://sample.test',
  baseurl: '',
  theme: { id: 'classy', appearance: 'dark', nav: { enabled: true } },
  meta: { title: 'Sample - {{ site.brand.name }}', description: 'A sample' },
  // The brand tagline is the Liquid-bearing config value that SURVIVES the
  // conversion: the config-value rewrite's subject, now that `meta` is dropped.
  brand: { id: 'sample', name: 'Sample', tagline: 'Sample - {{ site.brand.name }}', contact: { email: 'hi@sample.test' } },
  web_manager: {
    auth: { enabled: true, config: { redirects: { authenticated: '/account' } } },
    firebase: { app: { enabled: true, config: { apiKey: 'AIza-TEST', projectId: 'sample-test' } } },
    payment: {
      processors: { stripe: { publishableKey: false }, chargebee: { site: 'sample' } },
      products: [{ id: 'basic', name: 'Basic', type: 'subscription' }],
    },
    sentry: {
      enabled: true,
      config: { dsn: 'https://x@sentry.io/1', replaysSessionSampleRate: 0.01, replaysOnErrorSampleRate: 0.01 },
    },
    cookieConsent: {
      enabled: true,
      config: {
        type: 'opt-in',
        theme: 'classic',
        position: 'bottom-right',
        palette: { popup: { background: '#fff', text: '#000' } },
        content: { message: 'We use cookies. { terms }', dismiss: 'I Understand' },
      },
    },
  },
  oauth2: { discord: { enabled: true } },   // the LEGACY spelling, renamed on the way out
  analytics: { google: 'G-TEST123', meta: '', tiktok: 'TIKTOK1' },
  socials: { twitter: 'sample' },
  translation: { languages: ['es'], exclude: ['account'] },
  collections: { recipes: { title: 'Recipes', output: true } },
  defaults: [{ scope: { type: 'recipes' }, values: { layout: 'recipe' } }],
  plugins: ['jekyll-feed'],
  permalink: '/blog/:title',
};

const LEGACY_UJM = {
  distribute: { input: [] },
  webpack: { target: 'somiibo' },
  sass: { purgecss: { safelist: { standard: ['keep-me'] } } },
  imagemin: { enabled: true },
  github: { workflows: { build: { schedule: '30 1 1 * *' } } },
  gems: ['jekyll-redirect-from'],
};

function stageLegacyConsumer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-migrate-e2e-'));
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', '_layouts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', '_config.yml'), yaml.dump(LEGACY_JEKYLL));
  fs.writeFileSync(path.join(root, 'config', 'ultimate-jekyll-manager.json'), JSON.stringify(LEGACY_UJM, null, 2));
  fs.writeFileSync(path.join(root, 'Gemfile'), "source 'https://rubygems.org'\ngem 'jekyll'\n");
  fs.writeFileSync(path.join(root, 'Gemfile.lock'), 'GEM\n');
  fs.writeFileSync(path.join(root, 'src', 'pages', 'index.html'), [
    '---',
    'layout: themes/[ site.theme.id ]/frontend/core/base',
    '---',
    '<h1>{{ page.resolved.meta.title }}</h1>',
    '{% include /modules/thing.html %}',
  ].join('\n'));
  fs.mkdirSync(path.join(root, 'src', 'assets', 'js', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'assets', 'js', 'main.js'), [
    '// Import Ultimate Jekyll Manager',
    "import Manager from 'ultimate-jekyll-manager';",
    '',
    '// Create instance',
    'const manager = new Manager();',
    '',
    '// Initialize',
    'manager.initialize()',
    '.then(() => {',
    '  // Log',
    "  console.log('Ultimate Jekyll Manager initialized successfully');",
    '',
    '  // Custom code',
    '  // ...',
    '});',
  ].join('\n'));
  fs.mkdirSync(path.join(root, 'src', 'assets', 'css'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'assets', 'css', 'main.scss'), [
    "@use 'ultimate-jekyll-manager' as * with (",
    '  $primary: #5B47FB,',
    ');',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'src', 'assets', 'js', 'pages', 'custom.js'), [
    "import Manager from 'ultimate-jekyll-manager';",
    'export default () => new Manager();',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'src', '_layouts', 'custom.html'), [
    '{% for group in groups %}',
    '{% for item in group.items %}',
    '{{ forloop.parentloop.index }}',
    '{% endfor %}',
    '{% endfor %}',
    '{% post_url 2020-01-01-x %}',
  ].join('\n'));
  return root;
}

module.exports = { LEGACY_JEKYLL, LEGACY_UJM, stageLegacyConsumer };
