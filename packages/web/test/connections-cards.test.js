/**
 * The account page's CONNECTION CARDS — who decides which providers a user can
 * link, and where a card's name and logo come from
 * ([#771](https://github.com/Omega-JS-Stack/omega/issues/771),
 * [#792](https://github.com/Omega-JS-Stack/omega/issues/792),
 * [#793](https://github.com/Omega-JS-Stack/omega/issues/793)).
 *
 * The list used to be closed twice over and the CARD had two homes: the layout
 * drew one per `connections:` frontmatter row (twelve of them, hardcoded CDN
 * URLs — the Twitch and Kick ones 404), and a row WON over the brand's own
 * config entry, so a brand could not correct one. The rows are gone: the CONFIG
 * is the only list, the framework's config DEFAULTS carry each packaged
 * provider's name, logo and description, and a brand's values win through the
 * ordinary merge chain.
 *
 * What is pinned here:
 *  - the packaged defaults exist, name a mark that SHIPS in this package, and a
 *    brand that declares nothing else still gets a drawn card;
 *  - a brand's own `logo` wins over the packaged one, and a full URL still
 *    renders as an `<img>` while a mark NAME renders inline;
 *  - no `connections:` frontmatter row survives anywhere in the theme;
 *  - an enabled provider with no name+logo still gets the unsupported card, and
 *    `connections.js` drives from `Object.keys(connectionsConfig)` alone.
 *
 * Two harnesses, because the feature has two halves: the REAL Liquid include
 * over the REAL base theme for the markup, and the REAL section module through
 * esbuild over a hand-rolled document for the behavior (node has no DOM and web
 * pulls in no jsdom) — the convention account-orders.test.js set. The document's
 * card ids come from the rendered Liquid, so the two halves meet where the page
 * makes them meet.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const cheerio = require('cheerio');
const { User } = require('@omega.js/account');
const yaml = require('js-yaml');
const { Liquid } = require('liquidjs');
const { registerLiquid } = require('@omega.js/template-kit/register-liquid');
const { schemaDefaults } = require('@omega.js/config');

const CORE_DIR = path.join(__dirname, '..', 'core');
const LOGOS_DIR = path.join(CORE_DIR, 'logos');
const MARKS_DIR = path.join(LOGOS_DIR, 'brandmarks', 'original');
const THEMES_DIR = path.join(__dirname, '..', 'themes');
const BASE_THEME = path.join(THEMES_DIR, 'base');
const CONNECTIONS_ENTRY = path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'sections', 'connections.js');
const CONNECTIONS_SOURCE = fs.readFileSync(CONNECTIONS_ENTRY, 'utf8');
const ACCOUNT_LAYOUT = fs.readFileSync(path.join(BASE_THEME, '_layouts', 'frontend', 'pages', 'account', 'index.html'), 'utf8');

// The framework's own card table — the LOWEST layer of the merge chain, so a
// brand that writes `google: { enabled: true }` resolves to all of this
const PACKAGED = schemaDefaults().connections;

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-connections-cards-'));
const BUNDLE = path.join(BUNDLE_DIR, 'connections.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [CONNECTIONS_ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          return { path: path.join(CORE_DIR, args.path.slice('__main_assets__/'.length)) };
        });
        build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/form-manager\.js$/ }, () => {
          return { path: 'form-manager', namespace: 'omega-form-manager-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-form-manager-stub' }, () => {
          return { contents: 'export class FormManager { on() {} }' };
        });
      },
    }],
  });

  return building;
}

// A brand's RESOLVED config: two packaged providers it enabled (nothing else
// declared, so the defaults are what draw them), one of its own with card
// fields, and one with nothing to draw
const CONNECTIONS_CONFIG = {
  google: { ...PACKAGED.google, enabled: true },
  twitch: { ...PACKAGED.twitch, enabled: true },
  'house-sso': { enabled: true, name: 'House SSO', logo: 'https://cdn.test/house.svg' },
  'no-card': { enabled: true },
};

// A provider name is `[a-z0-9-]` — the backend's confined loader refuses
// anything else, so a key like this can never resolve to a provider at all
const CONNECTIONS_CONFIG_BAD_KEY = {
  HouseSSO: { enabled: true, name: 'House SSO', logo: 'https://cdn.test/house.svg' },
};

/** The REAL include over the REAL base theme, with the brand's config bridged in. */
function renderConnections(connectionsConfig) {
  const engine = new Liquid({ root: [path.join(BASE_THEME, '_includes')], jekyllInclude: true });

  registerLiquid(engine, {
    site: {},
    getCollection: () => [],
    getCollectionNames: () => [],
    fileExists: () => false,
    markdown: (content) => content,
    icons: { fontAwesomeDirs: [], aliasFile: null, flagsDir: null, style: 'solid' },
    // The same directory the build hands the tag (src/engine.js), so a mark NAME
    // renders the SVG this package ships
    logos: { dir: LOGOS_DIR },
  });

  return engine.parseAndRender('{% include frontend/sections/account-connections.html %}', {
    resolved: { config: { connections: connectionsConfig } },
  });
}

