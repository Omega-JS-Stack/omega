// Build-layer tests for the translation glue — the engine/cache/providers live
// in @omega.js/devkit/translate (unit-tested there); these cover the
// extension-specific pieces: composing a locale's messages.json from the
// committed per-string cache (EN fallback for gaps, developer descriptions
// kept in English) and the description source-hash marker round-trip.

const path = require('path');
const fs = require('fs');
const os = require('os');
const jetpack = require('fs-jetpack');

const { composeMessages, readTranslatedDescription } = require('../../../gulp/tasks/translate.js');
const { hashKey, saveCache } = require('@omega.js/devkit/translate');

const EN_MESSAGES = {
  appName: { message: 'OMEGA', description: 'The name of the extension.' },
  appNameShort: { message: 'OMEGA', description: 'The short name of the extension.' },
  btnTooltip: { message: 'Click to open', description: 'Tooltip for the button.' },
};

module.exports = {
  type: 'group',
  layer: 'build',
  description: 'translation glue (devkit engine consumers)',
  tests: [
    {
      name: 'composeMessages: cache hits land, gaps fall back to English, descriptions stay English',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-translate-'));

        // Cache carries a translation for the shared "OMEGA" string only
        saveCache(tmp, 'es', 'messages', { [hashKey('OMEGA')]: 'OMEGA·es' });

        const composed = composeMessages(EN_MESSAGES, 'es', tmp);

        // Shared source string → both keys get the cached translation
        ctx.expect(composed.appName.message).toBe('OMEGA·es');
        ctx.expect(composed.appNameShort.message).toBe('OMEGA·es');
        // No cache entry → English fallback (file always complete)
        ctx.expect(composed.btnTooltip.message).toBe('Click to open');
        // Developer-facing descriptions never translate
        ctx.expect(composed.appName.description).toBe('The name of the extension.');

        jetpack.remove(tmp);
      },
    },
    {
      name: 'source edit invalidates: a changed EN message misses the old cache entry',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-translate-'));
        saveCache(tmp, 'es', 'messages', { [hashKey('Old tooltip')]: 'Vieja' });

        const composed = composeMessages(
          { btnTooltip: { message: 'New tooltip', description: 'd' } },
          'es',
          tmp
        );

        ctx.expect(composed.btnTooltip.message).toBe('New tooltip');

        jetpack.remove(tmp);
      },
    },
    {
      name: 'readTranslatedDescription: strips the source marker, null when absent',
      run: (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-translate-'));

        jetpack.write(
          path.join(tmp, 'es', 'description.md'),
          `<!-- omega:source ${'a'.repeat(12)} -->\n# La Descripción\n\nHola.`
        );

        const content = readTranslatedDescription('es', tmp);
        ctx.expect(content.startsWith('# La Descripción')).toBeTruthy();
        ctx.expect(content.includes('omega:source')).toBe(false);

        ctx.expect(readTranslatedDescription('fr', tmp)).toBe(null);

        jetpack.remove(tmp);
      },
    },
  ],
};
