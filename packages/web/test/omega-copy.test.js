/**
 * Declarative copy-to-clipboard ([#709](https://github.com/Omega-JS-Stack/omega/issues/709))
 * — an element carrying `data-omega-copy` IS a copy control, with no page JS.
 *
 * Every copy button used to be hand-wired: the framework's own account page
 * wrote `clipboardCopy` + `showNotification` three times over, and each brand
 * that wanted a copy row wrote it again. The mechanism is one delegated
 * `document` handler (the alert-dismiss lane), so a row rendered after boot
 * works too, and the value it copies is RESOLVED — an explicit value the
 * markup or the page set, else a target named by selector, else the sibling
 * input in the same input-group. The explicit lane is load-bearing: a
 * key-bearing row displays a mask and must copy the real credential.
 *
 * Browser code behind the `@omega.js/client` alias, so the harness drives the
 * REAL file through esbuild with the client stubbed, over a hand-rolled
 * document that is only what the handler touches (node has no DOM and web
 * pulls in no jsdom) — the convention alert-dismiss.test.js set.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const ENTRY = path.join(CORE_DIR, 'js', 'libs', 'omega-copy.js');
const MAIN = path.join(CORE_DIR, 'js', 'main.js');
const API_KEYS = path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'sections', 'api-keys.js');
const SECTIONS_DIR = path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'sections');
const ACCOUNT_LAYOUT = path.join(__dirname, '..', 'themes', 'base', '_layouts', 'frontend', 'pages', 'account', 'index.html');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-copy-'));
const BUNDLE = path.join(BUNDLE_DIR, 'omega-copy.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [ENTRY],
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
      },
    }],
  });

  return building;
}

/** Only the selector forms the handler asks for: `#id`, `.class`, `[attr]`, a tag. */
function matches(element, selector) {
  return selector.split(',').map((part) => part.trim()).some((part) => {
    if (part.startsWith('#')) {
      return element.getAttribute('id') === part.slice(1);
    }
    if (part.startsWith('.')) {
      return element.classList.contains(part.slice(1));
    }
    if (part.startsWith('[')) {
      const [, name, value] = /^\[([^\]=]+)(?:="([^"]*)")?\]$/.exec(part);

      return value === undefined
        ? element.getAttribute(name) !== null
        : element.getAttribute(name) === value;
    }

    return element.tagName === part.toUpperCase();
  });
}

/** Every descendant, depth-first. */
function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

/** The minimum element the handler walks: attributes, classes, a parent chain, a value. */
function makeElement(tagName, attributes = {}) {
  const classes = new Set(String(attributes.class || '').split(/\s+/).filter(Boolean));

  const element = {
    // Uppercase, the way a real element answers.
    tagName: tagName.toUpperCase(),
    parent: null,
    children: [],
    attributes: { ...attributes },
    classList: {
      contains: (name) => classes.has(name),
    },
    appendChild: (node) => {
      node.parent = element;
      element.children.push(node);
      return node;
    },
    getAttribute: (name) => (name in element.attributes ? element.attributes[name] : null),
    closest: (selector) => {
      let node = element;

      while (node) {
        if (matches(node, selector)) {
          return node;
        }
        node = node.parent;
      }

      return null;
    },
    querySelector: (selector) => descendants(element).find((node) => matches(node, selector)) || null,
  };

  return element;
}

/** The minimum document the handler binds to, plus a way to click inside it. */
function makeDocument() {
  const listeners = {};
  const root = makeElement('body');

  return {
    root,
    addEventListener: (type, handler) => { (listeners[type] ||= []).push(handler); },
    querySelector: (selector) => descendants(root).find((node) => matches(node, selector)) || null,
    click: (target) => {
      const event = {
        target,
        defaultPrevented: false,
        preventDefault: () => { event.defaultPrevented = true; },
      };

      return Promise.all((listeners.click || []).map((handler) => handler(event))).then(() => event);
    },
  };
}

/** The client the handler reaches for: the clipboard, and what it told the visitor. */
function makeClient({ fail = false } = {}) {
  const copied = [];
  const notifications = [];

  return {
    copied,
    notifications,
    utilities: {
      clipboardCopy: async (value) => {
        if (fail) {
          throw new Error('clipboard denied');
        }
        copied.push(value);
      },
      showNotification: (message, type) => { notifications.push({ message, type }); },
    },
  };
}

