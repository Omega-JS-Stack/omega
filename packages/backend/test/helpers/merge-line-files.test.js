/**
 * Test: mergeLineBasedFiles()
 * Unit tests for the line-based .env / .gitignore / CLAUDE.md merge.
 *
 * Tests the pure function directly — no emulator, no Firestore, no HTTP.
 *
 * Regression coverage for the bug that scrambled consumers' `.env` files: an
 * older positional implementation zipped comment lines and value lines by index,
 * so any drift in key order shifted every value under the wrong header. The
 * canonical impl merges BY KEY, so headers always re-anchor to the template and
 * values follow their key across sections.
 */
const {
  mergeLineBasedFiles,
  DEFAULT_MARKER,
  CUSTOM_MARKER,
} = require('../../dist/utils/merge-line-files.js');

// Setup-test helper shim — must re-export the SAME canonical impl (SSOT).
const helperShim = require('../../dist/cli/commands/setup-tests/helpers/merge-line-files.js');
const defineCases = require('../../dist/vendor/devkit/test/define-cases.js');

// A representative framework .env template (keys grouped under headers).
const TEMPLATE = [
  DEFAULT_MARKER,
  '# GitHub',
  'GH_TOKEN=""',
  '',
  '# AI',
  'OPENAI_API_KEY=""',
  'ANTHROPIC_API_KEY=""',
  '',
  '# Payment Providers',
  'PAYPAL_CLIENT_SECRET=""',
  'STRIPE_SECRET_KEY=""',
  '',
  CUSTOM_MARKER,
  '# Add your custom environment variables below this line',
].join('\n');

// Pull the value assigned to a key in a given section of a merged result.
function keyValueInSection(merged, key, section /* 'default' | 'custom' */) {
  const lines = merged.split('\n');
  let mode = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === DEFAULT_MARKER) { mode = 'default'; continue; }
    if (trimmed === CUSTOM_MARKER) { mode = 'custom'; continue; }
    if (mode !== section || !trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq).trim() === key) return trimmed.slice(eq + 1);
  }
  return undefined;
}

// Count how many times a key appears anywhere (catches duplication bugs).
function keyOccurrences(merged, key) {
  return merged.split('\n').filter((l) => l.trim().startsWith(`${key}=`)).length;
}

// Assert a key sits directly under the expected comment header in the merged output.
function headerAboveKey(merged, key) {
  const lines = merged.split('\n');
  const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  if (idx < 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t.startsWith('#') && t !== DEFAULT_MARKER && t !== CUSTOM_MARKER) return t;
    if (t && !t.startsWith('#')) continue; // another key — keep scanning up
  }
  return null;
}

