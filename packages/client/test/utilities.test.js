const defineCases = require('@omega.js/devkit/test/define-cases');
const { getOmega, TEST_CONFIG, createOmega, clearStorage, disposeOmega } = require('./helpers.js');

const beforeEachHook = clearStorage;

module.exports = defineCases({
  type: 'group',
  description: 'utilities',
  setup: createOmega,
  cleanup: disposeOmega,
  tests: [
    ...(() => {
      const cases = [];
      let beforeHookRun;
      const beforeHook = (ctx) => (beforeHookRun ||= Promise.resolve().then(() => (async () => {
        await getOmega().initialize(TEST_CONFIG);
      })()));

      cases.push(
        {
          name: 'Utilities Module > escapeHTML > should escape HTML strings',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const u = getOmega().utilities;
            ctx.expect(u.escapeHTML('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
          },
        },
        {
          name: 'Utilities Module > escapeHTML > should escape objects recursively',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const u = getOmega().utilities;
            const input = {
              name: '<b>John</b>',
              email: 'john@example.com',
              nested: { bio: '<img src=x onerror=alert(1)>', count: 42, active: true },
            };
            const escaped = u.escapeHTML(input);

            ctx.expect(escaped.name).toBe('&lt;b&gt;John&lt;/b&gt;');
            ctx.expect(escaped.email).toBe('john@example.com');
            ctx.expect(escaped.nested.bio).toBe('&lt;img src=x onerror=alert(1)&gt;');
            ctx.expect(escaped.nested.count).toBe(42);
            ctx.expect(escaped.nested.active).toBe(true);

            // Original is not mutated
            ctx.expect(input.name).toBe('<b>John</b>');
          },
        },
        {
          name: 'Utilities Module > escapeHTML > should escape arrays',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const escaped = getOmega().utilities.escapeHTML(['<b>bold</b>', 'safe', 123]);
            ctx.expect(escaped[0]).toBe('&lt;b&gt;bold&lt;/b&gt;');
            ctx.expect(escaped[1]).toBe('safe');
            ctx.expect(escaped[2]).toBe(123);
          },
        },
        {
          name: 'Utilities Module > escapeHTML > should pass through null, undefined, numbers, and booleans',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const u = getOmega().utilities;
            ctx.expect(u.escapeHTML(null)).toBe(null);
            ctx.expect(u.escapeHTML(undefined)).toBe(undefined);
            ctx.expect(u.escapeHTML(42)).toBe(42);
            ctx.expect(u.escapeHTML(true)).toBe(true);
          },
        },
        {
          name: 'Utilities Module > escapeHTML > should work when detached from the utilities instance',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            // Methods are arrow class fields — `this` is permanently bound to the instance,
            // so destructuring, aliasing, or passing as a callback must all work.
            const utilities = getOmega().utilities;

            // Destructured
            const { escapeHTML } = utilities;
            ctx.expect(escapeHTML('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');

            // Aliased via property access
            const escape = utilities.escapeHTML;
            ctx.expect(escape('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');

            // Passed as a callback
            const result = ['<a>', '<b>'].map(utilities.escapeHTML);
            ctx.expect(result[0]).toBe('&lt;a&gt;');
            ctx.expect(result[1]).toBe('&lt;b&gt;');
          },
        },
      );

      cases.push(
        {
          name: 'Utilities Module > Detection methods > getPlatform should return a string',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(typeof getOmega().utilities.getPlatform() === 'string').toBeTruthy();
          },
        },
        {
          name: 'Utilities Module > Detection methods > getBrowser should return string or null',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const browser = getOmega().utilities.getBrowser();
            ctx.expect(browser === null || typeof browser === 'string').toBeTruthy();
          },
        },
        {
          name: 'Utilities Module > Detection methods > getRuntime should return web by default',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(getOmega().utilities.getRuntime()).toBe('web');
          },
        },
        {
          name: 'Utilities Module > Detection methods > getRuntime should use config override',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const omega = getOmega();
            await omega.initialize({ ...TEST_CONFIG, runtime: 'electron' });
            ctx.expect(omega.utilities.getRuntime()).toBe('electron');
            await omega.initialize(TEST_CONFIG);
          },
        },
        {
          name: 'Utilities Module > Detection methods > isMobile should return a boolean',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(typeof getOmega().utilities.isMobile()).toBe('boolean');
          },
        },
        {
          name: 'Utilities Module > Detection methods > getDevice should return mobile, tablet, or desktop',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const device = getOmega().utilities.getDevice();
            ctx.expect(['mobile', 'tablet', 'desktop'].includes(device)).toBeTruthy();
          },
        },
      );

      cases.push(
        {
          name: 'Utilities Module > sanitizeURL > should keep an http(s) URL and reject every other scheme',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const u = getOmega().utilities;
            ctx.expect(u.sanitizeURL('https://example.com/a')).toBe('https://example.com/a');
            ctx.expect(u.sanitizeURL('javascript:alert(1)')).toBe('');
            ctx.expect(u.sanitizeURL('data:text/html;base64,AAAA')).toBe('');
          },
        },
      );

      cases.push(
        {
          name: 'Utilities Module > renderMarkdown > should render nothing for an empty body, so the caller can say what that means',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const u = getOmega().utilities;
            ctx.expect(u.renderMarkdown('')).toBe('');
            ctx.expect(u.renderMarkdown('   \n\n')).toBe('');
            ctx.expect(u.renderMarkdown(null)).toBe('');
            ctx.expect(u.renderMarkdown(undefined)).toBe('');
          },
        },
        {
          name: 'Utilities Module > renderMarkdown > should render markup in the source as text, whatever the grammar around it',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(getOmega().utilities.renderMarkdown('<script>alert(1)</script>\n\n- <img src=x onerror=alert(1)>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><ul><li>&lt;img src=x onerror=alert(1)&gt;</li></ul>');
          },
        },
        {
          name: 'Utilities Module > renderMarkdown > should escape the quotes an attribute injection would need',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(getOmega().utilities.renderMarkdown('see [say "hi"](https://ok.com/a"b)')).toBe('<p>see <a href="https://ok.com/a&quot;b" target="_blank" rel="noopener">say &quot;hi&quot;</a></p>');
            ctx.expect(getOmega().utilities.renderMarkdown(`it's <b>fine</b>`)).toBe('<p>it&#039;s &lt;b&gt;fine&lt;/b&gt;</p>');
          },
        },
        {
          name: 'Utilities Module > renderMarkdown > should render the small grammar the renderer claims',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(getOmega().utilities.renderMarkdown('## Spec\n\nOne **bold** and `code`.\n\n- first\n- second\n\n1. step')).toBe('<h5 class="h6 mt-3 mb-2">Spec</h5>'
                + '<p>One <strong>bold</strong> and <code>code</code>.</p>'
                + '<ul><li>first</li><li>second</li></ul>'
                + '<ol><li>step</li></ol>');
          },
        },
        {
          name: 'Utilities Module > renderMarkdown > should start headings below the host page title and floor them at h6',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const u = getOmega().utilities;
            ctx.expect(u.renderMarkdown('# Title')).toBe('<h4 class="h6 mt-3 mb-2">Title</h4>');
            ctx.expect(u.renderMarkdown('#### Deep')).toBe('<h6 class="h6 mt-3 mb-2">Deep</h6>');
            ctx.expect(u.renderMarkdown('###### Deepest')).toBe('<h6 class="h6 mt-3 mb-2">Deepest</h6>');
          },
        },
        {
          name: 'Utilities Module > renderMarkdown > should render italics and join the lines of one paragraph',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const u = getOmega().utilities;
            ctx.expect(u.renderMarkdown('an *italic* word')).toBe('<p>an <em>italic</em> word</p>');
            ctx.expect(u.renderMarkdown('line one\nline two')).toBe('<p>line one<br>line two</p>');
          },
        },
        {
          name: 'Utilities Module > renderMarkdown > should treat a fenced block as literal, emphasis and all',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(getOmega().utilities.renderMarkdown('```\nrm -rf *not*bold*\n<b>x</b>\n```')).toBe('<pre class="p-2 rounded"><code>rm -rf *not*bold*\n&lt;b&gt;x&lt;/b&gt;</code></pre>');
          },
        },
        {
          name: 'Utilities Module > renderMarkdown > should keep the content of an unterminated fence instead of dropping it',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(getOmega().utilities.renderMarkdown('```\nhalf a block')).toBe('<pre class="p-2 rounded"><code>half a block</code></pre>');
          },
        },
        {
          name: 'Utilities Module > renderMarkdown > should link only the schemes a browser may follow',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const u = getOmega().utilities;
            ctx.expect(u.renderMarkdown('see [the spec](https://example.com/a)')).toBe('<p>see <a href="https://example.com/a" target="_blank" rel="noopener">the spec</a></p>');
            ctx.expect(u.renderMarkdown('see [click](javascript:alert(1))')).toBe('<p>see [click](javascript:alert(1))</p>');
            ctx.expect(u.renderMarkdown('see [x](data:text/html;base64,AAAA)')).toBe('<p>see [x](data:text/html;base64,AAAA)</p>');
            ctx.expect(u.renderMarkdown('see [x](/relative/path)')).toBe('<p>see [x](/relative/path)</p>');
          },
        },
        {
          name: 'Utilities Module > renderMarkdown > should carry an href holding asterisks through the emphasis pass untouched',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            ctx.expect(getOmega().utilities.renderMarkdown('see [x](https://ok.com/*a*b*)')).toBe('<p>see <a href="https://ok.com/*a*b*" target="_blank" rel="noopener">x</a></p>');
          },
        },
        {
          name: 'Utilities Module > renderMarkdown > should work when detached from the utilities instance',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const { renderMarkdown } = getOmega().utilities;
            ctx.expect(renderMarkdown('**bold**')).toBe('<p><strong>bold</strong></p>');
          },
        },
      );

      cases.push(
        {
          name: 'Utilities Module > getContext > should return client and geolocation objects',
          run: async (ctx) => {
            await beforeHook(ctx);
            await beforeEachHook();
            const context = getOmega().utilities.getContext();
            ctx.expect(context.client).toBeTruthy();
            ctx.expect(context.geolocation).toBeTruthy();
            ctx.expect(typeof context.client.mobile === 'boolean').toBeTruthy();
            ctx.expect(typeof context.client.device === 'string').toBeTruthy();
            ctx.expect(typeof context.client.url === 'string').toBeTruthy();
          },
        },
      );

      cases.push({
        name: 'Utilities Module > should have clipboardCopy method',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.expect(typeof getOmega().utilities.clipboardCopy === 'function').toBeTruthy();
        },
      });

      cases.push(
        ...(() => {
          const cases = [];
          // The whole contract is FAILURE ([#726](https://github.com/Omega-JS-Stack/omega/issues/726)):
          // every caller shows a confirmation off this promise, so a refused clipboard
          // that resolves tells the visitor their key is in the buffer when it is not.
          // The two browser seams are swapped per test and put back.
          const realClipboard = navigator.clipboard;
          const realExecCommand = document.execCommand;
          const realCreateElement = document.createElement;

          const afterEachHook = () => {
            navigator.clipboard = realClipboard;
            document.execCommand = realExecCommand;
            document.createElement = realCreateElement;
          };

          // The textareas the fallback lane mints, in order.
          function captureElements() {
            const created = [];

            document.createElement = (tag) => {
              const element = realCreateElement(tag);
              created.push(element);
              return element;
            };

            return created;
          }

          cases.push({
            name: 'Utilities Module > clipboardCopy > should resolve when the modern clipboard API takes the text',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              ctx.after(afterEachHook);
              const written = [];
              navigator.clipboard = { writeText: async (text) => { written.push(text); } };

              await getOmega().utilities.clipboardCopy('modern lane');

              ctx.expect(written).toEqual(['modern lane']);
            },
          });

          cases.push({
            name: 'Utilities Module > clipboardCopy > should fall back to execCommand when writeText rejects',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              ctx.after(afterEachHook);
              // A denied permission or a blurred document — not a failure yet.
              navigator.clipboard = { writeText: async () => { throw new Error('denied'); } };
              document.execCommand = () => true;

              const created = captureElements();

              await getOmega().utilities.clipboardCopy('fallback lane');

              ctx.expect(created.length, 'the fallback minted its textarea').toBe(1);
              ctx.expect(created[0].value, 'the text reached the fallback').toBe('fallback lane');
            },
          });

          cases.push({
            name: 'Utilities Module > clipboardCopy > should reject when execCommand reports failure',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              ctx.after(afterEachHook);
              // `execCommand` says no with a FALSE RETURN, never a throw — the unchecked
              // return is what made every refusal look like a success.
              navigator.clipboard = undefined;
              document.execCommand = () => false;

              await ctx.expect((() => getOmega().utilities.clipboardCopy('refused'))()).rejects.toThrow(/Failed to copy to clipboard/);
            },
          });

          cases.push({
            name: 'Utilities Module > clipboardCopy > should reject when both lanes fail',
            run: async (ctx) => {
              await beforeHook(ctx);
              await beforeEachHook();
              ctx.after(afterEachHook);
              navigator.clipboard = { writeText: async () => { throw new Error('denied'); } };
              document.execCommand = () => { throw new Error('not allowed'); };

              await ctx.expect((() => getOmega().utilities.clipboardCopy('refused'))()).rejects.toThrow();
            },
          });
          return cases;
        })(),
      );

      cases.push({
        name: 'Utilities Module > should have showNotification method',
        run: async (ctx) => {
          await beforeHook(ctx);
          await beforeEachHook();
          ctx.expect(typeof getOmega().utilities.showNotification === 'function').toBeTruthy();
        },
      });
      return cases;
    })(),
  ],
});
