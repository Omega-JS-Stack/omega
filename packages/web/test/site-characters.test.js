/**
 * #286 — `site.characters`, the literal-character set the core templates
 * interpolate. head.html's copyright meta reads `site.characters.copyright`;
 * nothing in OMEGA defined the set, so every page fleet-wide shipped
 * `content=" 2026 Brand"`. The engine composes it beside site.omega (the
 * other UJM-runtime site values the core includes read).
 */
const assert = require('node:assert');
const { test } = require('node:test');
const { buildWith, miniData } = require('./lib/build.js');

test('the copyright meta carries the © character, the year, and the brand', async () => {
  const pages = await buildWith(miniData, {}, 'site-characters');
  const html = pages.get('/');
  const match = html.match(/<meta name="copyright" content="([^"]*)"/);

  assert.ok(match, 'the head renders a copyright meta');
  assert.strictEqual(match[1], `© ${new Date().getFullYear()} MiniCo`);
});

test('a brand may override a character; the rest of the set still stands', async () => {
  const pages = await buildWith(
    { ...miniData, characters: { copyright: '(c)' } },
    {},
    'site-characters-override',
  );
  const html = pages.get('/');

  assert.ok(html.includes(`<meta name="copyright" content="(c) ${new Date().getFullYear()} MiniCo"`), 'the brand value wins');
});
