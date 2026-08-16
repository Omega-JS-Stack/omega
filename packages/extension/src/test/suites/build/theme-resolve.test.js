// Build-layer tests for lib/theme.js — per-framework theme.id resolution (#261).
//
// `theme.id` is a SHARED config key, but every framework owns its own theme set:
// a brand whose website theme is `studymonkey` handed the extension build an id
// it has no stylesheet for, and the build died on a raw sass "Can't find
// stylesheet to import" that named neither the config key nor the valid set.
// Unknown ids now fall back to the extension's default theme with ONE warning.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const { resolveThemeId, DEFAULT_THEME_ID } = require('../../../lib/theme.js');

// A themes dir shaped like the framework's own: theme dirs plus the `_template`
// scaffold, which is not a selectable theme.
function stageThemes() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-themes-'));
  for (const name of ['classy', 'bootstrap', 'newsflash', '_template']) {
    fs.mkdirSync(path.join(tmp, name), { recursive: true });
  }
  return tmp;
}

// Logger that records what it was told (the real ones stamp the identity tag).
function captureLogger() {
  const warnings = [];
  return { warnings, warn: (message) => warnings.push(message), log: () => {} };
}

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'theme resolution — unknown ids fall back with one actionable warning',
  tests: [
    {
      name: 'a theme this framework ships resolves to itself, silently',
      run: (ctx) => {
        const themesDir = stageThemes();
        const logger = captureLogger();

        try {
          ctx.expect(resolveThemeId('bootstrap', { themesDir, logger })).toBe('bootstrap');
          ctx.expect(logger.warnings.length).toBe(0);
        } finally {
          fs.rmSync(themesDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'no theme.id at all resolves to the framework default, silently',
      run: (ctx) => {
        const themesDir = stageThemes();
        const logger = captureLogger();

        try {
          ctx.expect(resolveThemeId(undefined, { themesDir, logger })).toBe(DEFAULT_THEME_ID);
          ctx.expect(logger.warnings.length).toBe(0);
        } finally {
          fs.rmSync(themesDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'an unknown id falls back to the default with ONE warning naming the key, the value, and the valid set',
      run: (ctx) => {
        const themesDir = stageThemes();
        const logger = captureLogger();

        try {
          ctx.expect(resolveThemeId('studymonkey', { themesDir, logger })).toBe(DEFAULT_THEME_ID);
          ctx.expect(logger.warnings.length).toBe(1);

          const warning = logger.warnings[0];
          ctx.expect(warning).toContain('theme.id');
          ctx.expect(warning).toContain('studymonkey');
          ctx.expect(warning).toContain(DEFAULT_THEME_ID);
          ctx.expect(warning).toContain('bootstrap');
          ctx.expect(warning).toContain('newsflash');
          // `_template` is a scaffold, never an option to offer
          ctx.expect(warning.includes('_template')).toBe(false);
        } finally {
          fs.rmSync(themesDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'every resolve site sharing the bad id warns ONCE (sass + webpack, one build)',
      run: (ctx) => {
        const themesDir = stageThemes();
        const logger = captureLogger();

        try {
          resolveThemeId('brand-only-theme', { themesDir, logger });
          resolveThemeId('brand-only-theme', { themesDir, logger });
          resolveThemeId('brand-only-theme', { themesDir, logger });
          ctx.expect(logger.warnings.length).toBe(1);
        } finally {
          fs.rmSync(themesDir, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'an unreadable themes dir judges nothing: the id passes through unwarned',
      run: (ctx) => {
        const logger = captureLogger();
        const missing = path.join(os.tmpdir(), 'extension-themes-does-not-exist');

        ctx.expect(resolveThemeId('classy', { themesDir: missing, logger })).toBe('classy');
        ctx.expect(logger.warnings.length).toBe(0);
      },
    },
  ],
};