/** Every `connection-<id>` CARD the markup carries, in order (never its form). */
function cardIds(html) {
  return [...html.matchAll(/id="connection-([A-Za-z0-9_-]+)"/g)]
    .map((match) => match[1])
    .filter((id) => !id.startsWith('form-'));
}

/** The first path data in a shipped mark — enough to tell one mark from another. */
function markSignature(name) {
  const svg = fs.readFileSync(path.join(MARKS_DIR, `${name}.svg`), 'utf8');

  return svg.match(/ d="([^"]{40,})"/)[1].slice(0, 40);
}

/** A document that answers exactly the ids the rendered markup carries. */
function documentFor(html) {
  const appended = [];

  const makeElement = (id) => ({
    id: id,
    classes: new Set(['d-none']),
    classList: {
      add: (name) => elements[id].classes.add(name),
      remove: (name) => elements[id].classes.delete(name),
    },
    innerHTML: '',
    textContent: '',
    querySelector: () => null,
    appendChild: (child) => appended.push(child),
  });

  const elements = {};

  for (const id of ['connections-loading', 'connections-empty', 'connections-list']) {
    elements[id] = makeElement(id);
  }

  for (const id of cardIds(html)) {
    elements[`connection-${id}`] = makeElement(`connection-${id}`);
    elements[`${id}-connection-status`] = makeElement(`${id}-connection-status`);
    elements[`${id}-connection-description`] = makeElement(`${id}-connection-description`);
  }

  globalThis.document = {
    getElementById: (id) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ id: '', className: '', innerHTML: '' }),
  };
  globalThis.window = { location: { search: '', href: 'https://x.test/account' }, addEventListener() {} };
  globalThis.__omegaClient = {
    getApiUrl: () => 'https://api.x.test',
    utilities: { escapeHTML: (value) => `${value}` },
    request: async () => ({}),
  };

  return { elements, appended };
}

/** Render the markup, run the REAL section over it, hand back what it did. */
async function runSection({ connectionsConfig = CONNECTIONS_CONFIG, account = new User({}, { uid: 'u1' }) } = {}) {
  await bundleOnce();

  const html = await renderConnections(connectionsConfig);
  const dom = documentFor(html);

  delete require.cache[require.resolve(BUNDLE)];
  const connectionsSection = require(BUNDLE);

  await connectionsSection.init();
  await connectionsSection.loadData(account, connectionsConfig);

  return { html, ...dom };
}

// A small DOM over the rendered markup: per-account cards are built at runtime,
// so these cases need a document that parses, inserts, clones and queries like
// a browser's. It throws on a selector it cannot read, never matching nothing.

class FakeText {
  constructor(data) {
    this.nodeType = 3;
    this.data = `${data}`;
    this.parentNode = null;
  }

  get textContent() {
    return this.data;
  }

  set textContent(value) {
    this.data = `${value}`;
  }

  get outerHTML() {
    return this.data;
  }

  cloneNode() {
    return new FakeText(this.data);
  }

  remove() {
    detachNode(this);
  }
}

