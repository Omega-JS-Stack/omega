/**
 * variable-resolver.test.js — argument parsing + variable resolution, direct.
 *
 * register-liquid.test.js proves the resolver reaches real tag markup; this
 * suite pins the rules the omega_* tags are written against: typed literals
 * evaluate before any scope lookup, in BOTH lanes (max_width=640 is the number
 * 640, not a missing path or its own text), preferLiteral keeps bare words as
 * text unless the context has them, quote-aware splitting survives commas
 * inside strings, and an unresolvable path yields null so a typo never renders
 * its own name.
 */

const test = require('node:test');
const assert = require('node:assert');
const resolver = require('../src/variable-resolver.js');

// A render context stand-in — the seam register-liquid.js builds from LiquidJS.
const CONTEXT = {
  'page.title': 'My Page',
  'post.image': '/assets/hero.png',
  'site.baseurl': '',
  hero: 'from-context',
  falsy: false,
  zero: 0,
};

const lookup = (path) => CONTEXT[path];

test('quoted input is a string literal, quotes stripped', () => {
  assert.strictEqual(resolver.resolveInput(lookup, '"hello"'), 'hello');
  assert.strictEqual(resolver.resolveInput(lookup, "'hello'"), 'hello');
  // A quoted path is NOT looked up.
  assert.strictEqual(resolver.resolveInput(lookup, '"page.title"'), 'page.title');
});

test('unquoted input resolves through the context by default', () => {
  assert.strictEqual(resolver.resolveInput(lookup, 'page.title'), 'My Page');
  assert.strictEqual(resolver.resolveInput(lookup, 'hero'), 'from-context');
  // Unresolvable → null, never the raw text.
  assert.strictEqual(resolver.resolveInput(lookup, 'page.missing'), null);
});

test('empty and absent input resolve to null', () => {
  assert.strictEqual(resolver.resolveInput(lookup, ''), null);
  assert.strictEqual(resolver.resolveInput(lookup, null), null);
  assert.strictEqual(resolver.resolveInput(lookup, undefined), null);
});

test('preferLiteral resolves typed literals typed', () => {
  assert.strictEqual(resolver.resolveInput(lookup, '640', true), 640);
  assert.strictEqual(resolver.resolveInput(lookup, '-12', true), -12);
  assert.strictEqual(resolver.resolveInput(lookup, '1.5', true), 1.5);
  assert.strictEqual(resolver.resolveInput(lookup, 'true', true), true);
  assert.strictEqual(resolver.resolveInput(lookup, 'false', true), false);
  assert.strictEqual(resolver.resolveInput(lookup, 'nil', true), null);
  // A quoted number stays a string — the quotes are the author's opt-out.
  assert.strictEqual(resolver.resolveInput(lookup, '"640"', true), '640');
});

test('preferLiteral keeps bare words as text unless the context has them', () => {
  // A bare word absent from context stays literal — class=hero works.
  assert.strictEqual(resolver.resolveInput(lookup, 'lazy', true), 'lazy');
  // A bare word PRESENT in context resolves (Ruby's truthiness guard).
  assert.strictEqual(resolver.resolveInput(lookup, 'hero', true), 'from-context');
  // A falsy context value fails the guard, so the word stays literal.
  assert.strictEqual(resolver.resolveInput(lookup, 'falsy', true), 'falsy');
  // A dotted path always resolves, present or not.
  assert.strictEqual(resolver.resolveInput(lookup, 'page.title', true), 'My Page');
  assert.strictEqual(resolver.resolveInput(lookup, 'page.missing', true), null);
});

