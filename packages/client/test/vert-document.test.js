const { describe, it, before } = require('node:test');
const { assert } = require('./helpers.js');

let doc;
let verts;

/**
 * Run the frame document's own inline script against a stub frame environment
 * (node carries no DOM) and return every postMessage the frame made.
 * @param {string} html - a rendered vert document
 * @param {object} box - { rootHeight, cardHeight } the frame measures
 * @returns {Array<{ message: object, origin: string }>} posted messages
 */
function runFrameScript(html, box) {
  const source = html.slice(html.indexOf('<script>') + '<script>'.length, html.indexOf('</script>'));
  const posted = [];
  const listeners = {};

  const card = {
    getBoundingClientRect: () => ({ height: box.cardHeight }),
    addEventListener: () => {},
  };
  const frameDocument = {
    documentElement: { scrollHeight: box.rootHeight, scrollWidth: 300 },
    getElementById: (id) => (id === 'omega-vert' ? card : null),
  };
  const frameWindow = {
    parent: { postMessage: (message, origin) => posted.push({ message, origin }) },
    addEventListener: (name, handler) => { listeners[name] = handler; },
    ResizeObserver: null,
  };

  new Function('window', 'document', source)(frameWindow, frameDocument);
  listeners.load();

  return posted;
}

describe('Vert Document Renderer', () => {

  before(async () => {
    doc = await import('../src/modules/vert-document.js');
    // the px table lives with the host module — the ceiling is read, never copied
    verts = await import('../src/modules/verts.js');
  });

  describe('the document shell', () => {
    it('renders a complete, self-contained, noindex document', () => {
      const html = doc.renderVertDocument({ title: 'A Vert', href: 'https://verts.example/r?id=a' });

      assert(html.startsWith('<!DOCTYPE html>'));
      assert(html.includes('<title>Sponsored</title>'));
      assert(html.includes('<meta name="robots" content="noindex, nofollow">'));
      assert(html.includes('html, body { background: transparent; }'), 'the frame stays transparent');
      assert(!html.includes('<script src') && !html.includes('<link'), 'no external request');
      assert(!html.includes('setInterval') && !html.includes('setTimeout'), 'no self-refresh, the host owns the lifecycle');
    });

    it('paints NOTHING outside the card: transparent root, a themed canvas in every branch', () => {
      // Only the card may paint. The canvas underneath it is what the browser
      // falls back to when it rasterizes the frame without that transparency
      // (first paint, a re-raster on scroll or zoom) — untold, it is light-mode
      // WHITE, which is the corner-notch and bottom-sliver bug in dark mode
      for (const options of [{}, { theme: 'light' }, { theme: 'dark' }]) {
        const html = doc.renderVertDocument({ title: 'A Vert', ...options });
        const label = options.theme || 'os';

        assert(html.includes('html, body { background: transparent; }'), `${label}: the root paints nothing`);

        const rules = html.match(/[^{}]+\{[^{}]*\}/g) || [];
        for (const rule of rules) {
          const [selector, body] = rule.split('{');
          if (!/(^|[\s,])(html|body|:root)\b/.test(selector)) {
            continue;
          }
          const background = body.match(/background(?:-color)?:([^;]+);/);
          assert(!background || background[1].trim() === 'transparent', `${label}: a root rule sets ${background && background[1].trim()}`);
        }
      }

      const sheet = doc.renderVertDocument({ title: 'A Vert' });
      assert(sheet.includes('color-scheme: light dark;'), 'the OS-following branch tells the canvas both modes');
      assert(/:root\[data-theme="light"\] \{\s*color-scheme: light;/.test(sheet), 'a light-pinned frame gets a light canvas');
      assert(/:root\[data-theme="dark"\] \{\s*color-scheme: dark;/.test(sheet), 'a dark-pinned frame gets a dark canvas');
    });

    it('speaks the fixed postMessage vocabulary at the given target origin', () => {
      const html = doc.renderVertDocument({ id: 'a1', targetOrigin: 'https://site.example' });

      assert(html.includes(doc.MESSAGE_DIMENSIONS), 'reports dimensions');
      assert(html.includes(doc.MESSAGE_CLICK), 'forwards clicks');
      assert(html.includes('window.addEventListener(\'load\', reportDimensions)'), 'reports on load');
      assert(html.includes('new ResizeObserver(reportDimensions)'), 'and on resize');
      assert(html.includes('var TARGET_ORIGIN = "https://site.example";'));
      assert(html.includes('var VERT_ID = "a1";'));
    });

    it('falls back to a wildcard target origin when the parent is unknown', () => {
      assert(doc.renderVertDocument({}).includes('var TARGET_ORIGIN = "*";'));
    });

    it('reports the CARD box, so a frame sized to the slot preset still shrinks', () => {
      // The frame arrives at the preset (250) and the card is content-sized
      // (126): the root element can never measure shorter than the frame, so a
      // documentElement report would pin the host at the preset forever
      const html = doc.renderVertDocument({ id: 'a1', height: 250, targetOrigin: 'https://site.example' });
      const posted = runFrameScript(html, { rootHeight: 250, cardHeight: 126 });

      assert(posted.length >= 1, 'the load handler reported');
      assert.strictEqual(posted[0].message.type, doc.MESSAGE_DIMENSIONS);
      assert.strictEqual(posted[0].message.height, 126, 'the card box IS the reported height');
      assert.strictEqual(posted[0].origin, 'https://site.example');
    });

    it('rounds a fractional card box UP, never cropping the last pixel row', () => {
      const html = doc.renderVertDocument({ height: 250 });
      const posted = runFrameScript(html, { rootHeight: 250, cardHeight: 125.4 });

      assert.strictEqual(posted[0].message.height, 126);
    });

    it('carries the theme as literal colour pairs, both modes either way', () => {
      const dark = doc.renderVertDocument({ theme: 'dark' });
      const unthemed = doc.renderVertDocument({});

      assert(dark.includes('<html lang="en" data-theme="dark">'));
      assert(unthemed.includes('<html lang="en">'), 'no theme follows the OS');
      assert(unthemed.includes('prefers-color-scheme: dark'));
      assert(!dark.includes('var(--omega-surface'), 'page tokens never cross the frame boundary');
    });
  });

  describe('the media row', () => {
    it('lays out thumb, copy, hairline, label, and cta', () => {
      const html = doc.renderVertDocument({
        title: 'Rakuten',
        description: 'Cash back at 3,500 stores.',
        button: 'Join Rakuten and Get $10',
        label: 'Sponsored by Rakuten',
        imageUrl: 'https://cdn.example/thumb.png',
      });

      assert(html.includes('class="omega-vert-row"'));
      assert(html.includes('<span class="omega-vert-title">Rakuten</span>'));
      assert(html.includes('<span class="omega-vert-description">Cash back at 3,500 stores.</span>'));
      assert(html.includes('class="omega-vert-rule"'));
      assert(html.includes('<span class="omega-vert-label">Sponsored by Rakuten</span>'));
      assert(html.includes('<span class="omega-vert-button">Join Rakuten and Get $10</span>'));
      assert(html.includes('-webkit-line-clamp'), 'the description clamps so the card stays compact');
    });

    it('labels a vert with no label of its own plainly Sponsored', () => {
      assert(doc.renderVertDocument({ title: 'A' }).includes('<span class="omega-vert-label">Sponsored</span>'));
    });

    it('renders an http image as the thumbnail, and nothing when there is none', () => {
      const withImage = doc.renderVertDocument({ imageUrl: 'https://cdn.example/a.png' });
      const without = doc.renderVertDocument({ title: 'No image' });

      assert(withImage.includes('<img class="omega-vert-image" src="https://cdn.example/a.png" alt="">'));
      assert(withImage.includes('<span class="omega-vert-thumb">'));
      assert(!without.includes('<span class="omega-vert-thumb">'), 'the copy starts at the left edge');
      assert(!without.includes('<img'));
    });

    it('takes trusted markup for the promo thumbnail slot only', () => {
      const html = doc.renderVertDocument({ imageMarkup: '<svg class="omega-vert-image"></svg>' });

      assert(html.includes('<span class="omega-vert-thumb"><svg class="omega-vert-image"></svg></span>'));
    });

    it('is content-sized: the slot height is never baked into the card', () => {
      const html = doc.renderVertDocument({ title: 'A', height: 250, width: 300 });

      assert(!html.includes('height: 250px'), 'the reserved height is a ceiling the host applies, not a card height');
      assert(html.includes('max-width: 300px;'), 'the reported width still bounds the card');
    });

    it('tightens the row in a short or narrow slot instead of wrapping tall', () => {
      const short = doc.renderVertDocument({ title: 'A', description: 'A pitch line.', height: 90 });
      const narrow = doc.renderVertDocument({ title: 'A', description: 'A pitch line.', width: 320, height: 250 });
      const roomy = doc.renderVertDocument({ title: 'A', description: 'A pitch line.', height: 250 });

      assert(!short.includes('A pitch line.'), 'a leaderboard-height slot drops the description');
      assert(short.includes('height: 32px'), 'and shrinks the thumbnail box');
      assert(!narrow.includes('A pitch line.'), 'a narrow slot tightens the same way');
      assert(roomy.includes('A pitch line.'));
      assert(roomy.includes('height: 56px'));
    });

    it('budgets the compact card UNDER the leaderboard ceiling, so nothing crops', () => {
      // The leaderboard preset is the shortest slot in the px table, so the
      // compact card must fit inside it: the ceiling clamp would otherwise eat
      // the card's bottom border. Every term below is read back out of the
      // rendered sheet, so a spacing edit that busts the budget fails here.
      const html = doc.renderVertDocument({ title: 'A vert', button: 'Go', height: 90 });
      const px = (selector, property) => {
        const block = html.match(new RegExp(`\\${selector} \\{[^}]*\\}`))[0];
        return parseFloat(block.match(new RegExp(`${property}: (-?[\\d.]+)px`))[1]);
      };

      const cardPadding = px('.omega-vert', 'padding') * 2;
      const cardBorder = 2;
      const row = Math.max(px('.omega-vert-thumb', 'height'), 13 * 1.3);
      const rule = px('.omega-vert-rule', 'margin') * 2 + 1;
      const foot = px('.omega-vert-button', 'padding') * 2 + 12 * 1.2;
      const budget = cardPadding + cardBorder + row + rule + foot;

      assert(budget <= verts.SIZE_PRESETS.leaderboard, `compact card budget ${budget}px fits the ${verts.SIZE_PRESETS.leaderboard}px leaderboard`);
    });

    it('stacks a skyscraper-shaped slot vertically', () => {
      const sky = doc.renderVertDocument({ title: 'A', width: 200, height: 600 });

      assert(sky.includes('flex-direction: column;'), 'the row becomes a stack');
    });
  });

  describe('click destination utm', () => {
    it('tags a bare destination with the full vert utm set', () => {
      const tagged = new URL(doc.applyVertUtm('https://omegajs.dev', {
        source: 'site.example',
        medium: doc.UTM_MEDIUM,
        campaign: doc.UTM_CAMPAIGN_PROMO,
        content: 'banner',
      }));

      assert.strictEqual(tagged.origin + tagged.pathname, 'https://omegajs.dev/');
      assert.strictEqual(tagged.searchParams.get('utm_source'), 'site.example');
      assert.strictEqual(tagged.searchParams.get('utm_medium'), 'omega-vert');
      assert.strictEqual(tagged.searchParams.get('utm_campaign'), 'omega-promo');
      assert.strictEqual(tagged.searchParams.get('utm_content'), 'banner');
      assert.strictEqual([...tagged.searchParams.keys()].length, 4, 'only the utm set is added');
    });

    it('leaves the advertiser own tagging untouched and never double-appends', () => {
      const href = 'https://shop.example/p?ref=house&utm_source=partner&utm_campaign=spring';
      const tagged = new URL(doc.applyVertUtm(href, {
        source: 'site.example',
        medium: doc.UTM_MEDIUM,
        campaign: 'vert-a',
      }));

      assert.strictEqual(tagged.searchParams.get('ref'), 'house', 'existing params survive');
      assert.strictEqual(tagged.searchParams.get('utm_source'), 'partner', 'the advertiser source wins');
      assert.strictEqual(tagged.searchParams.get('utm_campaign'), 'spring', 'the advertiser campaign wins');
      assert.strictEqual(tagged.searchParams.getAll('utm_source').length, 1, 'no double-append');
      assert.strictEqual(tagged.searchParams.get('utm_medium'), 'omega-vert', 'the missing key is filled');
    });

    it('skips empty params and returns anything unusable untouched', () => {
      const noSource = new URL(doc.applyVertUtm('https://shop.example/p', { medium: doc.UTM_MEDIUM, campaign: 'vert-a' }));

      assert.strictEqual(noSource.searchParams.get('utm_source'), null, 'an unknown host adds no source');
      assert.strictEqual(noSource.searchParams.get('utm_medium'), 'omega-vert');

      assert.strictEqual(doc.applyVertUtm('not a url', { medium: doc.UTM_MEDIUM }), 'not a url');
      assert.strictEqual(doc.applyVertUtm('mailto:a@b.example', { medium: doc.UTM_MEDIUM }), 'mailto:a@b.example');
      assert.strictEqual(doc.applyVertUtm('', { medium: doc.UTM_MEDIUM }), '');
    });
  });

  describe('accent + escaping', () => {
    it('defaults to the neutral ink accent and takes an accent pair', () => {
      const plain = doc.renderVertDocument({ title: 'A' });
      const indigo = doc.renderVertDocument({ title: 'A', accent: doc.OMEGA_ACCENT });

      assert(plain.includes(`--omega-vert-accent: ${doc.DEFAULT_ACCENT.light};`));
      assert(plain.includes(`--omega-vert-accent-text: ${doc.DEFAULT_ACCENT.lightText};`));
      assert(indigo.includes('--omega-vert-accent: #4f46e5;'));
      assert(indigo.includes('--omega-vert-accent: #8b85f5;'), 'the dark half of the pair');
    });

    it('escapes every field that comes from vert data', () => {
      const html = doc.renderVertDocument({
        title: '<script>alert("xss")</script>',
        description: '"><img src=x onerror=alert(1)>',
        button: '"><b>',
        label: '<i>',
        imageUrl: 'https://cdn.example/a.png"><script>',
        href: 'https://verts.example/r?a=1&b=2"><script>',
      });

      assert(!html.includes('<script>alert'), 'no injected script tag');
      assert(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
      assert(html.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'));
      assert(html.includes('&quot;&gt;&lt;b&gt;'));
      assert(html.includes('&lt;i&gt;'));
      assert(html.includes('src="https://cdn.example/a.png&quot;&gt;&lt;script&gt;"'));
      assert(html.includes('href="https://verts.example/r?a=1&amp;b=2&quot;&gt;&lt;script&gt;"'));
    });
  });
});
