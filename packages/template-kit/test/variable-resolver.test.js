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

const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'variable-resolver',
  tests: [
    {
      name: 'quoted input is a string literal, quotes stripped',
      run: (ctx) => {
        ctx.expect(resolver.resolveInput(lookup, '"hello"')).toBe('hello');
        ctx.expect(resolver.resolveInput(lookup, "'hello'")).toBe('hello');
        // A quoted path is NOT looked up.
        ctx.expect(resolver.resolveInput(lookup, '"page.title"')).toBe('page.title');
      },
    },

    {
      name: 'unquoted input resolves through the context by default',
      run: (ctx) => {
        ctx.expect(resolver.resolveInput(lookup, 'page.title')).toBe('My Page');
        ctx.expect(resolver.resolveInput(lookup, 'hero')).toBe('from-context');
        // Unresolvable → null, never the raw text.
        ctx.expect(resolver.resolveInput(lookup, 'page.missing')).toBe(null);
      },
    },

    {
      name: 'empty and absent input resolve to null',
      run: (ctx) => {
        ctx.expect(resolver.resolveInput(lookup, '')).toBe(null);
        ctx.expect(resolver.resolveInput(lookup, null)).toBe(null);
        ctx.expect(resolver.resolveInput(lookup, undefined)).toBe(null);
      },
    },

    {
      name: 'preferLiteral resolves typed literals typed',
      run: (ctx) => {
        ctx.expect(resolver.resolveInput(lookup, '640', true)).toBe(640);
        ctx.expect(resolver.resolveInput(lookup, '-12', true)).toBe(-12);
        ctx.expect(resolver.resolveInput(lookup, '1.5', true)).toBe(1.5);
        ctx.expect(resolver.resolveInput(lookup, 'true', true)).toBe(true);
        ctx.expect(resolver.resolveInput(lookup, 'false', true)).toBe(false);
        ctx.expect(resolver.resolveInput(lookup, 'nil', true)).toBe(null);
        // A quoted number stays a string — the quotes are the author's opt-out.
        ctx.expect(resolver.resolveInput(lookup, '"640"', true)).toBe('640');
      },
    },

    {
      name: 'preferLiteral keeps bare words as text unless the context has them',
      run: (ctx) => {
        // A bare word absent from context stays literal — class=hero works.
        ctx.expect(resolver.resolveInput(lookup, 'lazy', true)).toBe('lazy');
        // A bare word PRESENT in context resolves (Ruby's truthiness guard).
        ctx.expect(resolver.resolveInput(lookup, 'hero', true)).toBe('from-context');
        // A falsy context value fails the guard, so the word stays literal.
        ctx.expect(resolver.resolveInput(lookup, 'falsy', true)).toBe('falsy');
        // A dotted path always resolves, present or not.
        ctx.expect(resolver.resolveInput(lookup, 'page.title', true)).toBe('My Page');
        ctx.expect(resolver.resolveInput(lookup, 'page.missing', true)).toBe(null);
      },
    },

    {
      name: 'bare literals evaluate before any scope lookup',
      run: (ctx) => {
        ctx.expect(resolver.resolveVariable(lookup, '640')).toBe(640);
        ctx.expect(resolver.resolveVariable(lookup, '-12')).toBe(-12);
        ctx.expect(resolver.resolveVariable(lookup, '1.5')).toBe(1.5);
        ctx.expect(resolver.resolveVariable(lookup, 'true')).toBe(true);
        ctx.expect(resolver.resolveVariable(lookup, 'false')).toBe(false);
        ctx.expect(resolver.resolveVariable(lookup, 'nil')).toBe(null);
        ctx.expect(resolver.resolveVariable(lookup, 'null')).toBe(null);
        // Surrounding whitespace does not defeat literal detection.
        ctx.expect(resolver.resolveVariable(lookup, '  640  ')).toBe(640);
      },
    },

    {
      name: 'resolveVariable maps an absent lookup to null and keeps real falsy values',
      run: (ctx) => {
        ctx.expect(resolver.resolveVariable(lookup, '')).toBe(null);
        ctx.expect(resolver.resolveVariable(lookup, 'page.missing')).toBe(null);
        // A context value of false/0 is a VALUE, not an absence.
        ctx.expect(resolver.resolveVariable(lookup, 'falsy')).toBe(false);
        ctx.expect(resolver.resolveVariable(lookup, 'zero')).toBe(0);
      },
    },

    {
      name: 'parseArguments splits on commas, trims, and preserves quoted commas',
      run: (ctx) => {
        ctx.expect(resolver.parseArguments('a, b, c')).toEqual(['a', 'b', 'c']);
        ctx.expect(resolver.parseArguments('  a  ,b  ')).toEqual(['a', 'b']);
        ctx.expect(resolver.parseArguments('"one, two", three')).toEqual(['"one, two"', 'three']);
        ctx.expect(resolver.parseArguments("post.image, class='a, b', lazy")).toEqual(['post.image', "class='a, b'", 'lazy']);
        ctx.expect(resolver.parseArguments('')).toEqual([]);
        ctx.expect(resolver.parseArguments(undefined)).toEqual([]);
      },
    },

    {
      name: 'parseOptions reads key=value pairs and ignores positional arguments',
      run: (ctx) => {
        const options = resolver.parseOptions(['post.image', 'width=640', "class='hero big'"]);

        ctx.expect(options).toEqual({ width: '640', class: 'hero big' });
      },
    },

    {
      name: 'parseOptions without a lookup strips quotes and keeps values as text',
      run: (ctx) => {
        ctx.expect(resolver.parseOptions(['width=640', 'alt="A photo"', 'src=page.title'])).toEqual({ width: '640', alt: 'A photo', src: 'page.title' });
      },
    },

    {
      name: 'parseOptions with a lookup applies the preferLiteral rule per value',
      run: (ctx) => {
        const options = resolver.parseOptions([
          'width=640',
          'webp=false',
          'class=card',
          'hero=hero',
          'src=post.image',
          'alt=page.missing',
          'title="literal text"',
        ], lookup);

        ctx.expect(options).toEqual({
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
      },
    },

    {
      name: 'parseOptions keeps only the FIRST = as the separator',
      run: (ctx) => {
        ctx.expect(resolver.parseOptions(['style=color:red;width=10'])).toEqual({ style: 'color:red;width=10' });
      },
    },

    {
      name: 'isQuoted and stripQuotes read the raw argument shape',
      run: (ctx) => {
        ctx.expect(resolver.isQuoted('"hi"')).toBe(true);
        ctx.expect(resolver.isQuoted("'hi'")).toBe(true);
        ctx.expect(resolver.isQuoted('hi')).toBe(false);
        ctx.expect(resolver.isQuoted('')).toBe(false);
        ctx.expect(resolver.isQuoted(undefined)).toBe(false);

        ctx.expect(resolver.stripQuotes('"hi"')).toBe('hi');
        ctx.expect(resolver.stripQuotes("'hi'")).toBe('hi');
        ctx.expect(resolver.stripQuotes('hi')).toBe('hi');
      },
    },
  ],
});