test('bare literals evaluate before any scope lookup', () => {
  assert.strictEqual(resolver.resolveVariable(lookup, '640'), 640);
  assert.strictEqual(resolver.resolveVariable(lookup, '-12'), -12);
  assert.strictEqual(resolver.resolveVariable(lookup, '1.5'), 1.5);
  assert.strictEqual(resolver.resolveVariable(lookup, 'true'), true);
  assert.strictEqual(resolver.resolveVariable(lookup, 'false'), false);
  assert.strictEqual(resolver.resolveVariable(lookup, 'nil'), null);
  assert.strictEqual(resolver.resolveVariable(lookup, 'null'), null);
  // Surrounding whitespace does not defeat literal detection.
  assert.strictEqual(resolver.resolveVariable(lookup, '  640  '), 640);
});

test('resolveVariable maps an absent lookup to null and keeps real falsy values', () => {
  assert.strictEqual(resolver.resolveVariable(lookup, ''), null);
  assert.strictEqual(resolver.resolveVariable(lookup, 'page.missing'), null);
  // A context value of false/0 is a VALUE, not an absence.
  assert.strictEqual(resolver.resolveVariable(lookup, 'falsy'), false);
  assert.strictEqual(resolver.resolveVariable(lookup, 'zero'), 0);
});

test('parseArguments splits on commas, trims, and preserves quoted commas', () => {
  assert.deepStrictEqual(resolver.parseArguments('a, b, c'), ['a', 'b', 'c']);
  assert.deepStrictEqual(resolver.parseArguments('  a  ,b  '), ['a', 'b']);
  assert.deepStrictEqual(
    resolver.parseArguments('"one, two", three'),
    ['"one, two"', 'three'],
  );
  assert.deepStrictEqual(
    resolver.parseArguments("post.image, class='a, b', lazy"),
    ['post.image', "class='a, b'", 'lazy'],
  );
  assert.deepStrictEqual(resolver.parseArguments(''), []);
  assert.deepStrictEqual(resolver.parseArguments(undefined), []);
});

test('parseOptions reads key=value pairs and ignores positional arguments', () => {
  const options = resolver.parseOptions(['post.image', 'width=640', "class='hero big'"]);

  assert.deepStrictEqual(options, { width: '640', class: 'hero big' });
});

test('parseOptions without a lookup strips quotes and keeps values as text', () => {
  assert.deepStrictEqual(
    resolver.parseOptions(['width=640', 'alt="A photo"', 'src=page.title']),
    { width: '640', alt: 'A photo', src: 'page.title' },
  );
});

test('parseOptions with a lookup applies the preferLiteral rule per value', () => {
  const options = resolver.parseOptions([
    'width=640',
    'webp=false',
    'class=card',
    'hero=hero',
    'src=post.image',
    'alt=page.missing',
    'title="literal text"',
  ], lookup);

  assert.deepStrictEqual(options, {
    // A typed literal resolves TYPED in this lane too — max_width=640 is the
    // number 640, webp=false the boolean, exactly as the non-preferLiteral
    // lane pinned above.
    width: 640,
    webp: false,
    // A bare word absent from context keeps its text — class=card works.
    class: 'card',
    // A bare word PRESENT in context resolves instead.
    hero: 'from-context',
    src: '/assets/hero.png',
    // A typo'd dotted path yields null, never its own name in the page.
    alt: null,
    title: 'literal text',
  });
});

test('parseOptions keeps only the FIRST = as the separator', () => {
  assert.deepStrictEqual(
    resolver.parseOptions(['style=color:red;width=10']),
    { style: 'color:red;width=10' },
  );
});

test('isQuoted and stripQuotes read the raw argument shape', () => {
  assert.strictEqual(resolver.isQuoted('"hi"'), true);
  assert.strictEqual(resolver.isQuoted("'hi'"), true);
  assert.strictEqual(resolver.isQuoted('hi'), false);
  assert.strictEqual(resolver.isQuoted(''), false);
  assert.strictEqual(resolver.isQuoted(undefined), false);

  assert.strictEqual(resolver.stripQuotes('"hi"'), 'hi');
  assert.strictEqual(resolver.stripQuotes("'hi'"), 'hi');
  assert.strictEqual(resolver.stripQuotes('hi'), 'hi');
});