class FakeElement {
  constructor(tag, attribs = {}) {
    this.nodeType = 1;
    this.localName = tag.toLowerCase();
    this.attribs = { ...attribs };
    this.childNodes = [];
    this.parentNode = null;
    this.style = {};
    this.content = this.localName === 'template' ? new FakeElement('#fragment') : undefined;
    this.dataset = new Proxy({}, {
      get: (_, key) => this.getAttribute(`data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`) ?? undefined,
      set: (_, key, value) => {
        this.setAttribute(`data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value);
        return true;
      },
    });
  }

  get tagName() {
    return this.localName.toUpperCase();
  }

  get id() {
    return this.attribs.id || '';
  }

  set id(value) {
    this.attribs.id = `${value}`;
  }

  get className() {
    return this.attribs.class || '';
  }

  set className(value) {
    this.attribs.class = `${value}`;
  }

  get classList() {
    const read = () => this.className.split(/\s+/).filter(Boolean);
    const write = (names) => {
      this.className = names.join(' ');
    };

    return {
      contains: (name) => read().includes(name),
      add: (...names) => write([...new Set([...read(), ...names])]),
      remove: (...names) => write(read().filter((name) => !names.includes(name))),
      toggle: (name, force) => {
        const on = force === undefined ? !read().includes(name) : !!force;
        write(on ? [...new Set([...read(), name])] : read().filter((entry) => entry !== name));
        return on;
      },
    };
  }

  get hidden() {
    return this.hasAttribute('hidden');
  }

  set hidden(value) {
    if (value) {
      this.setAttribute('hidden', '');
    } else {
      this.removeAttribute('hidden');
    }
  }

  get disabled() {
    return this.hasAttribute('disabled');
  }

  set disabled(value) {
    if (value) {
      this.setAttribute('disabled', '');
    } else {
      this.removeAttribute('disabled');
    }
  }

  get value() {
    return this.attribs.value || '';
  }

  set value(value) {
    this.attribs.value = `${value}`;
  }

  get type() {
    return this.attribs.type || '';
  }

  set type(value) {
    this.attribs.type = `${value}`;
  }

  get name() {
    return this.attribs.name || '';
  }

  set name(value) {
    this.attribs.name = `${value}`;
  }

  getAttribute(name) {
    return name in this.attribs ? this.attribs[name] : null;
  }

  setAttribute(name, value) {
    this.attribs[name] = `${value}`;
  }

  removeAttribute(name) {
    delete this.attribs[name];
  }

  hasAttribute(name) {
    return name in this.attribs;
  }

  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get parentElement() {
    return this.parentNode && !this.parentNode.localName.startsWith('#') ? this.parentNode : null;
  }

  get isConnected() {
    let node = this;

    while (node.parentNode) {
      node = node.parentNode;
    }

    return !!node.isDocumentRoot;
  }

  insertBefore(node, reference) {
    const nodes = node.localName === '#fragment' ? [...node.childNodes] : [node];

    for (const entry of nodes) {
      detachNode(entry);

      const index = reference ? this.childNodes.indexOf(reference) : -1;

      this.childNodes.splice(index === -1 ? this.childNodes.length : index, 0, entry);
      entry.parentNode = this;
    }

    return node;
  }

  appendChild(node) {
    return this.insertBefore(node, null);
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(asNode(node)));
  }

  prepend(...nodes) {
    const first = this.childNodes[0] || null;

    nodes.forEach((node) => this.insertBefore(asNode(node), first));
  }

  before(...nodes) {
    nodes.forEach((node) => this.parentNode.insertBefore(asNode(node), this));
  }

  after(...nodes) {
    const next = this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null;

    nodes.forEach((node) => this.parentNode.insertBefore(asNode(node), next));
  }

  replaceChildren(...nodes) {
    [...this.childNodes].forEach(detachNode);
    this.append(...nodes);
  }

  replaceWith(...nodes) {
    this.before(...nodes);
    this.remove();
  }

  remove() {
    detachNode(this);
  }

  insertAdjacentElement(position, element) {
    const place = {
      beforebegin: () => this.before(element),
      afterbegin: () => this.prepend(element),
      beforeend: () => this.append(element),
      afterend: () => this.after(element),
    }[position.toLowerCase()];

    if (!place) {
      throw new Error(`The harness DOM has no insert position ${position}`);
    }

    place();
    return element;
  }

  insertAdjacentHTML(position, html) {
    const fragment = new FakeElement('#fragment');

    fragment.append(...parseMarkup(html));
    this.insertAdjacentElement(position, fragment);
  }

  cloneNode(deep) {
    const copy = new FakeElement(this.localName, this.attribs);

    if (deep) {
      copy.append(...this.childNodes.map((node) => node.cloneNode(true)));

      if (this.content) {
        copy.content.append(...this.content.childNodes.map((node) => node.cloneNode(true)));
      }
    }

    return copy;
  }

  get innerHTML() {
    return this.childNodes.map((node) => node.outerHTML).join('');
  }

  set innerHTML(html) {
    this.replaceChildren(...parseMarkup(html));
  }

  get outerHTML() {
    const attribs = Object.entries(this.attribs).map(([name, value]) => ` ${name}="${`${value}`.replace(/"/g, '&quot;')}"`).join('');

    return `<${this.localName}${attribs}>${this.innerHTML}</${this.localName}>`;
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join('');
  }

  set textContent(value) {
    this.replaceChildren(new FakeText(value));
  }

  get innerText() {
    return this.textContent;
  }

  set innerText(value) {
    this.textContent = value;
  }

  querySelectorAll(selector) {
    const found = [];
    const walk = (element) => element.children.forEach((child) => {
      if (child.matches(selector)) {
        found.push(child);
      }

      walk(child);
    });

    walk(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  matches(selector) {
    return splitTopLevel(selector, ',').some((complex) => matchesSteps(this, parseComplex(complex)));
  }

  closest(selector) {
    for (let element = this; element; element = element.parentElement) {
      if (element.matches(selector)) {
        return element;
      }
    }

    return null;
  }

  addEventListener() {}

  removeEventListener() {}

  focus() {}
}

function detachNode(node) {
  if (node.parentNode) {
    node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
    node.parentNode = null;
  }
}

function asNode(value) {
  return typeof value === 'string' ? new FakeText(value) : value;
}

/** Markup to harness nodes, through the cheerio parser web already ships with. */
function parseMarkup(html) {
  const convert = (node) => {
    if (node.type === 'text') {
      return new FakeText(node.data);
    }

    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') {
      return null;
    }

    const element = new FakeElement(node.name, node.attribs);
    const kids = (node.children || []).flatMap((child) => (child.type === 'root' ? child.children : [child]));
    const target = element.content || element;

    target.append(...kids.map(convert).filter(Boolean));
    return element;
  };

  return cheerio.load(`${html}`, null, false).root()[0].children.map(convert).filter(Boolean);
}

/** Split on a character outside brackets, parentheses and quotes. */
function splitTopLevel(text, separator) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = null;

  for (const ch of text) {
    if (quote) {
      quote = ch === quote ? null : quote;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '[' || ch === '(') {
      depth += 1;
    } else if (ch === ']' || ch === ')') {
      depth -= 1;
    } else if (depth === 0 && (separator === ' ' ? /\s|>/.test(ch) : ch === separator)) {
      parts.push(current);
      parts.push(ch === '>' ? '>' : null);
      current = '';
      continue;
    }

    current += ch;
  }

  parts.push(current);
  return separator === ' ' ? parts : parts.filter((part) => part !== null).map((part) => part.trim());
}

/** A complex selector as compound steps, each with the combinator before it. */
function parseComplex(text) {
  const steps = [];
  let combinator = ' ';

  for (const part of splitTopLevel(text.trim(), ' ')) {
    if (part === '>') {
      combinator = '>';
    } else if (part) {
      steps.push({ combinator, compound: parseCompound(part) });
      combinator = ' ';
    }
  }

  return steps;
}

function parseCompound(text) {
  const compound = { tag: null, ids: [], classes: [], attrs: [], nots: [] };
  const pattern = /^(?:(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\]|:not\(([^)]*)\))/;
  let rest = text;

  while (rest) {
    const match = rest.match(pattern);

    if (!match) {
      throw new Error(`The harness DOM cannot read the selector part "${rest}" of "${text}"`);
    }

    if (match[1]) {
      compound.tag = match[1] === '*' ? null : match[1].toLowerCase();
    } else if (match[2]) {
      compound.ids.push(match[2]);
    } else if (match[3]) {
      compound.classes.push(match[3]);
    } else if (match[4]) {
      compound.attrs.push({ name: match[4], operator: match[5], value: match[6] ?? match[7] ?? match[8] });
    } else {
      compound.nots.push(match[9]);
    }

    rest = rest.slice(match[0].length);
  }

  return compound;
}

function matchesAttr(element, { name, operator, value }) {
  const actual = element.getAttribute(name);

  if (actual === null) {
    return false;
  }

  return {
    undefined: () => true,
    '=': () => actual === value,
    '~=': () => actual.split(/\s+/).includes(value),
    '^=': () => actual.startsWith(value),
    '$=': () => actual.endsWith(value),
    '*=': () => actual.includes(value),
  }[operator]();
}

function matchesCompound(element, compound) {
  return (!compound.tag || element.localName === compound.tag)
    && compound.ids.every((id) => element.id === id)
    && compound.classes.every((name) => element.classList.contains(name))
    && compound.attrs.every((attr) => matchesAttr(element, attr))
    && compound.nots.every((selector) => !element.matches(selector));
}

function matchesSteps(element, steps, index = steps.length - 1) {
  if (!matchesCompound(element, steps[index].compound)) {
    return false;
  }

  if (index === 0) {
    return true;
  }

  if (steps[index].combinator === '>') {
    return !!element.parentElement && matchesSteps(element.parentElement, steps, index - 1);
  }

  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (matchesSteps(parent, steps, index - 1)) {
      return true;
    }
  }