/** Arm the real handler over one fresh document. */
async function boot(clientOptions) {
  await bundleOnce();

  const doc = makeDocument();
  const client = makeClient(clientOptions);

  globalThis.document = doc;
  globalThis.__omegaClient = client;

  delete require.cache[require.resolve(BUNDLE)];
  require(BUNDLE).setupCopy();

  return { doc, client };
}

/** An input-group row: a displayed field and the copy button beside it. */
function makeRow(doc, { displayed, attributes = {} }) {
  const group = makeElement('div', { class: 'input-group' });
  const input = makeElement('input', { class: 'form-control' });
  const button = makeElement('button', { 'data-omega-copy': '', ...attributes });
  const icon = makeElement('i', { class: 'fa-solid fa-copy' });

  input.value = displayed;
  group.appendChild(input);
  group.appendChild(button);
  button.appendChild(icon);
  doc.root.appendChild(group);

  return { group, input, button, icon };
}

module.exports = defineCases({
  type: 'group',
  description: 'omega-copy',
  cleanup: () => {
    delete globalThis.document;
    delete globalThis.__omegaClient;
  },
  tests: [
    {
      name: 'the explicit value lane copies the real credential, not the displayed mask',
      run: async (ctx) => {
        // switchboard's key rows: the field SHOWS `sk_live_••••`, the clipboard must
        // get the key. Display and clipboard are allowed to differ, by design.
        const { doc, client } = await boot();
        const row = makeRow(doc, {
          displayed: 'sk_live_••••••••',
          attributes: { 'data-omega-copy-value': 'sk_live_abcdef123456' },
        });

        const event = await doc.click(row.button);

        ctx.expect(client.copied, 'the real credential reached the clipboard').toEqual(['sk_live_abcdef123456']);
        ctx.expect(event.defaultPrevented, 'the copy owns the click').toBe(true);
      },
    },

    {
      name: 'a value the page set as a property is copied',
      run: async (ctx) => {
        // The page-JS lane: a row rendered from data holds its value on the element
        // rather than in an attribute, so a secret never lands in the markup.
        const { doc, client } = await boot();
        const row = makeRow(doc, { displayed: '••••' });

        row.button.omegaCopyValue = 'from-the-page';

        await doc.click(row.button);

        ctx.expect(client.copied, 'the property is the copied value').toEqual(['from-the-page']);
      },
    },

    {
      name: 'a selector names the target — an input by value, a block by its text',
      run: async (ctx) => {
        const { doc, client } = await boot();

        const input = makeElement('input', { id: 'mcp-url-input' });
        input.value = 'https://api.example.com/mcp';
        const inputButton = makeElement('button', { 'data-omega-copy': '#mcp-url-input' });

        const block = makeElement('pre', { id: 'mcp-cmd-cursor' });
        block.textContent = '{\n  "mcpServers": {}\n}';
        const blockButton = makeElement('button', { 'data-omega-copy': '#mcp-cmd-cursor' });

        [input, inputButton, block, blockButton].forEach((node) => doc.root.appendChild(node));

        await doc.click(inputButton);
        await doc.click(blockButton);

        ctx.expect(client.copied, 'the input answered with its value and the block with its text').toEqual(['https://api.example.com/mcp', '{\n  "mcpServers": {}\n}']);
      },
    },

    {
      name: 'with neither, the sibling input in the same input-group is the value',
      run: async (ctx) => {
        const { doc, client } = await boot();
        const row = makeRow(doc, { displayed: 'omega_private_key' });

        // A click on the ICON inside the button still copies — the handler walks up
        // to the control, which is what delegation buys.
        await doc.click(row.icon);

        ctx.expect(client.copied, 'the row beside the button was copied').toEqual(['omega_private_key']);
      },
    },

    {
      name: 'a successful copy says so, in the account page\'s words',
      run: async (ctx) => {
        const { doc, client } = await boot();
        const row = makeRow(doc, { displayed: 'omega_private_key' });

        await doc.click(row.button);

        ctx.expect(client.notifications).toEqual([{ message: 'Copied!', type: 'success' }]);
      },
    },

    {
      name: 'a refused clipboard is reported, and never as a success',
      run: async (ctx) => {
        // A browser can deny the clipboard (permission, an insecure context); the
        // visitor must not be told their key is in the buffer when it is not.
        const { doc, client } = await boot({ fail: true });
        const row = makeRow(doc, { displayed: 'omega_private_key' });

        await doc.click(row.button);

        ctx.expect(client.notifications).toEqual([{ message: 'Failed to copy', type: 'danger' }]);
      },
    },

    {
      name: 'a control that resolves nothing warns instead of copying an empty string',
      run: async (ctx) => {
        // An empty value resolves to "nothing to copy", never a silently emptied
        // clipboard. (The live api-key field ships value="Loading..." pre-load, not
        // empty — but that window is unreachable: the section stays d-none until
        // loadData has overwritten the value.)
        const { doc, client } = await boot();
        const row = makeRow(doc, { displayed: '' });

        await doc.click(row.button);

        ctx.expect(client.copied, 'nothing reached the clipboard').toEqual([]);
        ctx.expect(client.notifications).toEqual([{ message: 'Nothing to copy', type: 'warning' }]);
      },
    },

    {
      name: 'a click outside any copy control is left alone',
      run: async (ctx) => {
        const { doc, client } = await boot();
        const link = makeElement('a');

        doc.root.appendChild(link);

        const event = await doc.click(link);

        ctx.expect(client.copied, 'no copy happened').toEqual([]);
        ctx.expect(event.defaultPrevented, 'the link still navigates').toBe(false);
      },
    },

    {
      name: 'a row added after wiring copies — the handler is delegated, not bound',
      run: async (ctx) => {
        const { doc, client } = await boot();

        // Everything above existed before setupCopy() ran only by construction; a
        // dynamically rendered row is the case the delegation exists for.
        const late = makeRow(doc, { displayed: 'added-later' });

        await doc.click(late.button);

        ctx.expect(client.copied, 'the late row is a copy control too').toEqual(['added-later']);
      },
    },

    {
      name: 'the account page rides the mechanism instead of wiring its own copies',
      run: (ctx) => {
        // Half the contract is the markup: the migration is only real if the page's
        // buttons carry the attribute AND its hand-rolled handlers are gone.
        const layout = fs.readFileSync(ACCOUNT_LAYOUT, 'utf8');
        const section = fs.readFileSync(API_KEYS, 'utf8');
        const main = fs.readFileSync(MAIN, 'utf8');

        ctx.expect((layout.match(/data-copy-target/g) || []).length, 'the page-owned vocabulary is gone').toBe(0);
        ctx.expect((layout.match(/data-omega-copy/g) || []).length >= 12, 'every copy button carries the mechanism\'s attribute').toBeTruthy();
        ctx.expect(!/clipboardCopy/.test(section), 'the section copies nothing by hand').toBeTruthy();
        ctx.expect(/setupCopy\(\)/.test(main), 'the global module arms the mechanism').toBeTruthy();
      },
    },

    {
      name: 'the account page has ONE copy-feedback shape — no section wires its own',
      run: (ctx) => {
        // The four rows #709 left behind kept the old in-button `btn-success` swap, so
        // the same page answered a copy two different ways
        // ([#727](https://github.com/Omega-JS-Stack/omega/issues/727)). The markup
        // half and the JS half are one assertion: the attribute is on, the handlers
        // are gone.
        const layout = fs.readFileSync(ACCOUNT_LAYOUT, 'utf8');
        const buttons = ['copy-uid-btn', 'signin-link-copy-btn', 'copy-push-token-btn', 'copy-referral-code-btn'];

        buttons.forEach((id) => {
          const [, attributes] = new RegExp(`<button([^>]*id="${id}"[^>]*)>`).exec(layout) || [];

          ctx.expect(attributes, `${id} is in the markup`).toBeTruthy();
          ctx.expect(/\bdata-omega-copy\b/.test(attributes), `${id} rides the mechanism`).toBeTruthy();
          ctx.expect(/\baria-label="/.test(attributes), `${id} names itself for a screen reader`).toBeTruthy();
        });

        ['profile.js', 'security.js', 'notifications.js', 'referrals.js'].forEach((file) => {
          const source = fs.readFileSync(path.join(SECTIONS_DIR, file), 'utf8');

          ctx.expect(!/clipboardCopy|execCommand|clipboard\.writeText/.test(source), `${file} copies nothing by hand`).toBeTruthy();
          ctx.expect(!/btn-success/.test(source), `${file} swaps no button into a confirmation of its own`).toBeTruthy();
        });
      },
    },
  ],
});