module.exports = defineCases({
  description: 'mergeLineBasedFiles() line-based .env / .gitignore merge',
  type: 'group',

  tests: [
    {
      name: 'ssot-helper-shim-is-same-function',
      async run({ expect }) {
        expect(helperShim.mergeLineBasedFiles, 'setup-tests helper must re-export the canonical mergeLineBasedFiles (SSOT)').toBe(mergeLineBasedFiles);
        expect(helperShim.DEFAULT_SECTION_MARKER, 'marker alias matches').toBe(DEFAULT_MARKER);
        expect(helperShim.CUSTOM_SECTION_MARKER, 'marker alias matches').toBe(CUSTOM_MARKER);
        expect(helperShim.hasSectionMarkers(TEMPLATE), 'hasSectionMarkers detects markers').toBeTruthy();
      },
    },

    {
      name: 'preserves-existing-values-by-key',
      async run({ expect }) {
        const existing = [
          DEFAULT_MARKER,
          '# GitHub',
          'GH_TOKEN="ghp_real"',
          '# AI',
          'OPENAI_API_KEY="sk-real"',
          'ANTHROPIC_API_KEY=""',
          '# Payment Providers',
          'PAYPAL_CLIENT_SECRET="pp_real"',
          'STRIPE_SECRET_KEY=""',
          CUSTOM_MARKER,
        ].join('\n');

        const merged = mergeLineBasedFiles(existing, TEMPLATE, '.env');
        expect(keyValueInSection(merged, 'GH_TOKEN', 'default'), 'GH_TOKEN value kept').toBe('"ghp_real"');
        expect(keyValueInSection(merged, 'OPENAI_API_KEY', 'default'), 'OPENAI value kept').toBe('"sk-real"');
        expect(keyValueInSection(merged, 'PAYPAL_CLIENT_SECRET', 'default'), 'PAYPAL value kept').toBe('"pp_real"');
      },
    },

    {
      name: 'keys-stay-under-correct-header-when-order-drifts',
      async run({ expect }) {
        // Existing file has keys in a DIFFERENT order than the template. The old
        // positional merge would shift values under the wrong header here.
        const existing = [
          DEFAULT_MARKER,
          '# Misc (old grouping)',
          'STRIPE_SECRET_KEY="stripe_real"',
          'OPENAI_API_KEY="openai_real"',
          'GH_TOKEN="gh_real"',
          'PAYPAL_CLIENT_SECRET="pp_real"',
          'ANTHROPIC_API_KEY="anthropic_real"',
          CUSTOM_MARKER,
        ].join('\n');

        const merged = mergeLineBasedFiles(existing, TEMPLATE, '.env');

        expect(headerAboveKey(merged, 'OPENAI_API_KEY'), 'OPENAI under # AI').toBe('# AI');
        expect(headerAboveKey(merged, 'ANTHROPIC_API_KEY'), 'ANTHROPIC under # AI').toBe('# AI');
        expect(headerAboveKey(merged, 'PAYPAL_CLIENT_SECRET'), 'PAYPAL under # Payment Providers').toBe('# Payment Providers');
        expect(headerAboveKey(merged, 'STRIPE_SECRET_KEY'), 'STRIPE under # Payment Providers').toBe('# Payment Providers');
        expect(headerAboveKey(merged, 'GH_TOKEN'), 'GH_TOKEN under # GitHub').toBe('# GitHub');

        // Values still attached to the right keys.
        expect(keyValueInSection(merged, 'STRIPE_SECRET_KEY', 'default'), 'STRIPE value intact').toBe('"stripe_real"');
        expect(keyValueInSection(merged, 'OPENAI_API_KEY', 'default'), 'OPENAI value intact').toBe('"openai_real"');
      },
    },

    {
      name: 'promotes-custom-key-to-default-when-template-adopts-it',
      async run({ expect }) {
        // User had APOLLO_API_KEY in Custom; framework adds it to the template.
        const tplWithApollo = TEMPLATE.replace('STRIPE_SECRET_KEY=""', 'STRIPE_SECRET_KEY=""\nAPOLLO_API_KEY=""');
        const existing = [
          DEFAULT_MARKER,
          '# GitHub',
          'GH_TOKEN="gh_real"',
          '# AI',
          'OPENAI_API_KEY=""',
          'ANTHROPIC_API_KEY=""',
          '# Payment Providers',
          'PAYPAL_CLIENT_SECRET=""',
          'STRIPE_SECRET_KEY=""',
          CUSTOM_MARKER,
          'APOLLO_API_KEY="apollo_real"',
          'GITHUB_TOKEN="legacy"',
        ].join('\n');

        const merged = mergeLineBasedFiles(existing, tplWithApollo, '.env');

        expect(keyValueInSection(merged, 'APOLLO_API_KEY', 'default'), 'APOLLO promoted to Default with value').toBe('"apollo_real"');
        expect(keyValueInSection(merged, 'APOLLO_API_KEY', 'custom'), 'APOLLO removed from Custom').toBe(undefined);
        expect(keyOccurrences(merged, 'APOLLO_API_KEY'), 'APOLLO not duplicated').toBe(1);
      },
    },

    {
      name: 'migrates-unknown-default-key-to-custom',
      async run({ expect }) {
        // User has a legacy key in Default that the template no longer defines.
        const existing = [
          DEFAULT_MARKER,
          '# GitHub',
          'GITHUB_TOKEN="legacy_real"', // template now uses GH_TOKEN
          'GH_TOKEN="gh_real"',
          '# AI',
          'OPENAI_API_KEY=""',
          'ANTHROPIC_API_KEY=""',
          '# Payment Providers',
          'PAYPAL_CLIENT_SECRET=""',
          'STRIPE_SECRET_KEY=""',
          CUSTOM_MARKER,
        ].join('\n');

        const merged = mergeLineBasedFiles(existing, TEMPLATE, '.env');

        expect(keyValueInSection(merged, 'GITHUB_TOKEN', 'custom'), 'legacy key migrated to Custom with value').toBe('"legacy_real"');
        expect(keyValueInSection(merged, 'GITHUB_TOKEN', 'default'), 'legacy key gone from Default').toBe(undefined);
        expect(keyValueInSection(merged, 'GH_TOKEN', 'default'), 'GH_TOKEN kept in Default').toBe('"gh_real"');
      },
    },

    {
      name: 'preserves-custom-section-verbatim',
      async run({ expect }) {
        const existing = [
          DEFAULT_MARKER,
          '# GitHub',
          'GH_TOKEN=""',
          '# AI',
          'OPENAI_API_KEY=""',
          'ANTHROPIC_API_KEY=""',
          '# Payment Providers',
          'PAYPAL_CLIENT_SECRET=""',
          'STRIPE_SECRET_KEY=""',
          CUSTOM_MARKER,
          'MY_CUSTOM_KEY="custom_real"',
          '# OAuth2',
          'OAUTH_ID="abc"',
        ].join('\n');

        const merged = mergeLineBasedFiles(existing, TEMPLATE, '.env');
        expect(keyValueInSection(merged, 'MY_CUSTOM_KEY', 'custom'), 'custom key preserved').toBe('"custom_real"');
        expect(keyValueInSection(merged, 'OAUTH_ID', 'custom'), 'custom OAuth key preserved').toBe('"abc"');
        expect(merged.includes('# OAuth2'), 'custom comment preserved').toBeTruthy();
      },
    },

    {
      name: 'normalizes-raw-values-to-double-quoted',
      async run({ expect }) {
        const existing = [
          DEFAULT_MARKER,
          '# GitHub',
          'GH_TOKEN=raw-no-quotes',
          '# AI',
          "OPENAI_API_KEY='single'",
          'ANTHROPIC_API_KEY=""',
          '# Payment Providers',
          'PAYPAL_CLIENT_SECRET=""',
          'STRIPE_SECRET_KEY=""',
          CUSTOM_MARKER,
        ].join('\n');

        const merged = mergeLineBasedFiles(existing, TEMPLATE, '.env');
        expect(keyValueInSection(merged, 'GH_TOKEN', 'default'), 'raw value double-quoted').toBe('"raw-no-quotes"');
        expect(keyValueInSection(merged, 'OPENAI_API_KEY', 'default'), 'single-quoted canonicalized to double').toBe('"single"');
      },
    },

    {
      name: 'is-idempotent',
      async run({ expect }) {
        const existing = [
          DEFAULT_MARKER,
          '# GitHub',
          'GH_TOKEN="gh_real"',
          '# AI',
          'OPENAI_API_KEY="sk"',
          'ANTHROPIC_API_KEY=""',
          '# Payment Providers',
          'PAYPAL_CLIENT_SECRET=""',
          'STRIPE_SECRET_KEY=""',
          CUSTOM_MARKER,
          'CUSTOM="x"',
        ].join('\n');

        const once = mergeLineBasedFiles(existing, TEMPLATE, '.env');
        const twice = mergeLineBasedFiles(once, TEMPLATE, '.env');
        expect(once, 're-running the merge produces identical output').toBe(twice);
      },
    },
  ],
});