  return false;
}

/** The rendered markup as a document the section can build cards in. */
function markupDocument(html) {
  const root = new FakeElement('html');
  const body = new FakeElement('body');

  root.isDocumentRoot = true;
  root.appendChild(body);
  body.append(...parseMarkup(html));

  return {
    documentElement: root,
    body,
    getElementById: (id) => root.querySelectorAll('*').find((element) => element.id === id) || null,
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (data) => new FakeText(data),
    createDocumentFragment: () => new FakeElement('#fragment'),
    addEventListener() {},
    removeEventListener() {},
  };
}

/** Render the markup and run the REAL section over the harness DOM. */
async function runAccountSection({ connectionsConfig, account }) {
  await bundleOnce();

  const document = markupDocument(await renderConnections(connectionsConfig));

  globalThis.document = document;
  globalThis.window = { location: { search: '', href: 'https://x.test/account' }, addEventListener() {} };
  globalThis.__omegaClient = {
    getApiUrl: () => 'https://api.x.test',
    utilities: { escapeHTML: (value) => `${value}` },
    request: async () => ({}),
  };

  delete require.cache[require.resolve(BUNDLE)];
  const connectionsSection = require(BUNDLE);

  await connectionsSection.init();
  await connectionsSection.loadData(account, connectionsConfig);

  return document;
}

