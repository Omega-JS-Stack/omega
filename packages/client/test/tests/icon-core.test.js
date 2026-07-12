/**
 * icon-core tests — the shared Font Awesome semantics (C4 cp108): name/style
 * validation, candidate lookup order, root-attribute injection, and alias
 * mapping. Pure CJS — required straight from dist like desktop main does.
 */
const assert = require('assert');
const path = require('path');

const DIST_PATH = path.join(__dirname, '..', '..', 'dist', 'modules', 'icon-core.js');

describe('icon-core', () => {
  let core;

  before(() => {
    core = require(DIST_PATH);
  });

  it('validates names as lowercase slugs and styles by path-safe shape', () => {
    assert.strictEqual(core.isValidIconName('magnifying-glass'), true);
    assert.strictEqual(core.isValidIconName('Play'), false);
    assert.strictEqual(core.isValidIconName('../../etc/passwd'), false);
    assert.strictEqual(core.isValidIconName(''), false);
    assert.strictEqual(core.isValidIconName(42), false);

    assert.strictEqual(core.isValidStyle('solid'), true);
    assert.strictEqual(core.isValidStyle('regular'), true);
    assert.strictEqual(core.isValidStyle('brands'), true);
    // Pro styles pass the shape check — existence is the file lookup's job.
    assert.strictEqual(core.isValidStyle('duotone'), true);
    assert.strictEqual(core.isValidStyle('sharp-light'), true);
    // but path-unsafe or non-slug values never do
    assert.strictEqual(core.isValidStyle('../solid'), false);
    assert.strictEqual(core.isValidStyle('Solid'), false);
    assert.strictEqual(core.isValidStyle(''), false);
    assert.strictEqual(core.isValidStyle(null), false);
  });

  it('prefers Pro over free in the package order', () => {
    assert.deepStrictEqual(core.PACKAGES, [
      '@fortawesome/fontawesome-pro',
      '@fortawesome/fontawesome-free',
    ]);
  });

  it('parses fa-* class lists the way Font Awesome does (family × weight)', () => {
    const parse = (classes) => core.parseIconClasses(classes.split(' '));

    assert.deepStrictEqual(parse('fa-solid fa-play me-2'), { name: 'play', style: 'solid' });
    assert.deepStrictEqual(parse('fa-play'), { name: 'play', style: 'solid' }); // weight defaults
    assert.deepStrictEqual(parse('fa-brands fa-github'), { name: 'github', style: 'brands' });
    assert.deepStrictEqual(parse('fa-light fa-play'), { name: 'play', style: 'light' });
    assert.deepStrictEqual(parse('fa-sharp fa-light fa-play'), { name: 'play', style: 'sharp-light' });
    assert.deepStrictEqual(parse('fa-duotone fa-play'), { name: 'play', style: 'duotone' }); // bare duotone dir
    assert.deepStrictEqual(parse('fa-duotone fa-thin fa-play'), { name: 'play', style: 'duotone-thin' });
    assert.deepStrictEqual(parse('fa-sharp-duotone fa-play'), { name: 'play', style: 'sharp-duotone-solid' });

    // modifiers are never names; no name → null
    assert.deepStrictEqual(parse('fa-solid fa-fw fa-2x fa-spin fa-rocket'), { name: 'rocket', style: 'solid' });
    assert.strictEqual(parse('fa-solid fa-fw'), null);
    assert.strictEqual(parse('btn btn-primary'), null);
  });

  it('candidate order is requested style first, then the brands fallback', () => {
    assert.deepStrictEqual(core.candidateRelPaths('apple', 'solid'), ['solid/apple.svg', 'brands/apple.svg']);
    assert.deepStrictEqual(core.candidateRelPaths('github', 'brands'), ['brands/github.svg']);
  });

  it('injects the full root attribute set, each only when absent', () => {
    const raw = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0"/></svg>';
    const out = core.injectSvgAttributes(raw);
    assert.ok(out.includes('width="1em"'));
    assert.ok(out.includes('height="1em"'));
    assert.ok(out.includes('fill="currentColor"'));
    assert.ok(out.includes('aria-hidden="true"'));
    assert.ok(out.includes('focusable="false"'));
    assert.ok(out.includes('overflow="visible"'));

    // hand-authored sizing/fill is never overridden
    const sized = core.injectSvgAttributes('<svg width="24" fill="red" viewBox="0 0 1 1"></svg>');
    assert.ok(sized.includes('width="24"') && !sized.includes('width="1em"'));
    assert.ok(sized.includes('fill="red"') && !sized.includes('fill="currentColor"'));

    // non-SVG input passes through untouched
    assert.strictEqual(core.injectSvgAttributes('not svg'), 'not svg');
  });

  it('builds the alias map from icon-families metadata', () => {
    const map = core.buildAliasMap({
      'magnifying-glass': { aliases: { names: ['search'] } },
      'address-card': { aliases: { names: ['contact-card', 'vcard'] } },
      rocket: {},
    });
    assert.strictEqual(map.get('search'), 'magnifying-glass');
    assert.strictEqual(map.get('vcard'), 'address-card');
    assert.strictEqual(map.get('rocket'), undefined);
    assert.strictEqual(core.buildAliasMap(null).size, 0);
  });
});
