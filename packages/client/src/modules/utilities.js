// Methods are defined as arrow class fields so `this` is permanently bound to the instance.
// This means consumers can safely alias or destructure methods without losing context:
//   const { escapeHTML } = omega.utilities(); // ✓ works
//   const escape = omega.utilities().escapeHTML; // ✓ works
//   items.map(omega.utilities().escapeHTML); // ✓ works
// Safe because omega.utilities() is a singleton — only one instance ever exists.

// renderMarkdown links are restricted to the two schemes a browser may navigate
// safely. sanitizeURL already rejects javascript:/data:, but it resolves a bare
// path against the current origin and returns it — and the bracket syntax is the
// one place the source supplies an attribute VALUE rather than text, so a link is
// only ever minted from a URL that says its own scheme out loud.
const SAFE_HREF = /^https?:\/\//i;

// The inline grammar, applied to an already-escaped line.
const renderInline = (text, sanitizeURL) => text
  // Code first: what is inside a span of backticks is literal, and running the
  // emphasis rules over it would eat the asterisks in a code sample.
  .split(/(`[^`]+`)/)
  .map((part) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return `<code>${part.slice(1, -1)}</code>`;
    }

    // Built anchors are stashed behind a NUL sentinel while the emphasis rules
    // run — an href may legitimately contain asterisks, and the emphasis pass
    // must never see markup it built.
    const anchors = [];

    return part
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
        const safe = sanitizeURL(href);

        // Not a scheme a browser may follow — leave the bracket text as text.
        if (!safe || !SAFE_HREF.test(safe)) {
          return whole;
        }

        anchors.push(`<a href="${safe}" target="_blank" rel="noopener">${label}</a>`);
        return `\u0000${anchors.length - 1}\u0000`;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\u0000(\d+)\u0000/g, (match, index) => anchors[Number(index)]);
  })
  .join('');

class Utilities {
  constructor(manager) {
    this.manager = manager;
  }

  // Copy text to clipboard
  //
  // Always a promise, and a REFUSED copy REJECTS
  // ([#726](https://github.com/Omega-JS-Stack/omega/issues/726)). Every caller
  // draws its confirmation off this promise, so a failure that resolves tells
  // the visitor their credential is in the buffer when it is not.
  clipboardCopy = async (input) => {
    // Get the text from the input
    const text = input && input.nodeType
      ? input.value || input.innerText || input.innerHTML
      : input;

    // Try to use the modern clipboard API — a refusal (no permission, an
    // insecure context, a blurred document) is not a failure until the legacy
    // lane has had its turn too.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        return await navigator.clipboard.writeText(text);
      } catch (e) {
        return fallbackCopy(text);
      }
    }

    return fallbackCopy(text);

    function fallbackCopy(text) {
      const el = document.createElement('textarea');
      el.setAttribute('style', 'width:1px;border:0;opacity:0;');
      el.value = text;
      document.body.appendChild(el);
      el.select();

      // `execCommand` reports a refusal with a FALSE RETURN rather than a
      // throw — reading the return is the only way this lane can fail.
      let copied = false;

      try {
        copied = document.execCommand('copy');
      } finally {
        document.body.removeChild(el);
      }

      if (!copied) {
        throw new Error('Failed to copy to clipboard');
      }
    }
  }

  // Escape HTML to prevent XSS
  // Accepts a string, object, or array — walks recursively, escaping all string values
  escapeHTML = (input) => {
    // Strings — escape and return
    if (typeof input === 'string') {
      this._shadowElement = this._shadowElement || document.createElement('p');
      this._shadowElement.innerHTML = '';

      // This automatically escapes HTML entities like <, >, &, etc.
      this._shadowElement.appendChild(document.createTextNode(input));

      // This is needed to escape quotes to prevent attribute injection
      return this._shadowElement.innerHTML.replace(/["']/g, (m) => {
        switch (m) {
          case '"':
            return '&quot;';
          default:
            return '&#039;';
        }
      });
    }

    // Null/undefined — pass through
    if (input == null) {
      return input;
    }

    // Arrays — recurse each item
    if (Array.isArray(input)) {
      return input.map(item => this.escapeHTML(item));
    }

    // Objects — shallow clone, recurse each value
    if (typeof input === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(input)) {
        result[key] = this.escapeHTML(value);
      }
      return result;
    }

    // Numbers, booleans, etc. — pass through unchanged
    return input;
  }

  // Sanitize URL to prevent javascript:, data:, and other dangerous URI schemes
  // Returns the original URL if safe, or '' if rejected
  sanitizeURL = (url) => {
    if (!url || typeof url !== 'string') {
      return '';
    }

    try {
      const parsed = new URL(url, window.location.origin);

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return '';
      }

      return url;
    } catch (e) {
      return '';
    }
  }

  // Render hostile text as safe markup with a small markdown grammar: headings,
  // fenced and inline code, lists, bold/italic, and links restricted to http(s).
  //
  // The input is untrusted (an API answer, another user's words), so nothing here
  // ever passes markup through: the text is ESCAPED FIRST, once, and every rule
  // below works on that escaped string — a `<script>` is already `&lt;script&gt;`
  // before any rule decides what a line means, so no rule can resurrect it.
  // Escaping is escapeHTML's job and scheme safety is sanitizeURL's; this method
  // only decides what a line MEANS.
  //
  // Not a markdown engine and not trying to be one — anything outside the grammar
  // renders as the text it was. Empty input renders as '', so the caller can say
  // what empty means in its own words.
  renderMarkdown = (text) => {
    const source = String(text === null || text === undefined ? '' : text);
    if (!source.trim()) {
      return '';
    }

    const lines = this.escapeHTML(source.replace(/\r\n/g, '\n')).split('\n');
    const out = [];
    let paragraph = [];
    let list = null;
    let code = null;

    const closeParagraph = () => {
      if (!paragraph.length) {
        return;
      }

      out.push(`<p>${renderInline(paragraph.join('<br>'), this.sanitizeURL)}</p>`);
      paragraph = [];
    };

    const closeList = () => {
      if (!list) {
        return;
      }

      const items = list.items.map((item) => `<li>${renderInline(item, this.sanitizeURL)}</li>`).join('');
      out.push(`<${list.tag}>${items}</${list.tag}>`);
      list = null;
    };

    const closeBlocks = () => {
      closeParagraph();
      closeList();
    };

    for (const line of lines) {
      // A fence swallows everything until the next one — inside it, no rule but
      // "this is literal" applies.
      const fence = /^\s*```/.test(line);
      if (code !== null) {
        if (fence) {
          out.push(`<pre class="p-2 rounded"><code>${code.join('\n')}</code></pre>`);
          code = null;
        } else {
          code.push(line);
        }
        continue;
      }
      if (fence) {
        closeBlocks();
        code = [];
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeBlocks();

        // Rendered text is a fragment inside a host page, not a document: its
        // headings start below the host's own title rather than competing with it.
        const level = Math.min(heading[1].length + 3, 6);
        out.push(`<h${level} class="h6 mt-3 mb-2">${renderInline(heading[2], this.sanitizeURL)}</h${level}>`);
        continue;
      }

      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || numbered) {
        closeParagraph();

        const tag = bullet ? 'ul' : 'ol';
        if (list && list.tag !== tag) {
          closeList();
        }

        list = list || { tag, items: [] };
        list.items.push((bullet || numbered)[1]);
        continue;
      }

      if (!line.trim()) {
        closeBlocks();
        continue;
      }

      closeList();
      paragraph.push(line);
    }

    // An unterminated fence is still content — render what it holds rather than
    // dropping the rest of the text on the floor.
    if (code !== null) {
      out.push(`<pre class="p-2 rounded"><code>${code.join('\n')}</code></pre>`);
    }
    closeBlocks();

    return out.join('');
  }

  // Show notification
  showNotification = (message, options = {}) => {
    // Handle different input types
    let text = message;
    let type = options.type || 'info';

    // If message is an Error object, extract message and default to danger
    if (message instanceof Error) {
      text = message.message;
      type = options.type || 'danger';
    }

    // Handle string as second parameter for backwards compatibility
    if (typeof options === 'string') {
      options = { type: options };
      type = options.type;
    }

    // Extract options
    const timeout = options.timeout !== undefined ? options.timeout : 5000;

    const $notification = document.createElement('div');
    $notification.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    $notification.style.cssText = 'z-index: 9999; top: 1rem; left: 50%; transform: translateX(-50%); width: calc(100% - 2rem); max-width: 500px;';

    const $text = document.createElement('span');
    $text.textContent = text;

    const $closeBtn = document.createElement('button');
    $closeBtn.type = 'button';
    $closeBtn.className = 'btn-close';
    $closeBtn.setAttribute('data-bs-dismiss', 'alert');

    $notification.appendChild($text);
    $notification.appendChild($closeBtn);

    document.body.appendChild($notification);

    // Auto-remove after timeout (unless timeout is 0)
    if (timeout > 0) {
      setTimeout(() => {
        $notification.remove();
      }, timeout);
    }
  }

  // Get platform (OS)
  getPlatform = () => {
    const ua = navigator.userAgent.toLowerCase();
    const platform = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();

    // Check userAgent for mobile platforms (more reliable than platform string)
    if (/iphone|ipad|ipod/.test(ua)) {
      return 'ios';
    }
    if (/android/.test(ua)) {
      return 'android';
    }

    // Check platform string for desktop OS
    if (/win/.test(platform)) {
      return 'windows';
    }
    if (/mac/.test(platform)) {
      return 'mac';
    }
    if (/cros/.test(ua)) {
      return 'chromeos';
    }
    if (/linux/.test(platform)) {
      return 'linux';
    }

    return 'unknown';
  }

  // Get browser name
  getBrowser = () => {
    const ua = navigator.userAgent;

    // Order matters - check more specific browsers first
    // Edge before Chrome (Edge includes "Chrome" in UA)
    if (/edg/i.test(ua)) {
      return 'edge';
    }

    // Opera before Chrome (Opera includes "Chrome" in UA)
    if (/opera|opr/i.test(ua)) {
      return 'opera';
    }

    // Brave before Chrome (Brave includes "Chrome" in UA)
    if (navigator.brave || /brave/i.test(ua)) {
      return 'brave';
    }

    // Chrome (including Chromium-based browsers)
    if (/chrome|chromium|crios/i.test(ua)) {
      return 'chrome';
    }

    // Firefox
    if (/firefox|fxios/i.test(ua)) {
      return 'firefox';
    }

    // Safari last (most browsers include "Safari" in UA)
    if (/safari/i.test(ua)) {
      return 'safari';
    }

    // Fallback
    return null;
  }

  // Get runtime environment
  getRuntime = () => {
    // Use config runtime if provided
    if (this.manager?.config?.runtime) {
      return this.manager.config.runtime;
    }

    // Browser extension (Chrome, Edge, Opera, Brave, Firefox, Safari, etc.)
    if (
      (typeof chrome !== 'undefined' && chrome.runtime?.id)
      || (typeof browser !== 'undefined' && browser.runtime?.id)
      || (typeof safari !== 'undefined' && safari.extension)
    ) {
      return 'browser-extension';
    }

    // Default: web browser
    return 'web';
  }

  // Check if mobile device
  isMobile = () => {
    try {
      // Try modern API first
      const m = navigator.userAgentData?.mobile;
      if (typeof m !== 'undefined') {
        return m === true;
      }
    } catch (e) {
      // Silent fail
    }

    // Fallback to media query
    try {
      return window.matchMedia('(max-width: 767px)').matches;
    } catch (e) {
      return false;
    }
  }

  // Get device based on screen width
  getDevice = () => {
    const width = window.innerWidth;

    // Mobile: < 768px (Bootstrap's md breakpoint)
    if (width < 768) {
      return 'mobile';
    }

    // Tablet: 768px - 1199px (between md and xl)
    if (width < 1200) {
      return 'tablet';
    }

    // Desktop: >= 1200px
    return 'desktop';
  }

  // Get context information
  getContext = () => {
    // Return context information
    return {
      client: {
        language: navigator.language,
        mobile: this.isMobile(),
        device: this.getDevice(),
        platform: this.getPlatform(),
        browser: this.getBrowser(),
        vendor: navigator.vendor,
        runtime: this.getRuntime(),
        userAgent: navigator.userAgent,
        url: window.location.href,
      },
      geolocation: {
        ip: null,
        country: null,
        region: null,
        city: null,
        latitude: null,
        longitude: null,
      },
    };
  }
}

export default Utilities;