function isShown(element) {
  if (!element.isConnected) {
    return false;
  }

  for (let node = element; node; node = node.parentElement) {
    if (node.classList.contains('d-none') || node.hidden) {
      return false;
    }
  }

  return true;
}

const visibleText = (element) => element.textContent.replace(/\s+/g, ' ').trim();

/** The shown controls under `root` that read exactly `label`. */
function shownControls(root, label) {
  return root.querySelectorAll('button, a, input:not([type="hidden"])')
    .filter(isShown)
    .filter((control) => (visibleText(control) || control.value) === label);
}

/** The card an account's display name sits on: the widest shown block under the list holding one Disconnect. */
function accountCard(document, displayName) {
  const list = document.getElementById('connections-list');
  const holder = list.querySelectorAll('*')
    .filter((element) => isShown(element) && visibleText(element).includes(displayName))
    .find((element) => !element.children.some((child) => visibleText(child).includes(displayName)));
  let card = null;

  for (let element = holder; element && element !== list; element = element.parentElement) {
    const disconnects = shownControls(element, 'Disconnect').length;

    if (disconnects > 1) {
      break;
    }

    card = disconnects === 1 ? element : card;
  }

  return card;
}

/** One linked account, as tokenize stores it under its identity id. */
function linkedAccount(id, name) {
  return {
    type: 'oauth2',
    token: { access_token: `access-${id}`, refresh_token: `refresh-${id}` },
    identity: { id, name },
  };
}

function accountWith(...accounts) {
  return new User({ connections: { google: Object.fromEntries(accounts.map((entry) => [entry.identity.id, entry])) } }, { uid: 'u1' });
}

/** Every `.html` under the theme tree, so a case can read what ships. */
function themeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return themeFiles(full);
    }

    return entry.name.endsWith('.html') ? [full] : [];
  });
}

