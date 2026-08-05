/**
 * The footer copyright line — a sub-brand credits the parent company from
 * CONFIG (brand.company, linked with company.url), never a typed literal.
 * Three shapes: no parent (the plain line), a parent without a url (plain
 * text), a parent with one (a link). The year keeps coming from site.omega.date.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const { buildWith, miniData } = require('./lib/build.js');

function copyrightLine(html) {
  const match = html.match(/class="?omega-footer__copyright"?[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(match, 'the footer renders a copyright span');
  return match[1].replace(/\s+/g, ' ').trim();
}

test('no parent company configured → the plain brand line stands', async () => {
  const pages = await buildWith(miniData, {}, 'footer-copyright-none');
  const line = copyrightLine(pages.get('/'));

  assert.ok(line.includes('MiniCo. All rights reserved.'), `plain line: ${line}`);
  assert.ok(!line.includes(' by '), 'nothing to credit');
});

test('brand.company without company.url → the parent is credited as plain text', async () => {
  const pages = await buildWith(
    { ...miniData, brand: { ...miniData.brand, company: 'Mini Holdings' } },
    {},
    'footer-copyright-text',
  );
  const line = copyrightLine(pages.get('/'));

  assert.ok(line.includes('MiniCo by Mini Holdings. All rights reserved.'), `credited: ${line}`);
  assert.ok(!line.includes('<a'), 'no url configured, so no link');
});

test('brand.company + company.url → the parent name links the parent site', async () => {
  const pages = await buildWith(
    {
      ...miniData,
      brand: { ...miniData.brand, company: 'Mini Holdings' },
      company: { url: 'https://miniholdings.example.com' },
    },
    {},
    'footer-copyright-link',
  );
  const line = copyrightLine(pages.get('/'));

  assert.ok(
    line.includes('MiniCo by <a href="https://miniholdings.example.com">Mini Holdings</a>. All rights reserved.'),
    `linked: ${line}`,
  );
});

test('the base row carries the framework powered-by line', async () => {
  const pages = await buildWith(miniData, {}, 'footer-powered');
  const html = pages.get('/');
  const match = html.match(/class="omega-footer__powered"[^>]*>([\s\S]*?)<\/span>\s*<\/span>/);

  assert.ok(match, 'the footer renders a powered-by span');
  const line = match[1].replace(/\s+/g, ' ').trim();

  assert.ok(line.includes('Powered by'), `powered line: ${line}`);
  assert.ok(
    line.includes('<a href="https://omegajs.dev" target="_blank" rel="noopener">omegajs.dev</a>'),
    `linked framework site: ${line}`,
  );
  assert.ok(/data-icon="bolt"[^>]*><svg/.test(line), `bolt icon inlined: ${line}`);
});

test('a company that IS the brand adds no self-credit', async () => {
  const pages = await buildWith(
    { ...miniData, brand: { ...miniData.brand, company: 'MiniCo' } },
    {},
    'footer-copyright-self',
  );
  const line = copyrightLine(pages.get('/'));

  assert.ok(line.includes('MiniCo. All rights reserved.'), `plain line: ${line}`);
  assert.ok(!line.includes(' by '), 'never "MiniCo by MiniCo"');
});
