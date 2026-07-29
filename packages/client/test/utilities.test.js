const { describe, it, before } = require('node:test');
const { getManager, TEST_CONFIG, assert } = require('./helpers.js');

describe('Utilities Module', () => {

  before(async () => {
    await getManager().initialize(TEST_CONFIG);
  });

  describe('escapeHTML', () => {

    it('should escape HTML strings', () => {
      const u = getManager().utilities();
      assert.strictEqual(
        u.escapeHTML('<script>alert("xss")</script>'),
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
      );
    });

    it('should escape objects recursively', () => {
      const u = getManager().utilities();
      const input = {
        name: '<b>John</b>',
        email: 'john@example.com',
        nested: { bio: '<img src=x onerror=alert(1)>', count: 42, active: true },
      };
      const escaped = u.escapeHTML(input);

      assert.strictEqual(escaped.name, '&lt;b&gt;John&lt;/b&gt;');
      assert.strictEqual(escaped.email, 'john@example.com');
      assert.strictEqual(escaped.nested.bio, '&lt;img src=x onerror=alert(1)&gt;');
      assert.strictEqual(escaped.nested.count, 42);
      assert.strictEqual(escaped.nested.active, true);

      // Original is not mutated
      assert.strictEqual(input.name, '<b>John</b>');
    });

    it('should escape arrays', () => {
      const escaped = getManager().utilities().escapeHTML(['<b>bold</b>', 'safe', 123]);
      assert.strictEqual(escaped[0], '&lt;b&gt;bold&lt;/b&gt;');
      assert.strictEqual(escaped[1], 'safe');
      assert.strictEqual(escaped[2], 123);
    });

    it('should pass through null, undefined, numbers, and booleans', () => {
      const u = getManager().utilities();
      assert.strictEqual(u.escapeHTML(null), null);
      assert.strictEqual(u.escapeHTML(undefined), undefined);
      assert.strictEqual(u.escapeHTML(42), 42);
      assert.strictEqual(u.escapeHTML(true), true);
    });

    it('should work when detached from the utilities instance', () => {
      // Methods are arrow class fields — `this` is permanently bound to the instance,
      // so destructuring, aliasing, or passing as a callback must all work.
      const utilities = getManager().utilities();

      // Destructured
      const { escapeHTML } = utilities;
      assert.strictEqual(escapeHTML('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');

      // Aliased via property access
      const escape = utilities.escapeHTML;
      assert.strictEqual(escape('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');

      // Passed as a callback
      const result = ['<a>', '<b>'].map(utilities.escapeHTML);
      assert.strictEqual(result[0], '&lt;a&gt;');
      assert.strictEqual(result[1], '&lt;b&gt;');
    });
  });

  describe('Detection methods', () => {

    it('getPlatform should return a string', () => {
      assert(typeof getManager().utilities().getPlatform() === 'string');
    });

    it('getBrowser should return string or null', () => {
      const browser = getManager().utilities().getBrowser();
      assert(browser === null || typeof browser === 'string');
    });

    it('getRuntime should return web by default', () => {
      assert.strictEqual(getManager().utilities().getRuntime(), 'web');
    });

    it('getRuntime should use config override', async () => {
      const Manager = getManager();
      await Manager.initialize({ ...TEST_CONFIG, runtime: 'electron' });
      assert.strictEqual(Manager.utilities().getRuntime(), 'electron');
      await Manager.initialize(TEST_CONFIG);
    });

    it('isMobile should return a boolean', () => {
      assert.strictEqual(typeof getManager().utilities().isMobile(), 'boolean');
    });

    it('getDevice should return mobile, tablet, or desktop', () => {
      const device = getManager().utilities().getDevice();
      assert(['mobile', 'tablet', 'desktop'].includes(device));
    });
  });

  describe('sanitizeURL', () => {

    it('should keep an http(s) URL and reject every other scheme', () => {
      const u = getManager().utilities();
      assert.strictEqual(u.sanitizeURL('https://example.com/a'), 'https://example.com/a');
      assert.strictEqual(u.sanitizeURL('javascript:alert(1)'), '');
      assert.strictEqual(u.sanitizeURL('data:text/html;base64,AAAA'), '');
    });
  });

  describe('renderMarkdown', () => {

    it('should render nothing for an empty body, so the caller can say what that means', () => {
      const u = getManager().utilities();
      assert.strictEqual(u.renderMarkdown(''), '');
      assert.strictEqual(u.renderMarkdown('   \n\n'), '');
      assert.strictEqual(u.renderMarkdown(null), '');
      assert.strictEqual(u.renderMarkdown(undefined), '');
    });

    it('should render markup in the source as text, whatever the grammar around it', () => {
      assert.strictEqual(
        getManager().utilities().renderMarkdown('<script>alert(1)</script>\n\n- <img src=x onerror=alert(1)>'),
        '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><ul><li>&lt;img src=x onerror=alert(1)&gt;</li></ul>',
      );
    });

    it('should escape the quotes an attribute injection would need', () => {
      assert.strictEqual(
        getManager().utilities().renderMarkdown('see [say "hi"](https://ok.com/a"b)'),
        '<p>see <a href="https://ok.com/a&quot;b" target="_blank" rel="noopener">say &quot;hi&quot;</a></p>',
      );
      assert.strictEqual(
        getManager().utilities().renderMarkdown(`it's <b>fine</b>`),
        '<p>it&#039;s &lt;b&gt;fine&lt;/b&gt;</p>',
      );
    });

    it('should render the small grammar the renderer claims', () => {
      assert.strictEqual(
        getManager().utilities().renderMarkdown('## Spec\n\nOne **bold** and `code`.\n\n- first\n- second\n\n1. step'),
        '<h5 class="h6 mt-3 mb-2">Spec</h5>'
          + '<p>One <strong>bold</strong> and <code>code</code>.</p>'
          + '<ul><li>first</li><li>second</li></ul>'
          + '<ol><li>step</li></ol>',
      );
    });

    it('should start headings below the host page title and floor them at h6', () => {
      const u = getManager().utilities();
      assert.strictEqual(u.renderMarkdown('# Title'), '<h4 class="h6 mt-3 mb-2">Title</h4>');
      assert.strictEqual(u.renderMarkdown('#### Deep'), '<h6 class="h6 mt-3 mb-2">Deep</h6>');
      assert.strictEqual(u.renderMarkdown('###### Deepest'), '<h6 class="h6 mt-3 mb-2">Deepest</h6>');
    });

    it('should render italics and join the lines of one paragraph', () => {
      const u = getManager().utilities();
      assert.strictEqual(u.renderMarkdown('an *italic* word'), '<p>an <em>italic</em> word</p>');
      assert.strictEqual(u.renderMarkdown('line one\nline two'), '<p>line one<br>line two</p>');
    });

    it('should treat a fenced block as literal, emphasis and all', () => {
      assert.strictEqual(
        getManager().utilities().renderMarkdown('```\nrm -rf *not*bold*\n<b>x</b>\n```'),
        '<pre class="p-2 rounded"><code>rm -rf *not*bold*\n&lt;b&gt;x&lt;/b&gt;</code></pre>',
      );
    });

    it('should keep the content of an unterminated fence instead of dropping it', () => {
      assert.strictEqual(
        getManager().utilities().renderMarkdown('```\nhalf a block'),
        '<pre class="p-2 rounded"><code>half a block</code></pre>',
      );
    });

    it('should link only the schemes a browser may follow', () => {
      const u = getManager().utilities();
      assert.strictEqual(
        u.renderMarkdown('see [the spec](https://example.com/a)'),
        '<p>see <a href="https://example.com/a" target="_blank" rel="noopener">the spec</a></p>',
      );
      assert.strictEqual(
        u.renderMarkdown('see [click](javascript:alert(1))'),
        '<p>see [click](javascript:alert(1))</p>',
      );
      assert.strictEqual(
        u.renderMarkdown('see [x](data:text/html;base64,AAAA)'),
        '<p>see [x](data:text/html;base64,AAAA)</p>',
      );
      assert.strictEqual(
        u.renderMarkdown('see [x](/relative/path)'),
        '<p>see [x](/relative/path)</p>',
      );
    });

    it('should carry an href holding asterisks through the emphasis pass untouched', () => {
      assert.strictEqual(
        getManager().utilities().renderMarkdown('see [x](https://ok.com/*a*b*)'),
        '<p>see <a href="https://ok.com/*a*b*" target="_blank" rel="noopener">x</a></p>',
      );
    });

    it('should work when detached from the utilities instance', () => {
      const { renderMarkdown } = getManager().utilities();
      assert.strictEqual(renderMarkdown('**bold**'), '<p><strong>bold</strong></p>');
    });
  });

  describe('getContext', () => {

    it('should return client and geolocation objects', () => {
      const context = getManager().utilities().getContext();
      assert(context.client);
      assert(context.geolocation);
      assert(typeof context.client.mobile === 'boolean');
      assert(typeof context.client.device === 'string');
      assert(typeof context.client.url === 'string');
    });
  });

  it('should have clipboardCopy method', () => {
    assert(typeof getManager().utilities().clipboardCopy === 'function');
  });

  it('should have showNotification method', () => {
    assert(typeof getManager().utilities().showNotification === 'function');
  });
});