test('#793: the framework ships a card for every packaged provider, in the config defaults', () => {
  const expected = ['google', 'discord', 'spotify', 'twitch', 'kick'];

  assert.deepEqual(Object.keys(PACKAGED).sort(), [...expected].sort(), 'the five providers @omega.js/backend ships a module for');

  for (const provider of expected) {
    const entry = PACKAGED[provider];

    assert.ok(entry.name, `${provider} has the name its card says`);
    assert.ok(entry.description, `${provider} has the line under it`);
    assert.ok(!entry.logo.includes('/') && !entry.logo.includes(':'), `${provider}'s logo is a mark NAME, never a CDN url: ${entry.logo}`);
    assert.ok(fs.existsSync(path.join(MARKS_DIR, `${entry.logo}.svg`)), `and the mark SHIPS in this package: ${entry.logo}.svg`);
  }
});

test('#792: a brand that only ENABLES a packaged provider gets a drawn card', async () => {
  const html = await renderConnections({ google: { ...PACKAGED.google, enabled: true } });

  assert.deepEqual(cardIds(html), ['google'], 'the config is the whole list');
  assert.ok(html.includes('>Google<'), "the name comes from the framework's defaults");
  assert.ok(html.includes('<svg'), 'and the logo is the packaged mark, inlined by omega_logo');
  assert.ok(!html.includes('<img'), 'never an <img> for a mark name');
  assert.ok(!html.includes('cdn.itwcreativeworks.com'), 'and nothing points at the CDN files that 404');
  assert.ok(html.includes(markSignature('google')), "the mark drawn is the one the logo names");
});

test("#792: a brand's own logo wins over the packaged one, and a URL still renders an img", async () => {
  const overridden = await renderConnections({ google: { ...PACKAGED.google, enabled: true, logo: 'github' } });

  assert.ok(overridden.includes(markSignature('github')), "the brand's mark is what is drawn");
  assert.ok(!overridden.includes(markSignature('google')), 'and the packaged one is not');

  const url = await renderConnections({ google: { ...PACKAGED.google, enabled: true, logo: 'https://cdn.test/google.svg' } });

  assert.ok(url.includes('<img'), 'a full URL is still an <img>');
  assert.ok(url.includes('https://cdn.test/google.svg'), 'pointing at what the brand named');
});

test('#792: no connections: frontmatter row survives anywhere in the theme', () => {
  const offenders = themeFiles(THEMES_DIR).filter((file) => {
    const source = fs.readFileSync(file, 'utf8');

    if (!source.startsWith('---')) {
      return false;
    }

    const frontmatter = yaml.load(source.split('---')[1]) || {};

    return Object.prototype.hasOwnProperty.call(frontmatter, 'connections');
  });

  assert.deepEqual(offenders, [], `the config is the only card list: ${offenders.join(', ')}`);
  assert.ok(!ACCOUNT_LAYOUT.includes('cdn.itwcreativeworks.com/assets/general/images/brands/color/kick.svg'), 'and the CDN logos that 404 are gone with them');
  assert.ok(ACCOUNT_LAYOUT.includes('{% include frontend/sections/account-connections.html %}'), 'the layout renders the shared connections include');
});

test('#771: an enabled provider with a card is shown; one without gets the unsupported card', async () => {
  const { elements, appended } = await runSection();

  assert.ok(!elements['connection-google'].classes.has('d-none'), 'a packaged provider the brand enabled is shown');
  assert.ok(!elements['connection-house-sso'].classes.has('d-none'), "and a brand's own, with no allowlist to be on");

  assert.equal(appended.length, 1, 'exactly one provider had no card to show');

  const warning = appended[0];

  assert.equal(warning.id, 'connection-no-card-unconfigured', 'the unsupported card names the provider it stands for');
  assert.ok(warning.innerHTML.includes('Unsupported connection'), 'it says the connection is unsupported');
  assert.ok(warning.innerHTML.includes('"name"') && warning.innerHTML.includes('"logo"'), `it says what the config entry is missing: ${warning.innerHTML}`);
  assert.ok(!/Ultimate Jekyll Manager/i.test(warning.innerHTML), 'and never tells anyone to update a framework that does not exist');
});

test('#771: a disabled provider is hidden, and a page with nothing enabled says so', async () => {
  const { elements, appended } = await runSection({
    connectionsConfig: {
      google: { ...PACKAGED.google, enabled: false },
      twitch: { ...PACKAGED.twitch, enabled: false },
    },
  });

  assert.ok(elements['connection-google'].classes.has('d-none'), 'a disabled provider stays hidden');
  assert.ok(elements['connection-twitch'].classes.has('d-none'), 'even when its card exists');
  assert.equal(appended.length, 0, 'and a disabled provider never draws a warning');
  assert.ok(!elements['connections-empty'].classes.has('d-none'), 'the empty message is shown instead');
});

test('#771: a config key that is not a legal provider name never shows a live card', async () => {
  const { elements, appended } = await runSection({ connectionsConfig: CONNECTIONS_CONFIG_BAD_KEY });

  // The card may EXIST (the key carries name + logo), but it is never shown:
  // no authorize call could succeed for a name the backend's loader refuses
  assert.ok(elements['connection-HouseSSO'].classes.has('d-none'), 'the card stays hidden');
  assert.equal(appended.length, 1, 'and the warning card is drawn instead');

  const warning = appended[0];

  assert.ok(/lowercase/i.test(warning.innerHTML), `the warning says what a provider id may be: ${warning.innerHTML}`);
  assert.ok(/dash/i.test(warning.innerHTML), 'naming the allowed characters');
  assert.ok(!/"name"/.test(warning.innerHTML), 'and never blames the fields, which this entry has');
});

test('#793: the section drives from the config alone — no allowlist, no second description list', async () => {
  assert.ok(!/supportedProviders/.test(CONNECTIONS_SOURCE), 'the hardcoded provider allowlist is gone');
  assert.ok(!/defaultDescriptions/.test(CONNECTIONS_SOURCE), 'and the descriptions map naming providers this lane cannot connect');
  assert.ok(/Object\.keys\(availableProviders\)/.test(CONNECTIONS_SOURCE), 'the config keys are the list');
  assert.ok(!/Ultimate Jekyll Manager/i.test(CONNECTIONS_SOURCE), 'and the dead advice with it');

  // The description a card shows comes from the config entry, which is where
  // the framework's own default for a packaged provider lives now
  const { elements } = await runSection();

  assert.equal(
    elements['google-connection-description'].textContent,
    PACKAGED.google.description,
    "the packaged description is what the card says when the brand wrote none",
  );
});

test('#1061: two linked accounts at max 2 draw two cards, each with its own Disconnect, and no Connect', async () => {
  const document = await runAccountSection({
    connectionsConfig: { google: { ...PACKAGED.google, enabled: true, max: 2 } },
    account: accountWith(linkedAccount('sub-alpha', 'Alpha Channel'), linkedAccount('sub-beta', 'Beta Channel')),
  });

  const alpha = accountCard(document, 'Alpha Channel');
  const beta = accountCard(document, 'Beta Channel');

  assert.ok(alpha, 'the first account has a shown card with a Disconnect');
  assert.ok(beta, 'and so does the second');
  assert.notEqual(alpha, beta, 'one card per account');

  for (const card of [alpha, beta]) {
    assert.ok(visibleText(card).includes('Google'), `each card names the provider: ${visibleText(card)}`);
    assert.equal(shownControls(card, 'Disconnect').length, 1, 'and carries exactly one Disconnect, its own');
  }

  const list = document.getElementById('connections-list');

  assert.equal(shownControls(list, 'Connect').length, 0, 'at max, no Connect control shows');
});

test('#1061: under max, the Connect control shows beside the linked account', async () => {
  const document = await runAccountSection({
    connectionsConfig: { google: { ...PACKAGED.google, enabled: true, max: 2 } },
    account: accountWith(linkedAccount('sub-alpha', 'Alpha Channel')),
  });

  const alpha = accountCard(document, 'Alpha Channel');
  const list = document.getElementById('connections-list');

  assert.ok(alpha, 'the linked account has a shown card with a Disconnect');
  assert.equal(shownControls(list, 'Connect').length, 1, 'one account of two allowed: the Connect control shows');
});

test('#1061: a record still in the old one-level shape draws no card and keeps Connect', async () => {
  // Until the users migration runs, the record sits at `connections.google`
  // itself: its keys are not accounts, so nothing is drawn for them
  const document = await runAccountSection({
    connectionsConfig: { google: { ...PACKAGED.google, enabled: true } },
    account: new User({ connections: { google: linkedAccount('sub-alpha', 'Alpha Channel') } }, { uid: 'u1' }),
  });

  const list = document.getElementById('connections-list');

  assert.equal(shownControls(list, 'Disconnect').length, 0, 'no account card is drawn');
  assert.equal(shownControls(list, 'Connect').length, 1, 'and the Connect control shows');
});
